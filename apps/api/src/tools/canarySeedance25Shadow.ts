import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Pool, type PoolClient } from 'pg';
import type sharpFactory from '../../../../node_modules/sharp/lib/index.js';
import { hashPassword } from '../auth/password.js';
import { ensureDefaultAssetFolders } from '../domain/assetFolders.js';
import { SEEDANCE_25_CONSUMPTION_COMBINATIONS } from '../domain/consumption.js';
import { seedanceShadowCanaryOperationalUsageRecord } from './providerOperationalUsageCanaryAdapters.js';
import {
  requireProviderOperationalUsageManifestRuntimeConfig,
  writeProviderOperationalUsageCanaryBundle,
  type ProviderOperationalUsageManifestRuntimeConfig,
} from './providerOperationalUsageManifestWriter.js';

const execFileAsync = promisify(execFile);
const sharp = createRequire(import.meta.url)('sharp') as typeof sharpFactory;

export const SHADOW_CANARY_CONFIRMATION = 'RUN_SEEDANCE_25_PAID_SHADOW_CANARY';
export const SHADOW_CANARY_MODEL = 'Seedance 2.5';
export const SHADOW_CANARY_PRICE_VERSION = 'volcengine-seedance-2026-08-10';
export const SHADOW_CANARY_EVIDENCE_RETENTION = {
  owner: 'shadow-runner-finalizer',
  retainedArtifacts: [
    'post-canary-dump',
    'redacted-ndjson-summary',
    'tos-object-index',
  ],
} as const;

const REQUIRED_MIGRATIONS = [
  '071_prompt_wizard_v6_three_routes.sql',
  '072_seedance_cost_pricing_20260810.sql',
  '073_seedance_25_generation.sql',
  '074_credit_ledger_generation_snapshots.sql',
  '075_seedance_25_duration_25.sql',
] as const;
const EXPECTED_COMBINATIONS = SEEDANCE_25_CONSUMPTION_COMBINATIONS
  .map(item => `${item.resolution}:${item.durationSeconds}`);
const TERMINAL_UPLOAD_STATUSES = new Set(['completed', 'failed', 'canceled', 'expired']);
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'canceled']);
const DEFAULT_TASK_TIMEOUT_MS = 45 * 60_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 3 * 60_000;
const INITIAL_CREDIT_BUFFER = 1_000;
const OPERATIONAL_PROVIDER_TASK_ID = Symbol('operational-provider-task-id');

interface SafetyInput {
  confirmation: string | undefined;
  apiBaseUrl: string | undefined;
  databaseUrl: string | undefined;
  expectedDatabaseName: string | undefined;
}

interface RuntimeConfig {
  apiBaseUrl: URL;
  databaseUrl: string;
  expectedDatabaseName: string;
  taskTimeoutMs: number;
  uploadTimeoutMs: number;
}

interface ConsumptionSettingRow {
  resolution: string;
  duration_seconds: number | string;
  credits: number | string;
  reference_video_credits: number | string | null;
  available: boolean;
}

interface ShadowAccount {
  id: string;
  email: string;
  password: string;
  role: 'user' | 'admin';
}

interface UploadedAsset {
  id: string;
  type: 'image' | 'video' | 'audio';
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  sizeBytes: number;
}

export interface ScenarioReference {
  assetId: string;
  role: 'reference_video' | 'reference_audio' | 'first_frame' | 'last_frame';
}

interface CanaryScenario {
  id: ShadowScenarioId;
  prompt: string;
  config: {
    mode: 'general' | 'first-last';
    aspectRatio: '9:16' | '16:9' | 'adaptive';
    resolution: '480p' | '720p';
    durationSeconds: 5 | 25;
    generateAudio: true;
  };
  references: ScenarioReference[];
  hasReferenceVideo: boolean;
  expectedLandscape?: boolean;
}

export type ShadowScenarioId =
  | 'no-reference'
  | 'reference-video'
  | 'audio-only'
  | 'first-last-adaptive'
  | '720p-25s';

export function bindCompletedOutputAsReferenceVideo(
  scenarios: Array<{ id: ShadowScenarioId; references: ScenarioReference[] }>,
  assetId: string,
) {
  if (!assetId) {
    throw canaryError('SHADOW_CANARY_REFERENCE_SOURCE_MISSING', '首项完成任务没有可复用的视频资产');
  }
  const referenceScenario = scenarios.find(scenario => scenario.id === 'reference-video');
  if (!referenceScenario) {
    throw canaryError('SHADOW_CANARY_REFERENCE_SCENARIO_MISSING', '参考视频场景不存在');
  }
  referenceScenario.references = [{ assetId, role: 'reference_video' }];
}

export const SHADOW_SCENARIO_BLUEPRINTS = [
  {
    id: 'no-reference',
    resolution: '480p',
    durationSeconds: 5,
    mode: 'general',
    aspectRatio: '9:16',
    referenceRoles: [],
    hasReferenceVideo: false,
  },
  {
    id: 'reference-video',
    resolution: '480p',
    durationSeconds: 25,
    mode: 'general',
    aspectRatio: '16:9',
    referenceRoles: ['reference_video'],
    hasReferenceVideo: true,
  },
  {
    id: 'audio-only',
    resolution: '480p',
    durationSeconds: 5,
    mode: 'general',
    aspectRatio: '9:16',
    referenceRoles: ['reference_audio'],
    hasReferenceVideo: false,
  },
  {
    id: 'first-last-adaptive',
    resolution: '480p',
    durationSeconds: 5,
    mode: 'first-last',
    aspectRatio: 'adaptive',
    referenceRoles: ['first_frame', 'last_frame'],
    hasReferenceVideo: false,
  },
  {
    id: '720p-25s',
    resolution: '720p',
    durationSeconds: 25,
    mode: 'general',
    aspectRatio: '16:9',
    referenceRoles: [],
    hasReferenceVideo: false,
  },
] as const;

interface TaskEvidenceRow {
  id: string;
  model: string;
  status: string;
  processing_stage: string;
  config: Record<string, unknown>;
  credits: number | string;
  reserved_credits: number | string;
  settled_credits: number | string;
  refunded_credits: number | string;
  credit_status: string;
  asset_id: string | null;
  object_key: string | null;
  generation_meta: Record<string, unknown> | null;
  provider_task_id: string | null;
  run_provider_task_id: string | null;
  provider_run_status: string | null;
  output_is_mp4: boolean | null;
  width: number | string | null;
  height: number | string | null;
  duration_seconds: number | string | null;
  size_bytes: number | string | null;
  usage_status: string | null;
  completion_tokens: number | string | null;
  billable_tokens: number | string | null;
  has_video_input: boolean | null;
  price_version: string | null;
  unit_price_per_million: number | string | null;
  estimated_cost: number | string | null;
  pricing_status: string | null;
  provider_terminal_at: Date | string | null;
  usage_observed_at: Date | string | null;
}

interface LedgerEvidenceRow {
  type: string;
  settlement_status: string;
  amount: number | string;
  balance: number | string;
  generation_snapshot: Record<string, unknown> | null;
}

interface ScenarioEvidence {
  [OPERATIONAL_PROVIDER_TASK_ID]: string;
  scenario: ShadowScenarioId;
  taskId: string;
  status: 'completed';
  processingStage: 'completed';
  credits: number;
  creditStatus: 'settled';
  ledger: {
    entryCount: 1;
    type: 'spend';
    settlementStatus: 'settled';
    amount: number;
    snapshot: Record<string, unknown>;
  };
  provider: {
    runStatus: 'settled';
    usageStatus: 'success';
    completionTokens: number;
    billableTokens: number;
    hasVideoInput: boolean;
    pricingStatus: 'priced';
    priceVersion: typeof SHADOW_CANARY_PRICE_VERSION;
    unitPricePerMillionCny: string;
    estimatedListPriceCny: string;
    providerTaskFingerprint: string;
    occurredAt: string;
  };
  archive: {
    assetId: string;
    format: 'mp4';
    width: number;
    height: number;
    durationSeconds: number;
    durationDeltaSeconds: number;
    sizeBytes: number;
    shortEdge: number;
    requestedShortEdge: 480 | 720;
    aspectRatio: number;
    requestedAspectRatio: number;
    aspectRatioDelta: number;
  };
}

export interface SeedanceOperationalUsageObservation {
  scenario: ShadowScenarioId;
  providerTaskId: string | null;
  occurredAt: string;
  status: 'success' | 'failed' | 'unknown';
  completionTokens: number | null;
  billableTokens: number | null;
  hasVideoInput: boolean | null;
  priceVersion: string | null;
  unitPricePerMillionCny: string | null;
  estimatedListPriceCny: string | null;
}

