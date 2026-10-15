import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/pool.js';
import {
  beginGenerationTaskRecovery,
  failGenerationTaskRecovery,
  recoverRefundedTaskSuccess,
  renewGenerationTaskRecoveryLease,
} from '../domain/generationService.js';
import { isSeedanceModelLabel } from '../domain/seedanceModels.js';
import { toInt } from '../domain/serialization.js';
import { recoverArkSeedanceTaskResult } from '../providers/arkSeedanceProvider.js';
import { buildPublicUrl, copyStoredObject } from '../storage/storageService.js';

export interface RecoveryTaskRow {
  id: string;
  user_id: string;
  kind: 'video' | 'image';
  model: string;
  status: string;
  credit_status: string;
  asset_id: string | null;
  prompt: string;
  config: Record<string, unknown>;
  provider_task_id: string | null;
  credits: number;
}

async function main() {
  const inputId = process.argv[2]?.trim();
  if (!inputId) {
    throw new Error('请提供 generation_tasks.id 或后台任务用量明细中的 provider_usage_records.id。');
  }

  const task = await loadRecoverableTask(inputId);
  assertRecoverableSeedanceTaskRow(task);
  const recovery = await beginGenerationTaskRecovery(task.id);

  const stagingPrefix = `${recovery.stagingObjectKey}/recovery-${recovery.recoveryToken}`;
  const stagingOutputObjectKey = `${stagingPrefix}/output.mp4`;
  const stagingThumbnailObjectKey = `${stagingPrefix}/thumbnail.jpg`;
  // 即使下载/探测在中途失败，也通过确定性 key 清理可能已写入的半成品。
  const cleanupObjectKeys: string[] = [stagingOutputObjectKey, stagingThumbnailObjectKey];
  const copiedFinalObjectKeys: string[] = [];
  let providerResult;
  try {
    providerResult = await recoverArkSeedanceTaskResult({
      taskId: task.id,
      userId: task.user_id,
      kind: task.kind,
      model: task.model,
      prompt: task.prompt,
      config: task.config,
      credits: toInt(task.credits),
      providerTaskId: task.provider_task_id!,
      outputObjectKey: stagingOutputObjectKey,
      thumbnailObjectKey: stagingThumbnailObjectKey,
    });
    const renewed = await renewGenerationTaskRecoveryLease(task.id, recovery.recoveryToken);
    if (!renewed) {
      throw Object.assign(new Error('恢复租约已被新的恢复进程接管，旧进程禁止写入最终对象'), {
        code: 'GENERATION_RECOVERY_LEASE_LOST',
      });
    }
    await copyStoredObject(providerResult.objectKey, renewed.outputObjectKey);
    copiedFinalObjectKeys.push(renewed.outputObjectKey);
    if (providerResult.thumbnailKey && renewed.thumbnailObjectKey) {
      await copyStoredObject(providerResult.thumbnailKey, renewed.thumbnailObjectKey);
      copiedFinalObjectKeys.push(renewed.thumbnailObjectKey);
    }

    const finalProviderResult = {
      ...providerResult,
      objectKey: renewed.outputObjectKey,
      thumbnailKey: providerResult.thumbnailKey ? renewed.thumbnailObjectKey : null,
      publicUrl: buildPublicUrl(renewed.outputObjectKey),
      thumbnailUrl: providerResult.thumbnailKey && renewed.thumbnailObjectKey
        ? buildPublicUrl(renewed.thumbnailObjectKey)
        : null,
    };
    const recovered = await recoverRefundedTaskSuccess(
      task.id,
      finalProviderResult,
      recovery.recoveryToken,
      cleanupObjectKeys,
    );
    console.log(JSON.stringify({
      ok: true,
      inputId,
      taskId: recovered.id,
      assetId: recovered.assetId,
      providerTaskId: providerResult.providerTaskId,
      rawUnits: providerResult.rawUnits,
      deductedUnits: providerResult.deductedUnits,
      usageUnit: providerResult.usageUnit,
      settledCredits: recovered.settledCredits,
      refundedCredits: recovered.refundedCredits,
    }, null, 2));
  } catch (error) {
    await failGenerationTaskRecovery(
      task.id,
      recovery.recoveryToken,
      [...cleanupObjectKeys, ...copiedFinalObjectKeys],
      error,
    );
    throw error;
  }
}

async function loadRecoverableTask(inputId: string) {
  const result = await pool.query<RecoveryTaskRow>(
    `SELECT gt.*
     FROM generation_tasks gt
     LEFT JOIN provider_usage_records pur ON pur.task_id = gt.id
     WHERE gt.id = $1::uuid OR pur.id = $1::uuid
     ORDER BY CASE WHEN gt.id = $1::uuid THEN 0 ELSE 1 END
     LIMIT 1`,
    [inputId],
  );

  return result.rows[0] ?? null;
}

export function assertRecoverableSeedanceTaskRow(task: RecoveryTaskRow | null): asserts task is RecoveryTaskRow {
  if (!task) throw new Error('未找到对应的生成任务。');
  if (task.kind !== 'video' || !isSeedanceModelLabel(task.model)) {
    throw new Error('只有 Seedance 视频任务可以恢复。');
  }
  if (task.status !== 'failed' || task.credit_status !== 'refunded') {
    throw new Error(`任务当前状态不可恢复：status=${task.status}, credit_status=${task.credit_status}`);
  }
  if (task.asset_id) {
    throw new Error(`任务已绑定数字资产，不能重复恢复：${task.asset_id}`);
  }
  if (!task.provider_task_id) {
    throw new Error('任务缺少方舟 provider_task_id，无法查询官方结果。');
  }
}

if (isMainModule()) {
  main()
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry!) === fileURLToPath(import.meta.url);
}
