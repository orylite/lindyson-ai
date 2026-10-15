import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import {
  SEEDREAM_5_PRO_MODEL_LABEL,
  estimateSeedreamListPrice,
} from '../domain/seedreamListPrice.js';
import type { ProviderResponseCheckpointInput } from '../domain/types.js';
import { runArkSeedreamProvider } from '../providers/arkSeedreamProvider.js';
import {
  deleteObject,
  getStoredObjectSize,
  resolveObjectProcessingInput,
} from '../storage/storageService.js';
import { probeMedia, validateMediaDecoding } from '../storage/mediaProcessor.js';
import { seedreamProviderCanaryOperationalUsageRecord } from './providerOperationalUsageCanaryAdapters.js';
import {
  requireProviderOperationalUsageManifestRuntimeConfig,
  writeProviderOperationalUsageCanaryBundle,
} from './providerOperationalUsageManifestWriter.js';

const EXPECTED_WIDTH = 1_024;
const EXPECTED_HEIGHT = 1_024;

interface SeedreamOperationalUsageObservation {
  status: 'success' | 'failed' | 'unknown';
  occurredAt: string;
  localCheckpointOperationId: string | null;
  providerRequestId: string | null;
  outputWidth: number | null;
  outputHeight: number | null;
  price: ReturnType<typeof estimateSeedreamListPrice>;
  providerOutcome: string;
}