interface SeedanceOperationalObservationRow {
  task_provider_task_id: string | null;
  run_provider_task_id: string | null;
  run_status: string | null;
  run_submitted_at: Date | string | null;
  run_provider_terminal_at: Date | string | null;
  usage_status: string | null;
  completion_tokens: number | string | null;
  billable_tokens: number | string | null;
  has_video_input: boolean | null;
  price_version: string | null;
  unit_price_per_million: number | string | null;
  estimated_cost: number | string | null;
  pricing_status: string | null;
  usage_provider_terminal_at: Date | string | null;
  usage_observed_at: Date | string | null;
}

export function validateShadowOutputGeometry(input: {
  width: number;
  height: number;
  durationSeconds: number;
  requestedDurationSeconds: 5 | 25 | 30;
  resolution: '480p' | '720p';
  aspectRatio: '9:16' | '16:9' | 'adaptive';
}) {
  const requestedShortEdge = input.resolution === '720p' ? 720 : 480;
  const requestedAspectRatio = input.aspectRatio === '9:16' ? 9 / 16 : 16 / 9;
  const shortEdge = Math.min(input.width, input.height);
  const actualAspectRatio = input.width / input.height;
  const durationDeltaSeconds = Math.abs(input.durationSeconds - input.requestedDurationSeconds);
  const aspectRatioDelta = Math.abs(actualAspectRatio - requestedAspectRatio);
  if (durationDeltaSeconds > 1) {
    throw canaryError('SHADOW_CANARY_OUTPUT_DURATION_INVALID', '归档媒体时长与请求时长误差超过 1 秒');
  }
  if (Math.abs(shortEdge - requestedShortEdge) > 16) {
    throw canaryError('SHADOW_CANARY_OUTPUT_RESOLUTION_INVALID', '归档媒体短边与请求分辨率误差超过 16 像素');
  }
  if (aspectRatioDelta > 0.03) {
    throw canaryError('SHADOW_CANARY_OUTPUT_ASPECT_RATIO_INVALID', '归档媒体宽高比与请求或首帧宽高比不一致');
  }
  return {
    durationDeltaSeconds,
    shortEdge,
    requestedShortEdge: requestedShortEdge as 480 | 720,
    aspectRatio: actualAspectRatio,
    requestedAspectRatio,
    aspectRatioDelta,
  };
}

interface ApiResult {
  status: number;
  body: unknown;
  headers: Headers;
}

export function buildCanarySignedUploadRequest(input: {
  signature: Record<string, unknown>;
  bytes: Buffer;
  filename: string;
  contentType: string;
}) {
  const uploadUrl = safeString(input.signature.uploadUrl);
  if (!uploadUrl) {
    throw canaryError('SHADOW_CANARY_UPLOAD_SIGNATURE_INVALID', '上传签名缺少地址');
  }
  if (input.signature.driver === 'tos' && input.signature.method === 'POST') {
    if (!isRecord(input.signature.fields) || Object.keys(input.signature.fields).length === 0) {
      throw canaryError('SHADOW_CANARY_UPLOAD_SIGNATURE_INVALID', 'TOS POST 签名缺少表单字段');
    }
    const form = new FormData();
    for (const [key, value] of Object.entries(input.signature.fields)) {
      if (typeof value !== 'string') {
        throw canaryError('SHADOW_CANARY_UPLOAD_SIGNATURE_INVALID', 'TOS POST 签名包含非字符串字段');
      }
      form.append(key, value);
    }
    form.append(
      'file',
      new Blob([new Uint8Array(input.bytes)], { type: input.contentType }),
      input.filename,
    );
    return {
      driver: 'tos' as const,
      uploadUrl,
      request: { method: 'POST', body: form, redirect: 'error' as const },
    };
  }
  if (input.signature.driver === 'local' && input.signature.method === 'PUT') {
    if (!isRecord(input.signature.headers)) {
      throw canaryError('SHADOW_CANARY_UPLOAD_SIGNATURE_INVALID', '本地 PUT 签名缺少请求头');
    }
    return {
      driver: 'local' as const,
      uploadUrl,
      request: {
        method: 'PUT',
        headers: stringRecord(input.signature.headers),
        body: new Uint8Array(input.bytes),
        redirect: 'error' as const,
      },
    };
  }
  throw canaryError('SHADOW_CANARY_UPLOAD_SIGNATURE_INVALID', '上传签名方法与驱动不匹配');
}

class LoopbackApiClient {
  private cookie: string | null = null;

  constructor(private readonly baseUrl: URL) {}

  async request(
    pathname: string,
    options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<ApiResult> {
    const target = new URL(pathname, this.baseUrl);
    if (target.origin !== this.baseUrl.origin) {
      throw canaryError('SHADOW_CANARY_API_ORIGIN_ESCAPE', '影子 canary 请求试图离开回环候选 API');
    }
    const response = await fetch(target, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'manual',
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';', 1)[0] ?? null;
    const raw = await response.text();
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = { message: '候选 API 返回了非 JSON 响应' };
      }
    }
    return { status: response.status, body, headers: response.headers };
  }

  async requestOk(
    pathname: string,
    options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ) {
    const result = await this.request(pathname, options);
    if (result.status < 200 || result.status >= 300) {
      const body = isRecord(result.body) ? result.body : {};
      const code = safeString(body.code) || `HTTP_${result.status}`;
      const message = safeString(body.message) || '候选 API 请求失败';
      throw canaryError(`SHADOW_CANARY_API_${code}`, message);
    }
    return result.body;
  }
}

export function assertShadowCanarySafety(input: SafetyInput): RuntimeConfig {
  if (input.confirmation !== SHADOW_CANARY_CONFIRMATION) {
    throw canaryError(
      'SHADOW_CANARY_CONFIRMATION_REQUIRED',
      `必须显式设置 SEEDANCE_25_SHADOW_CANARY=${SHADOW_CANARY_CONFIRMATION}`,
    );
  }
  if (!input.apiBaseUrl) {
    throw canaryError('SHADOW_CANARY_API_BASE_REQUIRED', '必须显式提供回环候选 API 地址');
  }
  const apiBaseUrl = parseUrl(input.apiBaseUrl, 'SHADOW_CANARY_API_BASE_INVALID');
  const normalizedApiPath = apiBaseUrl.pathname.replace(/\/+$/u, '') || '/';
  if (
    apiBaseUrl.protocol !== 'http:'
    || !isLoopbackHostname(apiBaseUrl.hostname)
    || normalizedApiPath !== '/'
    || apiBaseUrl.username
    || apiBaseUrl.password
    || apiBaseUrl.search
    || apiBaseUrl.hash
  ) {
    throw canaryError(
      'SHADOW_CANARY_PUBLIC_API_REJECTED',
      '候选 API 必须是无凭据、无路径的 HTTP 回环地址，禁止公网或生产 API',
    );
  }

  if (!input.databaseUrl || !input.expectedDatabaseName) {
    throw canaryError(
      'SHADOW_CANARY_DATABASE_IDENTITY_REQUIRED',
      '必须同时提供影子 DATABASE_URL 与显式预期数据库名',
    );
  }
  const databaseUrl = parseUrl(input.databaseUrl, 'SHADOW_CANARY_DATABASE_URL_INVALID');
  if (databaseUrl.protocol !== 'postgres:' && databaseUrl.protocol !== 'postgresql:') {
    throw canaryError('SHADOW_CANARY_DATABASE_URL_INVALID', '影子数据库必须使用 PostgreSQL URL');
  }
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//u, ''));
  const expectedDatabaseName = input.expectedDatabaseName.trim();
  if (
    !isShadowDatabaseName(expectedDatabaseName)
    || databaseName !== expectedDatabaseName
    || !isPrivateDatabaseHostname(databaseUrl.hostname)
  ) {
    throw canaryError(
      'SHADOW_CANARY_PRODUCTION_DATABASE_REJECTED',
      '数据库名必须显式含 shadow/canary，URL 必须精确匹配且只能指向回环、私网或影子主机',
    );
  }

  return {
    apiBaseUrl,
    databaseUrl: input.databaseUrl,
    expectedDatabaseName,
    taskTimeoutMs: parseBoundedDuration(
      process.env.SEEDANCE_25_SHADOW_TASK_TIMEOUT_MS,
      DEFAULT_TASK_TIMEOUT_MS,
      60_000,
      90 * 60_000,
    ),
    uploadTimeoutMs: parseBoundedDuration(
      process.env.SEEDANCE_25_SHADOW_UPLOAD_TIMEOUT_MS,
      DEFAULT_UPLOAD_TIMEOUT_MS,
      30_000,
      15 * 60_000,
    ),
  };
}

