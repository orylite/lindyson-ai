import { describe, expect, it } from 'vitest';
import {
  assertRecoverableSeedanceTaskRow,
  type RecoveryTaskRow,
} from '../src/tools/recoverSeedanceTask.js';

describe('recoverSeedanceTask', () => {
  it('只允许恢复失败、已退款、无资产且有方舟任务 ID 的 Seedance 视频任务', () => {
    expect(() => assertRecoverableSeedanceTaskRow(recoveryTaskRow())).not.toThrow();

    expect(() => assertRecoverableSeedanceTaskRow({
      ...recoveryTaskRow(),
      status: 'completed',
    })).toThrow('任务当前状态不可恢复');

    expect(() => assertRecoverableSeedanceTaskRow({
      ...recoveryTaskRow(),
      asset_id: 'asset-existing',
    })).toThrow('任务已绑定数字资产');

    expect(() => assertRecoverableSeedanceTaskRow({
      ...recoveryTaskRow(),
      model: 'GPT Image 2.0',
    })).toThrow('只有 Seedance 视频任务可以恢复');

    expect(() => assertRecoverableSeedanceTaskRow({
      ...recoveryTaskRow(),
      provider_task_id: null,
    })).toThrow('任务缺少方舟 provider_task_id');
  });
});

function recoveryTaskRow(): RecoveryTaskRow {
  return {
    id: 'task-1',
    user_id: 'user-1',
    kind: 'video',
    model: 'Seedance 2.0 Mini',
    status: 'failed',
    credit_status: 'refunded',
    asset_id: null,
    prompt: '生成产品视频',
    config: { durationSeconds: 5 },
    provider_task_id: 'cgt-20260701231431-ssx7t',
    credits: 10,
  };
}