export async function runSeedreamProviderCanary() {
  assertCanaryEnvironment();
  // 必须在任何付费请求前锁定不可覆盖的证据输出和成本承担人。
  const operationalUsage = requireProviderOperationalUsageManifestRuntimeConfig();
  const taskId = randomUUID();
  const objectKey = `provider-canary/seedream/${taskId}/output.png`;
  const stagingObjectKey = `provider-canary/seedream/${taskId}/staging`;
  let checkpoint: Omit<ProviderResponseCheckpointInput, 'responseUrl'> | null = null;
  let submitted = false;
  let operationalObservation: SeedreamOperationalUsageObservation | null = null;

  try {
    const result = await runArkSeedreamProvider({
      taskId,
      userId: randomUUID(),
      kind: 'image',
      model: SEEDREAM_5_PRO_MODEL_LABEL,
      prompt: '一只白色陶瓷咖啡杯放在浅色木桌上，柔和自然光，写实产品摄影，正方形构图。',
      config: {
        resolution: '1K',
        aspectRatio: '1:1',
        optimizePromptMode: 'standard',
        outputSize: `${EXPECTED_WIDTH}x${EXPECTED_HEIGHT}`,
        referenceAssets: [],
        annotations: [],
      },
      credits: 14,
      attempt: 0,
      outputObjectKey: objectKey,
      thumbnailObjectKey: `provider-canary/seedream/${taskId}/thumbnail.webp`,
      stagingObjectKey,
      onProviderSubmissionStarted: async () => {
        if (submitted) throw canaryError('SEEDREAM_CANARY_DUPLICATE_SUBMISSION', 'Seedream canary 重复进入提交边界');
        submitted = true;
        operationalObservation = unknownSeedreamSubmissionObservation();
      },
      onProviderResponseCheckpoint: async observed => {
        if (checkpoint) throw canaryError('SEEDREAM_CANARY_DUPLICATE_CHECKPOINT', 'Seedream canary 重复观察同步响应');
        checkpoint = {
          providerOperationId: observed.providerOperationId,
          providerRequestId: observed.providerRequestId,
          response: observed.response,
          observedAt: observed.observedAt,
          responseUrlExpiresAt: observed.responseUrlExpiresAt,
        };
        operationalObservation = {
          status: 'success',
          occurredAt: observed.observedAt,
          localCheckpointOperationId: observed.providerOperationId,
          providerRequestId: observed.providerRequestId,
          outputWidth: EXPECTED_WIDTH,
          outputHeight: EXPECTED_HEIGHT,
          price: estimateSeedreamListPrice({
            referenceImageCount: 0,
            outputWidth: EXPECTED_WIDTH,
            outputHeight: EXPECTED_HEIGHT,
          }),
          providerOutcome: 'checkpoint-observed',
        };
      },
    });

    if (!result.ok) {
      if (result.providerHttpStatus !== undefined) {
        operationalObservation = {
          status: 'failed',
          occurredAt: new Date().toISOString(),
          localCheckpointOperationId: null,
          providerRequestId: result.providerRequestId ?? null,
          outputWidth: null,
          outputHeight: null,
          price: estimateSeedreamListPrice({
            referenceImageCount: 0,
            outputWidth: null,
            outputHeight: null,
          }),
          providerOutcome: `http-${result.providerHttpStatus}`,
        };
      }
      throw canaryError('SEEDREAM_CANARY_PROVIDER_FAILED', `Seedream canary 未生成图片：${result.reason}`);
    }
    if (!submitted || !checkpoint) {
      throw canaryError('SEEDREAM_CANARY_CHECKPOINT_MISSING', 'Seedream canary 未观察到完整提交与 checkpoint');
    }
    const observedCheckpoint = checkpoint as Omit<ProviderResponseCheckpointInput, 'responseUrl'>;
    if (result.objectKey !== objectKey) {
      throw canaryError('SEEDREAM_CANARY_OBJECT_KEY_MISMATCH', 'Seedream canary 归档对象路径与预分配路径不一致');
    }

    const storedSizeBytes = await getStoredObjectSize(objectKey);
    if (storedSizeBytes <= 0 || storedSizeBytes !== result.sizeBytes) {
      throw canaryError('SEEDREAM_CANARY_OBJECT_SIZE_MISMATCH', 'Seedream canary TOS 对象大小证据不一致');
    }
    const processingInput = await resolveObjectProcessingInput(objectKey);
    const media = await probeMedia(processingInput);
    await validateMediaDecoding(processingInput, 'image');
    if (
      !media.formatName?.toLowerCase().includes('png')
      || media.width !== EXPECTED_WIDTH
      || media.height !== EXPECTED_HEIGHT
      || result.width !== EXPECTED_WIDTH
      || result.height !== EXPECTED_HEIGHT
    ) {
      throw canaryError(
        'SEEDREAM_CANARY_PNG_INVALID',
        `Seedream canary 不是预期的 ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT} PNG`,
      );
    }

    const price = estimateSeedreamListPrice({
      referenceImageCount: 0,
      outputWidth: media.width,
      outputHeight: media.height,
    });
    if (price.status !== 'known' || price.estimatedCostCny !== '0.300000') {
      throw canaryError('SEEDREAM_CANARY_PRICE_EVIDENCE_INVALID', 'Seedream canary 列表价证据未落入 0.30 元档');
    }

    emitCanaryEvent({
      event: 'seedream-provider-canary',
      ok: true,
      model: SEEDREAM_5_PRO_MODEL_LABEL,
      resolution: '1K',
      outputFormat: 'png',
      watermark: false,
      width: media.width,
      height: media.height,
      sizeBytes: storedSizeBytes,
      localCheckpointOperationId: observedCheckpoint.providerOperationId,
      requestEvidence: observedCheckpoint.providerRequestId ? 'provider-id' : 'local-only',
      providerRequestId: observedCheckpoint.providerRequestId,
      priceVersion: price.priceVersion,
      estimatedListPriceCny: price.estimatedCostCny,
      storageDriver: env.STORAGE_DRIVER,
    });
    return true;
  } finally {
    let manifestError: unknown = null;
    if (operationalObservation) {
      try {
        const manifest = await persistSeedreamOperationalUsage(
          operationalUsage,
          operationalObservation,
        );
        emitCanaryEvent({
          event: 'seedream-provider-canary-operational-usage',
          ok: true,
          recordCount: manifest.recordCount,
          manifestPath: manifest.manifestPath,
          manifestSha256: manifest.manifestSha256,
          evidencePath: manifest.evidencePath,
          evidenceSha256: manifest.evidenceSha256,
        });
      } catch (error) {
        manifestError = error;
      }
    }
    const cleanup = await Promise.allSettled([
      deleteObject(objectKey),
      deleteObject(stagingObjectKey),
    ]);
    if (cleanup.some(result => result.status === 'rejected')) {
      throw canaryError('SEEDREAM_CANARY_CLEANUP_FAILED', 'Seedream canary 的 final/staging TOS 对象未能全部清理');
    }
    if (manifestError) throw manifestError;
  }
}