export function redactCanaryError(error: unknown) {
  const candidate = isRecord(error) ? error : {};
  const code = safeString(candidate.code) || 'SEEDANCE_25_SHADOW_CANARY_FAILED';
  const rawMessage = safeString(candidate.message) || 'Seedance 2.5 影子 canary 失败';
  return {
    code: code.slice(0, 160),
    message: rawMessage
      .replace(/postgres(?:ql)?:\/\/\S+/giu, '[已隐藏数据库地址]')
      .replace(/https?:\/\/\S+/giu, '[已隐藏地址]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[已隐藏邮箱]')
      .replace(/authorization\s*[:=]\s*(?:bearer\s+)?\S+/giu, 'authorization=[已隐藏]')
      .replace(/bearer\s+\S+/giu, 'bearer=[已隐藏]')
      .replace(/(token|secret|password|cookie)\s*[:=]\s*\S+/giu, '$1=[已隐藏]')
      .slice(0, 500),
  };
}

export async function runSeedance25ShadowCanary() {
  // 配置缺失时必须在创建任何付费任务前失败，避免再产生无归属 canary 费用。
  const operationalUsage = requireProviderOperationalUsageManifestRuntimeConfig();
  const config = assertShadowCanarySafety({
    confirmation: process.env.SEEDANCE_25_SHADOW_CANARY,
    apiBaseUrl: process.env.SEEDANCE_25_SHADOW_API_BASE_URL,
    databaseUrl: process.env.DATABASE_URL,
    expectedDatabaseName: process.env.SEEDANCE_25_SHADOW_DATABASE_NAME,
  });
  const pool = new Pool({ connectionString: config.databaseUrl, max: 4 });
  const runId = randomUUID();
  const runFingerprint = createHash('sha256')
    .update(`${config.expectedDatabaseName}:${runId}`)
    .digest('hex')
    .slice(0, 16);
  let adminApi: LoopbackApiClient | null = null;
  let availabilityMayBeOpen = false;
  let primaryError: unknown = null;
  let result: Record<string, unknown> | null = null;
  const evidence: ScenarioEvidence[] = [];
  const operationalObservations: SeedanceOperationalUsageObservation[] = [];

  emitCanaryEvent({
    event: 'seedance-25-shadow-canary',
    phase: 'preflight',
    ok: true,
    runFingerprint,
    api: 'http-loopback',
    database: 'explicit-shadow',
  });

  try {
    const settings = await assertShadowDatabaseReady(pool, config.expectedDatabaseName);
    const selectedCredits = selectedScenarioCredits(settings);
    const initialCredits = selectedCredits.reduce((sum, credits) => sum + credits, 0) + INITIAL_CREDIT_BUFFER;
    if (!Number.isSafeInteger(initialCredits) || initialCredits <= INITIAL_CREDIT_BUFFER || initialCredits > 1_000_000) {
      throw canaryError('SHADOW_CANARY_CREDIT_GRANT_INVALID', '影子 canary 所需初始积分超出安全范围');
    }

    const accounts = await createShadowAccounts(pool, runId, initialCredits);
    const userApi = new LoopbackApiClient(config.apiBaseUrl);
    adminApi = new LoopbackApiClient(config.apiBaseUrl);

    await assertApiReady(userApi);
    await loginThroughApi(userApi, accounts.user);
    await loginThroughApi(adminApi, accounts.admin);
    await assertModelAvailability(userApi, false);
    emitCanaryEvent({
      event: 'seedance-25-shadow-canary',
      phase: 'api-database-binding',
      ok: true,
      runFingerprint,
    });

    const fixtures = await createAndUploadFixtures(userApi, runId, config.uploadTimeoutMs);
    emitCanaryEvent({
      event: 'seedance-25-shadow-canary',
      phase: 'uploads',
      ok: true,
      counts: { image: 2, video: 1, audio: 1 },
    });

    availabilityMayBeOpen = true;
    await setShadowModelAvailability(adminApi, true, runId);
    await assertModelAvailability(userApi, true);

    const scenarios = buildScenarios(fixtures);
    for (const scenario of scenarios) {
      emitCanaryEvent({
        event: 'seedance-25-shadow-canary',
        phase: 'scenario-start',
        scenario: scenario.id,
      });
      const expectedCredits = creditsForScenario(settings, scenario);
      let taskId: string | null = null;
      try {
        const task = await createScenarioTask(userApi, scenario, runId, expectedCredits);
        taskId = task.id;
        const observedStatuses = await waitForTask(userApi, task.id, scenario.id, config.taskTimeoutMs);
        const taskEvidence = await readAndVerifyScenarioEvidence(
          pool,
          scenario,
          task.id,
          expectedCredits,
        );
        evidence.push(taskEvidence);
        operationalObservations.push(operationalObservationFromScenarioEvidence(taskEvidence));
        if (scenario.id === 'no-reference') {
          bindCompletedOutputAsReferenceVideo(scenarios, taskEvidence.archive.assetId);
          emitCanaryEvent({
            event: 'seedance-25-shadow-canary',
            phase: 'reference-video-source-bound',
            ok: true,
            source: 'completed-canary-output',
          });
        }
        emitCanaryEvent({
          event: 'seedance-25-shadow-canary',
          phase: 'scenario-complete',
          scenario: scenario.id,
          taskId: task.id,
          observedStatuses,
          credits: taskEvidence.credits,
          estimatedListPriceCny: taskEvidence.provider.estimatedListPriceCny,
        });
      } catch (scenarioError) {
        const failedObservation = taskId && !operationalObservations.some(item => item.scenario === scenario.id)
          ? await readSeedanceOperationalObservation(pool, scenario.id, taskId).catch(() => null)
          : null;
        if (failedObservation) {
          operationalObservations.push(failedObservation);
          emitCanaryEvent({
            event: 'seedance-25-shadow-canary',
            phase: 'scenario-provider-evidence-recovered',
            scenario: scenario.id,
            status: failedObservation.status,
            ok: true,
          });
        }
        throw scenarioError;
      }
    }

    const accounting = await verifyRunAccounting(pool, accounts.user.id, evidence, initialCredits);
    result = {
      event: 'seedance-25-shadow-canary',
      ok: true,
      phase: 'complete',
      runFingerprint,
      model: SHADOW_CANARY_MODEL,
      scenarios: evidence,
      accounting,
      evidenceRetention: SHADOW_CANARY_EVIDENCE_RETENTION,
      productionAvailabilityChanged: false,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    if (availabilityMayBeOpen) {
      try {
        await closeShadowAvailability(pool, adminApi, runId);
        emitCanaryEvent({
          event: 'seedance-25-shadow-canary',
          phase: 'availability-restored',
          ok: true,
          availableCombinations: 0,
        });
      } catch (cleanupError) {
        primaryError = primaryError
          ? canaryError(
            'SHADOW_CANARY_PRIMARY_AND_CLEANUP_FAILED',
            `${redactCanaryError(primaryError).message}；关闭影子模型也失败：${redactCanaryError(cleanupError).message}`,
          )
          : cleanupError;
      }
    }
    await pool.end().catch(() => undefined);
  }

  if (operationalObservations.length > 0) {
    try {
      const manifest = await persistSeedanceShadowOperationalUsage(
        operationalUsage,
        operationalObservations,
      );
      emitCanaryEvent({
        event: 'seedance-25-shadow-canary',
        phase: 'operational-usage-manifest',
        ok: true,
        recordCount: manifest.recordCount,
        manifestPath: manifest.manifestPath,
        manifestSha256: manifest.manifestSha256,
        evidencePath: manifest.evidencePath,
        evidenceSha256: manifest.evidenceSha256,
      });
    } catch (manifestError) {
      primaryError = primaryError
        ? canaryError(
          'SHADOW_CANARY_PRIMARY_AND_OPERATIONAL_EVIDENCE_FAILED',
          `${redactCanaryError(primaryError).message}；运营调用证据固化失败：${redactCanaryError(manifestError).message}`,
        )
        : manifestError;
    }
  }

  if (primaryError) throw primaryError;
  if (!result) throw canaryError('SHADOW_CANARY_RESULT_MISSING', '影子 canary 未生成最终证据');
  emitCanaryEvent(result);
  return result;
}

async function assertShadowDatabaseReady(pool: Pool, expectedDatabaseName: string) {
  const identity = await pool.query<{
    database_name: string;
    server_address: string | null;
  }>(
    `SELECT current_database() AS database_name,
            inet_server_addr()::text AS server_address`,
  );
  const databaseName = identity.rows[0]?.database_name;
  if (databaseName !== expectedDatabaseName || !isShadowDatabaseName(databaseName)) {
    throw canaryError('SHADOW_CANARY_DATABASE_IDENTITY_MISMATCH', '运行时数据库身份不是显式影子库');
  }

  const migrations = await pool.query<{ id: string }>(
    'SELECT id FROM schema_migrations WHERE id = ANY($1::text[])',
    [[...REQUIRED_MIGRATIONS]],
  );
  const applied = new Set(migrations.rows.map(row => row.id));
  const missing = REQUIRED_MIGRATIONS.filter(id => !applied.has(id));
  if (missing.length) {
    throw canaryError('SHADOW_CANARY_MIGRATIONS_INCOMPLETE', `影子库缺少 ${missing.length} 个必需迁移`);
  }

  const settingsResult = await pool.query<ConsumptionSettingRow>(
    `SELECT resolution, duration_seconds, credits, reference_video_credits, available
     FROM consumption_settings
     WHERE kind = 'video' AND model = $1
     ORDER BY resolution, duration_seconds`,
    [SHADOW_CANARY_MODEL],
  );
  const settings = settingsResult.rows;
  const combinations = settings.map(row => `${row.resolution}:${Number(row.duration_seconds)}`).sort();
  if (
    settings.length !== EXPECTED_COMBINATIONS.length
    || combinations.join('|') !== [...EXPECTED_COMBINATIONS].sort().join('|')
    || settings.some(row => row.available)
    || settings.some(row => !isPositiveInteger(row.credits) || !isPositiveInteger(row.reference_video_credits))
  ) {
    throw canaryError(
      'SHADOW_CANARY_CONSUMPTION_SETTINGS_UNSAFE',
      `影子库必须恰有 ${EXPECTED_COMBINATIONS.length} 个关闭且双档积分为正整数的 Seedance 2.5 组合`,
    );
  }
  return settings;
}

async function createShadowAccounts(pool: Pool, runId: string, initialCredits: number) {
  const user = await buildShadowAccount(runId, 'user');
  const admin = await buildShadowAccount(runId, 'admin');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertShadowAccount(client, admin, 0);
    await insertShadowAccount(client, user, initialCredits);
    await ensureDefaultAssetFolders(client, user.id);
    await client.query(
      `INSERT INTO credit_lots (
         user_id, bucket, source_type, source_event_key,
         original_amount, available_amount, created_at, updated_at
       ) VALUES ($1, 'addon', 'admin-adjustment', $2, $3, $3, now(), now())`,
      [user.id, `shadow-canary-credit:${runId}`, initialCredits],
    );
    await client.query(
      `INSERT INTO credit_ledger (
         user_id, type, bucket, settlement_status, amount, balance,
         source, operator, note, business_event_key
       ) VALUES (
         $1, 'adjust', 'addon', 'settled', $2, $2,
         'Seedance 2.5 影子 canary 初始化', 'shadow-canary',
         '仅用于影子全链路验证，任务与账务证据保留', $3
       )`,
      [user.id, initialCredits, `shadow-canary-credit:${runId}`],
    );
    await client.query('COMMIT');
    return { user, admin };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function buildShadowAccount(runId: string, role: 'user' | 'admin'): Promise<ShadowAccount> {
  return {
    id: randomUUID(),
    email: `seedance25-shadow-${role}-${runId}@canary.invalid`,
    password: randomBytes(30).toString('base64url'),
    role,
  };
}

async function insertShadowAccount(client: PoolClient, account: ShadowAccount, credits: number) {
  const passwordHash = await hashPassword(account.password);
  await client.query(
    `INSERT INTO users (
       id, email, password_hash, user_name, role, status,
       plan_id, main_credits, addon_credits, total_credits,
       plan_reset_at, plan_expires_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'active',
       NULL, 0, $6, $6, NULL, NULL
     )`,
    [
      account.id,
      account.email,
      passwordHash,
      account.role === 'admin' ? 'Seedance 2.5 影子 canary 管理员' : 'Seedance 2.5 影子 canary 用户',
      account.role,
      credits,
    ],
  );
}

async function assertApiReady(api: LoopbackApiClient) {
  const health = await api.requestOk('/api/health');
  const ready = await api.requestOk('/api/ready');
  if (!isRecord(health) || health.ok !== true || !isRecord(ready) || ready.ok !== true) {
    throw canaryError('SHADOW_CANARY_API_NOT_READY', '回环候选 API 未通过健康与就绪检查');
  }
}

async function loginThroughApi(api: LoopbackApiClient, account: ShadowAccount) {
  const body = await api.requestOk('/api/auth/login', {
    method: 'POST',
    body: { email: account.email, password: account.password },
  });
  const user = isRecord(body) && isRecord(body.user) ? body.user : null;
  if (!user || user.id !== account.id || user.role !== account.role) {
    throw canaryError(
      'SHADOW_CANARY_API_DATABASE_BINDING_FAILED',
      '随机影子账号无法通过回环候选 API 登录，已拒绝继续',
    );
  }
}

async function assertModelAvailability(api: LoopbackApiClient, expected: boolean) {
  const body = await api.requestOk('/api/ai/consumption-settings?videoDuration25=1');
  if (!isRecord(body) || !Array.isArray(body.videoModels)) {
    throw canaryError('SHADOW_CANARY_CAPABILITY_METADATA_MISSING', '候选 API 未返回视频模型能力元数据');
  }
  const model = body.videoModels.find(item => isRecord(item) && item.label === SHADOW_CANARY_MODEL);
  if (!isRecord(model) || model.available !== expected) {
    throw canaryError(
      'SHADOW_CANARY_AVAILABILITY_MISMATCH',
      `候选 API 的 Seedance 2.5 可用状态不是预期的 ${String(expected)}`,
    );
  }
}

async function setShadowModelAvailability(api: LoopbackApiClient, available: boolean, runId: string) {
  const body = await api.requestOk(
    `/api/admin/consumption-settings/video-models/${encodeURIComponent(SHADOW_CANARY_MODEL)}/availability?videoDuration25=1`,
    {
      method: 'PATCH',
      headers: { 'Idempotency-Key': `shadow-canary-availability-${available ? 'open' : 'close'}-${runId}` },
      body: { available },
    },
  );
  if (!isRecord(body) || !Array.isArray(body.items)) {
    throw canaryError('SHADOW_CANARY_AVAILABILITY_RESPONSE_INVALID', '模型级开关未返回积分配置');
  }
  const rows = body.items.filter(item => isRecord(item) && item.model === SHADOW_CANARY_MODEL);
  if (rows.length !== EXPECTED_COMBINATIONS.length || rows.some(item => !isRecord(item) || item.available !== available)) {
    throw canaryError(
      'SHADOW_CANARY_AVAILABILITY_RESPONSE_INVALID',
      `模型级开关未原子切换全部 ${EXPECTED_COMBINATIONS.length} 个组合`,
    );
  }
}

async function closeShadowAvailability(
  pool: Pool,
  adminApi: LoopbackApiClient | null,
  runId: string,
) {
  let apiFailure: unknown = null;
  if (adminApi) {
    try {
      await setShadowModelAvailability(adminApi, false, runId);
    } catch (error) {
      apiFailure = error;
    }
  }
  const countResult = await pool.query<{ count: number | string }>(
    `SELECT count(*)::integer AS count
     FROM consumption_settings
     WHERE kind = 'video' AND model = $1 AND available = true`,
    [SHADOW_CANARY_MODEL],
  );
  if (Number(countResult.rows[0]?.count ?? 0) > 0) {
    // 运行前已经用数据库身份、迁移、初始关闭状态及随机登录绑定完成影子证明；
    // API 不可用时只在该影子库执行紧急关闭，绝不删除任务、流水或成本证据。
    await pool.query(
      `UPDATE consumption_settings
       SET available = false, updated_at = now()
       WHERE kind = 'video' AND model = $1 AND available = true`,
      [SHADOW_CANARY_MODEL],
    );
  }
  const finalCount = await pool.query<{ count: number | string }>(
    `SELECT count(*)::integer AS count
     FROM consumption_settings
     WHERE kind = 'video' AND model = $1 AND available = true`,
    [SHADOW_CANARY_MODEL],
  );
  if (Number(finalCount.rows[0]?.count ?? 0) !== 0) {
    throw canaryError('SHADOW_CANARY_AVAILABILITY_CLEANUP_FAILED', '影子库 Seedance 2.5 未能恢复为全量关闭');
  }
  if (apiFailure) {
    emitCanaryEvent({
      event: 'seedance-25-shadow-canary',
      phase: 'availability-api-fallback',
      ok: true,
      reason: redactCanaryError(apiFailure).code,
    });
  }
}

async function createAndUploadFixtures(
  api: LoopbackApiClient,
  runId: string,
  uploadTimeoutMs: number,
) {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), 'seedance25-shadow-'));
  try {
    const [firstFrame, lastFrame] = await Promise.all([
      sharp({
        create: { width: 640, height: 360, channels: 3, background: { r: 24, g: 104, b: 176 } },
      }).png().toBuffer(),
      sharp({
        create: { width: 640, height: 360, channels: 3, background: { r: 232, g: 128, b: 32 } },
      }).png().toBuffer(),
    ]);
    const videoPath = path.join(fixtureDir, 'reference.mp4');
    await execFileAsync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24',
      '-t', '2', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', videoPath,
    ], { timeout: 60_000, maxBuffer: 1_000_000 });
    const referenceVideo = await readFile(videoPath);
    const referenceAudio = createWavFixture(2, 16_000, 440);

    const [firstFrameAsset, lastFrameAsset, videoAsset, audioAsset] = await Promise.all([
      uploadAsset(api, {
        filename: `shadow-first-${runId}.png`, contentType: 'image/png',
        source: 'uploaded-image', bytes: firstFrame, expectedType: 'image', runId,
      }, uploadTimeoutMs),
      uploadAsset(api, {
        filename: `shadow-last-${runId}.png`, contentType: 'image/png',
        source: 'uploaded-image', bytes: lastFrame, expectedType: 'image', runId,
      }, uploadTimeoutMs),
      uploadAsset(api, {
        filename: `shadow-reference-${runId}.mp4`, contentType: 'video/mp4',
        source: 'uploaded-video', bytes: referenceVideo, expectedType: 'video', runId,
      }, uploadTimeoutMs),
      uploadAsset(api, {
        filename: `shadow-audio-${runId}.wav`, contentType: 'audio/wav',
        source: 'uploaded-audio', bytes: referenceAudio, expectedType: 'audio', runId,
      }, uploadTimeoutMs),
    ]);
    if (
      firstFrameAsset.width !== 640 || firstFrameAsset.height !== 360
      || lastFrameAsset.width !== 640 || lastFrameAsset.height !== 360
      || (videoAsset.durationSeconds ?? 0) <= 0
      || (audioAsset.durationSeconds ?? 0) <= 0
    ) {
      throw canaryError('SHADOW_CANARY_UPLOAD_METADATA_INVALID', '上传素材的探测元数据不完整');
    }
    return { firstFrameAsset, lastFrameAsset, videoAsset, audioAsset };
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