function unknownSeedreamSubmissionObservation(): SeedreamOperationalUsageObservation {
  return {
    status: 'unknown',
    occurredAt: new Date().toISOString(),
    localCheckpointOperationId: null,
    providerRequestId: null,
    outputWidth: null,
    outputHeight: null,
    price: estimateSeedreamListPrice({
      referenceImageCount: 0,
      outputWidth: null,
      outputHeight: null,
    }),
    providerOutcome: 'submission-started-response-unknown',
  };
}

async function persistSeedreamOperationalUsage(
  config: ReturnType<typeof requireProviderOperationalUsageManifestRuntimeConfig>,
  observation: SeedreamOperationalUsageObservation,
) {
  return writeProviderOperationalUsageCanaryBundle({
    manifestPath: config.outputPath,
    manifestId: `${config.sourceRunId}-provider-operational-usage-v1`,
    evidence: {
      evidenceKind: 'seedream-provider-canary-observation/v1',
      sourceRunId: config.sourceRunId,
      providerOutcome: observation.providerOutcome,
      status: observation.status,
      occurredAt: observation.occurredAt,
      localCheckpointOperationId: observation.localCheckpointOperationId,
      providerRequestId: observation.providerRequestId,
      model: SEEDREAM_5_PRO_MODEL_LABEL,
      outputWidth: observation.outputWidth,
      outputHeight: observation.outputHeight,
      priceVersion: observation.price.priceVersion,
      estimatedListPriceCny: observation.price.estimatedCostCny,
    },
    buildRecords: evidence => [seedreamProviderCanaryOperationalUsageRecord({
      costOwnerUserId: config.costOwnerUserId,
      sourceRunId: config.sourceRunId,
      sourceItemKey: 'seedream-generation',
      occurredAt: observation.occurredAt,
      evidencePath: evidence.evidencePath,
      evidenceSha256: evidence.evidenceSha256,
      providerOperationId: null,
      localCheckpointOperationId: observation.localCheckpointOperationId,
      providerRequestId: observation.providerRequestId,
      model: SEEDREAM_5_PRO_MODEL_LABEL,
      referenceImageCount: 0,
      outputWidth: observation.outputWidth,
      outputHeight: observation.outputHeight,
      price: observation.price,
      status: observation.status,
    })],
  });
}

function assertCanaryEnvironment() {
  if (!env.ARK_API_KEY) {
    throw canaryError('SEEDREAM_CANARY_API_KEY_MISSING', 'Seedream canary 需要服务端 ARK_API_KEY');
  }
  if (env.STORAGE_DRIVER !== 'tos') {
    throw canaryError('SEEDREAM_CANARY_TOS_REQUIRED', 'Seedream 发布 canary 必须使用私有 TOS 存储');
  }
}

function canaryError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function safeError(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  return {
    code: typeof candidate?.code === 'string' ? candidate.code : 'SEEDREAM_CANARY_FAILED',
    message: (typeof candidate?.message === 'string' ? candidate.message : 'Seedream canary 失败')
      .replace(/https?:\/\/\S+/giu, '[已隐藏地址]')
      .slice(0, 500),
  };
}

function emitCanaryEvent(event: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function main() {
  try {
    await runSeedreamProviderCanary();
  } catch (error) {
    emitCanaryEvent({ event: 'seedream-provider-canary', ok: false, error: safeError(error) });
    process.exitCode = 1;
  }
}

function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry!) === fileURLToPath(import.meta.url);
}

if (isMainModule()) void main();