async function uploadAsset(
  api: LoopbackApiClient,
  input: {
    filename: string;
    contentType: string;
    source: 'uploaded-image' | 'uploaded-video' | 'uploaded-audio';
    bytes: Buffer;
    expectedType: UploadedAsset['type'];
    runId: string;
  },
  timeoutMs: number,
) {
  const signatureBody = await api.requestOk('/api/assets/upload-signature', {
    method: 'POST',
    body: {
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
      source: input.source,
      folderId: null,
      idempotencyKey: `shadow-canary-upload-${input.expectedType}-${
        createHash('sha256').update(input.filename).digest('hex').slice(0, 12)
      }-${input.runId}`,
    },
  });
  const signature = isRecord(signatureBody) && isRecord(signatureBody.signature)
    ? signatureBody.signature
    : null;
  if (
    !signature
    || signature.driver !== 'tos'
    || signature.method !== 'POST'
    || !safeString(signature.uploadUrl)
    || !isRecord(signature.headers)
    || Object.keys(signature.headers).length !== 0
    || !isRecord(signature.fields)
    || Object.keys(signature.fields).length === 0
    || !safeString(signature.sessionId)
  ) {
    throw canaryError(
      'SHADOW_CANARY_TOS_SIGNATURE_REQUIRED',
      '真实影子 canary 必须经候选 API 获得私有 TOS multipart POST 签名',
    );
  }
  const signedUpload = buildCanarySignedUploadRequest({
    signature,
    bytes: input.bytes,
    filename: input.filename,
    contentType: input.contentType,
  });
  const uploadResponse = await fetch(signedUpload.uploadUrl, signedUpload.request);
  if (![200, 201, 204].includes(uploadResponse.status)) {
    throw canaryError('SHADOW_CANARY_SIGNED_UPLOAD_FAILED', `签名上传返回 HTTP ${uploadResponse.status}`);
  }
  await api.requestOk('/api/assets/complete-upload', {
    method: 'POST',
    body: { uploadSessionId: safeString(signature.sessionId) },
  });

  const deadline = Date.now() + timeoutMs;
  let session: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    const current = await api.requestOk(`/api/assets/upload-sessions/${safeString(signature.sessionId)}`);
    session = isRecord(current) && isRecord(current.session) ? current.session : null;
    const status = safeString(session?.status);
    if (TERMINAL_UPLOAD_STATUSES.has(status)) break;
    await delay(1_000);
  }
  if (!session || session.status !== 'completed' || !isRecord(session.asset)) {
    throw canaryError(
      'SHADOW_CANARY_UPLOAD_PROCESSING_FAILED',
      `素材处理未完成：${safeString(session?.status) || 'timeout'}`,
    );
  }
  const asset = session.asset;
  if (asset.type !== input.expectedType || !safeString(asset.id)) {
    throw canaryError('SHADOW_CANARY_UPLOAD_ASSET_INVALID', '上传完成后的资产类型或 ID 不正确');
  }
  return {
    id: safeString(asset.id),
    type: input.expectedType,
    durationSeconds: nullableFiniteNumber(asset.durationSeconds),
    width: nullableFiniteNumber(asset.width),
    height: nullableFiniteNumber(asset.height),
    sizeBytes: positiveInteger(asset.sizeBytes, 'SHADOW_CANARY_UPLOAD_SIZE_INVALID'),
  } satisfies UploadedAsset;
}

function buildScenarios(fixtures: Awaited<ReturnType<typeof createAndUploadFixtures>>): CanaryScenario[] {
  return [
    {
      id: 'no-reference',
      prompt: '清晨窗边的一只白色陶瓷杯，柔和自然光，缓慢推进镜头，生成有声测试视频。',
      config: { mode: 'general', aspectRatio: '9:16', resolution: '480p', durationSeconds: 5, generateAudio: true },
      references: [], hasReferenceVideo: false,
    },
    {
      id: 'reference-video',
      prompt: '参考 @视频1 的画面节奏与镜头运动，生成完整二十五秒的简洁明亮产品展示片。',
      config: { mode: 'general', aspectRatio: '16:9', resolution: '480p', durationSeconds: 25, generateAudio: true },
      references: [{ assetId: fixtures.videoAsset.id, role: 'reference_video' }],
      hasReferenceVideo: true,
    },
    {
      id: 'audio-only',
      prompt: '根据 @音频1 的节奏生成抽象蓝色光带缓慢流动的画面，镜头平稳，原生有声。',
      config: { mode: 'general', aspectRatio: '9:16', resolution: '480p', durationSeconds: 5, generateAudio: true },
      references: [{ assetId: fixtures.audioAsset.id, role: 'reference_audio' }],
      hasReferenceVideo: false,
    },
    {
      id: 'first-last-adaptive',
      prompt: '从蓝色简洁背景平滑过渡到橙色简洁背景，保持横向构图与平稳运镜。',
      config: { mode: 'first-last', aspectRatio: 'adaptive', resolution: '480p', durationSeconds: 5, generateAudio: true },
      references: [
        { assetId: fixtures.firstFrameAsset.id, role: 'first_frame' },
        { assetId: fixtures.lastFrameAsset.id, role: 'last_frame' },
      ],
      hasReferenceVideo: false,
      expectedLandscape: true,
    },
    {
      id: '720p-25s',
      prompt: '宁静海面在日出光线中缓慢变化，固定主体、连续平滑运镜、自然环境声，完整二十五秒。',
      config: { mode: 'general', aspectRatio: '16:9', resolution: '720p', durationSeconds: 25, generateAudio: true },
      references: [], hasReferenceVideo: false,
    },
  ];
}

async function createScenarioTask(
  api: LoopbackApiClient,
  scenario: CanaryScenario,
  runId: string,
  expectedCredits: number,
) {
  const body = await api.requestOk('/api/ai/video-tasks/batch', {
    method: 'POST',
    body: {
      idempotencyKey: `shadow-canary-${scenario.id}-${runId}`,
      requests: [{
        model: SHADOW_CANARY_MODEL,
        prompt: scenario.prompt,
        config: scenario.config,
        references: scenario.references,
      }],
    },
  });
  const tasks = isRecord(body) && Array.isArray(body.tasks) ? body.tasks : [];
  const task = tasks.length === 1 && isRecord(tasks[0]) ? tasks[0] : null;
  if (
    !task
    || !safeString(task.id)
    || task.model !== SHADOW_CANARY_MODEL
    || Number(task.credits) !== expectedCredits
    || task.creditStatus !== 'held'
  ) {
    throw canaryError('SHADOW_CANARY_TASK_CREATION_INVALID', `${scenario.id} 创建结果或预扣积分不正确`);
  }
  return { id: safeString(task.id) };
}

async function waitForTask(
  api: LoopbackApiClient,
  taskId: string,
  scenario: ShadowScenarioId,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  const observed = new Set<string>();
  while (Date.now() < deadline) {
    const body = await api.requestOk(`/api/ai/tasks/${taskId}`);
    const task = isRecord(body) && isRecord(body.task) ? body.task : null;
    const status = safeString(task?.status);
    const processingStage = safeString(task?.processingStage);
    if (status) observed.add(status);
    if (processingStage) observed.add(`stage:${processingStage}`);
    if (TERMINAL_TASK_STATUSES.has(status)) {
      if (status !== 'completed') {
        throw canaryError(
          'SHADOW_CANARY_TASK_TERMINAL_FAILURE',
          `${scenario} 生成失败：${safeString(task?.failureReason) || status}`,
        );
      }
      return [...observed];
    }
    await delay(5_000);
  }
  throw canaryError('SHADOW_CANARY_TASK_TIMEOUT', `${scenario} 在安全超时内没有完成`);
}

async function readAndVerifyScenarioEvidence(
  pool: Pool,
  scenario: CanaryScenario,
  taskId: string,
  expectedCredits: number,
): Promise<ScenarioEvidence> {
  const taskResult = await pool.query<TaskEvidenceRow>(
    `SELECT task.id, task.model, task.status, task.processing_stage, task.config,
            task.credits, task.reserved_credits, task.settled_credits,
            task.refunded_credits, task.credit_status, task.asset_id,
            task.provider_task_id, run.provider_task_id AS run_provider_task_id,
            run.status AS provider_run_status,
            CASE WHEN asset.id IS NULL THEN NULL ELSE lower(asset.object_key) LIKE '%.mp4' END AS output_is_mp4,
            asset.object_key, asset.generation_meta,
            asset.width, asset.height, asset.duration_seconds, asset.size_bytes,
            usage.status AS usage_status, usage.completion_tokens, usage.billable_tokens,
            usage.has_video_input, usage.price_version, usage.unit_price_per_million,
            usage.estimated_cost, usage.pricing_status,
            usage.provider_terminal_at, usage.usage_observed_at
     FROM generation_tasks task
     LEFT JOIN generation_provider_runs run ON run.id = task.active_provider_run_id
     LEFT JOIN assets asset ON asset.id = task.asset_id
     LEFT JOIN LATERAL (
       SELECT record.*
       FROM provider_usage_records record
       WHERE record.task_id = task.id
       ORDER BY record.attempt DESC, record.created_at DESC
       LIMIT 1
     ) usage ON true
     WHERE task.id = $1`,
    [taskId],
  );
  const task = taskResult.rows[0];
  if (!task) throw canaryError('SHADOW_CANARY_TASK_EVIDENCE_MISSING', `${scenario.id} 的任务证据不存在`);

  const config = isRecord(task.config) ? task.config : {};
  const expectedRoles = scenario.references.map(reference => reference.role);
  const actualReferences = Array.isArray(config.referenceAssets)
    ? config.referenceAssets.filter(isRecord)
    : [];
  const actualRoles = actualReferences.map(reference => safeString(reference.role));
  if (
    task.model !== SHADOW_CANARY_MODEL
    || task.status !== 'completed'
    || task.processing_stage !== 'completed'
    || task.credit_status !== 'settled'
    || Number(task.credits) !== expectedCredits
    || Number(task.reserved_credits) !== expectedCredits
    || Number(task.settled_credits) !== expectedCredits
    || Number(task.refunded_credits) !== 0
    || config.mode !== scenario.config.mode
    || config.aspectRatio !== scenario.config.aspectRatio
    || config.resolution !== scenario.config.resolution
    || Number(config.durationSeconds) !== scenario.config.durationSeconds
    || config.generateAudio !== true
    || actualRoles.join('|') !== expectedRoles.join('|')
  ) {
    throw canaryError('SHADOW_CANARY_TASK_SNAPSHOT_INVALID', `${scenario.id} 的任务快照与提交规格不一致`);
  }
  const providerTaskId = safeString(task.provider_task_id);
  const runProviderTaskId = safeString(task.run_provider_task_id);
  if (!providerTaskId || providerTaskId !== runProviderTaskId) {
    throw canaryError(
      'SHADOW_CANARY_PROVIDER_TASK_ID_INVALID',
      `${scenario.id} 缺少一致且非空的供应商任务 ID`,
    );
  }
  const providerTaskFingerprint = `sha256:${createHash('sha256')
    .update(providerTaskId)
    .digest('hex')
    .slice(0, 16)}`;
  const occurredAtValue = task.provider_terminal_at ?? task.usage_observed_at;
  const occurredAtDate = occurredAtValue ? new Date(occurredAtValue) : null;
  if (!occurredAtDate || !Number.isFinite(occurredAtDate.getTime())) {
    throw canaryError(
      'SHADOW_CANARY_PROVIDER_OCCURRED_AT_MISSING',
      `${scenario.id} 缺少供应商终态或用量观察时间`,
    );
  }
  const occurredAt = occurredAtDate.toISOString();

  const assetId = safeString(task.asset_id);
  const width = positiveInteger(task.width, 'SHADOW_CANARY_ARCHIVE_METADATA_INVALID');
  const height = positiveInteger(task.height, 'SHADOW_CANARY_ARCHIVE_METADATA_INVALID');
  const durationSeconds = positiveFiniteNumber(task.duration_seconds, 'SHADOW_CANARY_ARCHIVE_METADATA_INVALID');
  const sizeBytes = positiveInteger(task.size_bytes, 'SHADOW_CANARY_ARCHIVE_METADATA_INVALID');
  if (!assetId || task.output_is_mp4 !== true) {
    throw canaryError('SHADOW_CANARY_ARCHIVE_METADATA_INVALID', `${scenario.id} 未归档为 MP4 数字资产`);
  }
  const generationMeta = isRecord(task.generation_meta) ? task.generation_meta : {};
  if (generationMeta.durationSource !== 'media-probe') {
    throw canaryError(
      'SHADOW_CANARY_ARCHIVE_PROBE_EVIDENCE_MISSING',
      `${scenario.id} 的归档时长不是由媒体探测得出`,
    );
  }
  const decoded = await inspectArchivedVideo(safeString(task.object_key));
  if (
    !decoded.hasVideo
    || !decoded.hasAudio
    || !decoded.formatName
    || (!decoded.formatName.toLowerCase().includes('mp4') && !decoded.formatName.toLowerCase().includes('mov'))
    || decoded.width !== width
    || decoded.height !== height
    || decoded.durationSeconds === null
    || Math.abs(decoded.durationSeconds - durationSeconds) > 0.5
  ) {
    throw canaryError(
      'SHADOW_CANARY_ARCHIVE_AUDIO_VIDEO_INVALID',
      `${scenario.id} 的归档对象无法完整证明 MP4 视频流、音轨与数据库探测元数据一致`,
    );
  }
  if (scenario.expectedLandscape && width <= height) {
    throw canaryError(
      'SHADOW_CANARY_ADAPTIVE_DIMENSIONS_INVALID',
      '首尾帧 adaptive 输出没有保持首帧的横向宽高关系',
    );
  }
  const geometry = validateShadowOutputGeometry({
    width,
    height,
    durationSeconds: decoded.durationSeconds,
    requestedDurationSeconds: scenario.config.durationSeconds,
    resolution: scenario.config.resolution,
    aspectRatio: scenario.config.aspectRatio,
  });

  const completionTokens = positiveInteger(task.completion_tokens, 'SHADOW_CANARY_PROVIDER_COST_INCOMPLETE');
  const billableTokens = positiveInteger(task.billable_tokens, 'SHADOW_CANARY_PROVIDER_COST_INCOMPLETE');
  const expectedUnitPrice = scenario.hasReferenceVideo ? 42 : 70;
  const estimatedCostIsExact = isExactCanaryEstimatedListPrice({
    billableTokens,
    unitPricePerMillionCny: expectedUnitPrice,
    estimatedCostCny: task.estimated_cost,
  });
  if (
    task.provider_run_status !== 'settled'
    || task.usage_status !== 'success'
    || completionTokens !== billableTokens
    || task.has_video_input !== scenario.hasReferenceVideo
    || task.pricing_status !== 'priced'
    || task.price_version !== SHADOW_CANARY_PRICE_VERSION
    || Number(task.unit_price_per_million) !== expectedUnitPrice
    || !estimatedCostIsExact
  ) {
    throw canaryError(
      'SHADOW_CANARY_PROVIDER_COST_INCOMPLETE',
      `${scenario.id} 的 completion tokens、刊例价版本或供应商估算成本不完整`,
    );
  }

  const ledgerResult = await pool.query<LedgerEvidenceRow>(
    `SELECT type, settlement_status, amount, balance, generation_snapshot
     FROM credit_ledger
     WHERE related_job_id = $1
     ORDER BY created_at, id`,
    [taskId],
  );
  const ledger = ledgerResult.rows[0];
  const snapshot = ledger && isRecord(ledger.generation_snapshot) ? ledger.generation_snapshot : null;
  if (
    ledgerResult.rows.length !== 1
    || !ledger
    || ledger.type !== 'spend'
    || ledger.settlement_status !== 'settled'
    || Number(ledger.amount) !== -expectedCredits
    || !snapshot
    || snapshot.model !== SHADOW_CANARY_MODEL
    || Number(snapshot.durationSeconds) !== scenario.config.durationSeconds
    || snapshot.resolution !== scenario.config.resolution
    || snapshot.hasReferenceVideo !== scenario.hasReferenceVideo
    || Number(snapshot.reservedCredits) !== expectedCredits
    || Number(snapshot.settledCredits) !== expectedCredits
    || Number(snapshot.refundedCredits) !== 0
    || snapshot.taskStatus !== 'completed'
    || snapshot.creditStatus !== 'settled'
  ) {
    throw canaryError('SHADOW_CANARY_LEDGER_SNAPSHOT_INVALID', `${scenario.id} 的实扣流水或不可变快照不正确`);
  }

  return {
    [OPERATIONAL_PROVIDER_TASK_ID]: providerTaskId,
    scenario: scenario.id,
    taskId,
    status: 'completed',
    processingStage: 'completed',
    credits: expectedCredits,
    creditStatus: 'settled',
    ledger: {
      entryCount: 1,
      type: 'spend',
      settlementStatus: 'settled',
      amount: Number(ledger.amount),
      snapshot,
    },
    provider: {
      runStatus: 'settled',
      usageStatus: 'success',
      completionTokens,
      billableTokens,
      hasVideoInput: scenario.hasReferenceVideo,
      pricingStatus: 'priced',
      priceVersion: SHADOW_CANARY_PRICE_VERSION,
      unitPricePerMillionCny: sixDecimal(task.unit_price_per_million),
      estimatedListPriceCny: sixDecimal(task.estimated_cost),
      providerTaskFingerprint,
      occurredAt,
    },
    archive: {
      assetId,
      format: 'mp4',
      width,
      height,
      durationSeconds,
      durationDeltaSeconds: geometry.durationDeltaSeconds,
      sizeBytes,
      shortEdge: geometry.shortEdge,
      requestedShortEdge: geometry.requestedShortEdge,
      aspectRatio: geometry.aspectRatio,
      requestedAspectRatio: geometry.requestedAspectRatio,
      aspectRatioDelta: geometry.aspectRatioDelta,
    },
  };
}

function operationalObservationFromScenarioEvidence(
  evidence: ScenarioEvidence,
): SeedanceOperationalUsageObservation {
  return {
    scenario: evidence.scenario,
    providerTaskId: evidence[OPERATIONAL_PROVIDER_TASK_ID],
    occurredAt: evidence.provider.occurredAt,
    status: 'success',
    completionTokens: evidence.provider.completionTokens,
    billableTokens: evidence.provider.billableTokens,
    hasVideoInput: evidence.provider.hasVideoInput,
    priceVersion: evidence.provider.priceVersion,
    unitPricePerMillionCny: evidence.provider.unitPricePerMillionCny,
    estimatedListPriceCny: evidence.provider.estimatedListPriceCny,
  };
}

export async function readSeedanceOperationalObservation(
  pool: Pool,
  scenario: ShadowScenarioId,
  taskId: string,
): Promise<SeedanceOperationalUsageObservation | null> {
  const result = await pool.query<SeedanceOperationalObservationRow>(
    `SELECT task.provider_task_id AS task_provider_task_id,
            run.provider_task_id AS run_provider_task_id,
            run.status AS run_status,
            run.submitted_at AS run_submitted_at,
            run.provider_terminal_at AS run_provider_terminal_at,
            usage.status AS usage_status,
            usage.completion_tokens,
            usage.billable_tokens,
            usage.has_video_input,
            usage.price_version,
            usage.unit_price_per_million,
            usage.estimated_cost,
            usage.pricing_status,
            usage.provider_terminal_at AS usage_provider_terminal_at,
            usage.usage_observed_at
     FROM generation_tasks task
     LEFT JOIN generation_provider_runs run ON run.id = task.active_provider_run_id
     LEFT JOIN LATERAL (
       SELECT record.*
       FROM provider_usage_records record
       WHERE record.task_id = task.id
       ORDER BY record.attempt DESC, record.created_at DESC
       LIMIT 1
     ) usage ON true
     WHERE task.id = $1`,
    [taskId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const taskProviderTaskId = safeString(row.task_provider_task_id);
  const runProviderTaskId = safeString(row.run_provider_task_id);
  if (taskProviderTaskId && runProviderTaskId && taskProviderTaskId !== runProviderTaskId) return null;
  const providerTaskId = taskProviderTaskId || runProviderTaskId || null;
  if (providerTaskId && /^sha256:[0-9a-f]{16,64}$/.test(providerTaskId)) return null;
  const submissionStarted = row.run_submitted_at !== null;
  if (!providerTaskId && !submissionStarted) return null;

  const occurredAtValue = row.usage_provider_terminal_at
    ?? row.usage_observed_at
    ?? row.run_provider_terminal_at
    ?? row.run_submitted_at;
  const occurredAtDate = occurredAtValue ? new Date(occurredAtValue) : null;
  if (!occurredAtDate || !Number.isFinite(occurredAtDate.getTime())) return null;
  const priceVersion = row.pricing_status === 'priced' ? safeString(row.price_version) || null : null;
  const unitPricePerMillionCny = row.pricing_status === 'priced'
    ? sixDecimal(row.unit_price_per_million) || null
    : null;
  const estimatedListPriceCny = row.pricing_status === 'priced'
    ? sixDecimal(row.estimated_cost) || null
    : null;
  return {
    scenario,
    providerTaskId,
    occurredAt: occurredAtDate.toISOString(),
    status: row.usage_status === 'success'
      ? 'success'
      : row.usage_status === 'failed' || row.run_status === 'provider-failed'
        ? 'failed'
        : 'unknown',
    completionTokens: nonnegativeSafeIntegerOrNull(row.completion_tokens),
    billableTokens: nonnegativeSafeIntegerOrNull(row.billable_tokens),
    hasVideoInput: typeof row.has_video_input === 'boolean' ? row.has_video_input : null,
    priceVersion,
    unitPricePerMillionCny,
    estimatedListPriceCny,
  };
}

async function inspectArchivedVideo(objectKey: string) {
  if (!objectKey) {
    throw canaryError('SHADOW_CANARY_ARCHIVE_OBJECT_MISSING', '归档对象路径缺失');
  }
  const [{ createObjectReadUrl }, { probeMedia, validateMediaDecoding }] = await Promise.all([
    import('../storage/storageService.js'),
    import('../storage/mediaProcessor.js'),
  ]);
  const processingInput = await createObjectReadUrl(objectKey, 15 * 60);
  const metadata = await probeMedia(processingInput);
  await validateMediaDecoding(processingInput, 'video');
  return metadata;
}

async function verifyRunAccounting(
  pool: Pool,
  userId: string,
  evidence: ScenarioEvidence[],
  initialCredits: number,
) {
  const expectedSpent = evidence.reduce((sum, item) => sum + item.credits, 0);
  const expectedBalance = initialCredits - expectedSpent;
  const result = await pool.query<{
    main_credits: number | string;
    addon_credits: number | string;
    total_credits: number | string;
    lot_available: number | string;
    lot_consumed: number | string;
    generation_spend_count: number | string;
  }>(
    `SELECT users.main_credits, users.addon_credits, users.total_credits,
            coalesce(sum(lots.available_amount), 0)::integer AS lot_available,
            coalesce(sum(lots.consumed_amount), 0)::integer AS lot_consumed,
            (SELECT count(*)::integer FROM credit_ledger ledger
             WHERE ledger.user_id = users.id AND ledger.type = 'spend'
               AND ledger.related_job_id = ANY($2::uuid[])) AS generation_spend_count
     FROM users
     LEFT JOIN credit_lots lots ON lots.user_id = users.id
     WHERE users.id = $1
     GROUP BY users.id`,
    [userId, evidence.map(item => item.taskId)],
  );
  const row = result.rows[0];
  if (
    !row
    || Number(row.main_credits) !== 0
    || Number(row.addon_credits) !== expectedBalance
    || Number(row.total_credits) !== expectedBalance
    || Number(row.lot_available) !== expectedBalance
    || Number(row.lot_consumed) !== expectedSpent
    || Number(row.generation_spend_count) !== evidence.length
  ) {
    throw canaryError('SHADOW_CANARY_ACCOUNTING_INVARIANT_FAILED', '五个任务完成后的用户余额、lot 与实扣流水不一致');
  }
  return {
    initialCredits,
    settledCredits: expectedSpent,
    refundedCredits: 0,
    remainingCredits: expectedBalance,
    spendEntries: evidence.length,
  };
}

function selectedScenarioCredits(settings: ConsumptionSettingRow[]) {
  return SHADOW_SCENARIO_BLUEPRINTS.map(scenario => creditsFromSettings(
    settings,
    scenario.resolution,
    scenario.durationSeconds,
    scenario.hasReferenceVideo,
  ));
}

function creditsForScenario(settings: ConsumptionSettingRow[], scenario: CanaryScenario) {
  return creditsFromSettings(
    settings,
    scenario.config.resolution,
    scenario.config.durationSeconds,
    scenario.hasReferenceVideo,
  );
}

function creditsFromSettings(
  settings: ConsumptionSettingRow[],
  resolution: string,
  durationSeconds: number,
  hasReferenceVideo: boolean,
) {
  const row = settings.find(item => (
    item.resolution === resolution && Number(item.duration_seconds) === durationSeconds
  ));
  const credits = Number(hasReferenceVideo ? row?.reference_video_credits : row?.credits);
  if (!Number.isSafeInteger(credits) || credits <= 0) {
    throw canaryError('SHADOW_CANARY_PRICE_SETTING_MISSING', '影子 canary 所需积分组合不存在或未定价');
  }
  return credits;
}

function createWavFixture(seconds: number, sampleRate: number, frequency: number) {
  const samples = Math.floor(seconds * sampleRate);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples; index += 1) {
    const amplitude = Math.round(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 8_000);
    buffer.writeInt16LE(amplitude, 44 + index * 2);
  }
  return buffer;
}

function parseUrl(value: string, code: string) {
  try {
    return new URL(value);
  } catch {
    throw canaryError(code, '地址格式无效');
  }
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  return normalized === 'localhost'
    || normalized === '::1'
    || /^127(?:\.\d{1,3}){3}$/u.test(normalized);
}

function isPrivateDatabaseHostname(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (isLoopbackHostname(normalized)) return true;
  if (/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u.test(normalized)) return true;
  return /(?:^|[.-])(shadow|canary)(?:[.-]|$)/u.test(normalized)
    || normalized.endsWith('.internal');
}

function isShadowDatabaseName(value: string | undefined): value is string {
  if (!value || !/^[a-zA-Z][a-zA-Z0-9_-]{2,62}$/u.test(value)) return false;
  return /(?:^|[_-])(shadow|canary)(?:[_-]|$)/iu.test(value)
    && !/^lindyson$/iu.test(value)
    && !/(^|[_-])prod(?:uction)?($|[_-])/iu.test(value);
}

function parseBoundedDuration(value: string | undefined, fallback: number, min: number, max: number) {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw canaryError('SHADOW_CANARY_TIMEOUT_INVALID', `超时必须是 ${min} 到 ${max} 毫秒之间的整数`);
  }
  return parsed;
}

async function persistSeedanceShadowOperationalUsage(
  config: ProviderOperationalUsageManifestRuntimeConfig,
  observations: SeedanceOperationalUsageObservation[],
) {
  return writeProviderOperationalUsageCanaryBundle({
    manifestPath: config.outputPath,
    manifestId: `${config.sourceRunId}-provider-operational-usage-v1`,
    evidence: {
      evidenceKind: 'seedance-25-shadow-provider-observations/v1',
      sourceRunId: config.sourceRunId,
      observations: observations.map(item => ({
        scenario: item.scenario,
        occurredAt: item.occurredAt,
        status: item.status,
        providerTaskId: item.providerTaskId,
        completionTokens: item.completionTokens,
        billableTokens: item.billableTokens,
        hasVideoInput: item.hasVideoInput,
        priceVersion: item.priceVersion,
        unitPricePerMillionCny: item.unitPricePerMillionCny,
        estimatedListPriceCny: item.estimatedListPriceCny,
      })),
    },
    buildRecords: writtenEvidence => observations.map(item => (
      seedanceShadowCanaryOperationalUsageRecord({
        costOwnerUserId: config.costOwnerUserId,
        sourceRunId: config.sourceRunId,
        sourceItemKey: item.scenario,
        occurredAt: item.occurredAt,
        evidencePath: writtenEvidence.evidencePath,
        evidenceSha256: writtenEvidence.evidenceSha256,
        scenario: item.scenario,
        providerTaskId: item.providerTaskId,
        model: SHADOW_CANARY_MODEL,
        completionTokens: item.completionTokens,
        billableTokens: item.billableTokens,
        hasVideoInput: item.hasVideoInput,
        priceVersion: item.priceVersion,
        unitPricePerMillionCny: item.unitPricePerMillionCny,
        estimatedCostCny: item.estimatedListPriceCny,
        status: item.status,
      })
    )),
  });
}

function positiveInteger(value: unknown, code: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw canaryError(code, '预期正整数证据缺失');
  return parsed;
}

function positiveFiniteNumber(value: unknown, code: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw canaryError(code, '预期正数证据缺失');
  return parsed;
}

function nullableFiniteNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonnegativeSafeIntegerOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isPositiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0;
}

export function isExactCanaryEstimatedListPrice(input: {
  billableTokens: number;
  unitPricePerMillionCny: number;
  estimatedCostCny: unknown;
}) {
  const expected = calculateCanaryEstimatedListPrice(
    input.billableTokens,
    input.unitPricePerMillionCny,
  );
  return expected !== '' && sixDecimal(input.estimatedCostCny) === expected;
}

export function calculateCanaryEstimatedListPrice(
  billableTokens: number,
  unitPricePerMillionCny: number,
) {
  if (
    !Number.isSafeInteger(billableTokens)
    || billableTokens < 0
    || !Number.isSafeInteger(unitPricePerMillionCny)
    || unitPricePerMillionCny <= 0
  ) return '';
  const cnyMicros = BigInt(billableTokens) * BigInt(unitPricePerMillionCny);
  const whole = cnyMicros / 1_000_000n;
  const fraction = (cnyMicros % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${fraction}`;
}

function sixDecimal(value: unknown) {
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+)(?:\.(\d{1,6}))?$/u);
    if (!match) return '';
    const whole = BigInt(match[1]!).toString();
    return `${whole}.${(match[2] ?? '').padEnd(6, '0')}`;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return '';
  return parsed.toFixed(6);
}

function safeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringRecord(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => (
      typeof item === 'string' ? [[key, item] as const] : []
    )),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canaryError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function delay(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function emitCanaryEvent(event: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function main() {
  try {
    await runSeedance25ShadowCanary();
  } catch (error) {
    emitCanaryEvent({
      event: 'seedance-25-shadow-canary',
      ok: false,
      error: redactCanaryError(error),
    });
    process.exitCode = 1;
  }
}

function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry!) === fileURLToPath(import.meta.url);
}

if (isMainModule()) void main();
