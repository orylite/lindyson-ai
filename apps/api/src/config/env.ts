import { hkdfSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

loadLocalEnv();

const optionalString = z.preprocess(
  value => value === '' ? undefined : value,
  z.string().optional(),
);

const optionalUrl = z.preprocess(
  value => value === '' ? undefined : value,
  z.string().url().optional(),
);

const booleanString = z.preprocess(value => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  return value;
}, z.boolean());

/**
 * 反向代理信任设置，语义与 Fastify 的 trustProxy 一致：
 * - `false`：不信任任何代理头（API 直接暴露时用）；
 * - `true`：信任所有上游，只能在 API 端口完全不可直连时使用；
 * - 正整数：信任最近的 N 跳代理；
 * - 逗号分隔的 IP / CIDR 列表：只信任这些地址发来的 X-Forwarded-* 头，生产推荐。
 */
export const trustProxySetting = z.preprocess(value => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim();
  const lowered = normalized.toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(lowered)) return lowered === '1' ? 1 : true;
  if (['false', '0', 'no', 'off', ''].includes(lowered)) return false;
  if (/^[1-9]\d*$/.test(normalized)) return Number(normalized);
  return normalized.split(',').map(item => item.trim()).filter(Boolean);
}, z.union([
  z.boolean(),
  z.number().int().positive(),
  z.array(z.string().min(1)).min(1),
]));

const resendFrom = z.preprocess(
  value => value === '' || value === undefined ? 'Lindyson AI <noreply@lindyson.com>' : value,
  z.string(),
);

const DEVELOPMENT_JWT_SECRET = 'dev-only-change-this-secret';
const REJECTED_PRODUCTION_JWT_SECRETS = new Set([
  DEVELOPMENT_JWT_SECRET,
  'change-this-to-a-long-random-secret',
  'change-this-to-a-long-random-secret-in-production',
]);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4300),
  TRUST_PROXY: trustProxySetting.default(false),
  // 全局限流：每个来源 IP 每分钟允许的请求数，0 表示关闭。
  RATE_LIMIT_MAX: z.coerce.number().int().nonnegative().default(600),
  DATABASE_URL: z.string().url().default('postgres://lindyson:lindyson@localhost:5432/lindyson'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(16).default(DEVELOPMENT_JWT_SECRET),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:4300'),
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),
  MCP_ENABLED: booleanString.default(false),
  MCP_PUBLIC_URL: optionalUrl,
  MCP_OAUTH_SECRET: optionalString,
  MCP_OAUTH_JWKS_JSON: optionalString,
  MCP_FILE_ENCRYPTION_KEY: optionalString,
  MCP_READ_RATE_PER_MINUTE: z.coerce.number().int().positive().default(60),
  MCP_GENERATE_RATE_PER_MINUTE: z.coerce.number().int().positive().default(6),
  MCP_IMPORT_USER_CONCURRENCY: z.coerce.number().int().positive().max(16).default(2),
  MCP_IMPORT_GLOBAL_CONCURRENCY: z.coerce.number().int().positive().max(32).default(4),
  STORAGE_DRIVER: z.enum(['local', 'tos']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./storage'),
  STORAGE_PUBLIC_BASE_URL: optionalUrl,
  TOS_ENDPOINT: optionalUrl,
  TOS_REGION: z.string().default('cn-beijing'),
  TOS_BUCKET: optionalString,
  TOS_ACCESS_KEY_ID: optionalString,
  TOS_SECRET_ACCESS_KEY: optionalString,
  TOS_READ_URL_EXPIRES_SECONDS: z.coerce.number().int().positive().default(43200),
  TOS_FORCE_PATH_STYLE: booleanString.default(false),
  ARK_API_KEY: optionalString,
  ARK_BASE_URL: z.string().url().default('https://ark.cn-beijing.volces.com/api/v3'),
  ARK_SEEDANCE_MODEL: z.string().default('doubao-seedance-2-0-260128'),
  ARK_SEEDANCE_FAST_MODEL: z.string().default('doubao-seedance-2-0-fast-260128'),
  ARK_SEEDANCE_MINI_MODEL: z.string().default('doubao-seedance-2-0-mini-260615'),
  ARK_SEEDANCE_25_MODEL: z.string().trim().refine(
    model => model === 'doubao-seedance-2-5-260628',
    { message: 'ARK_SEEDANCE_25_MODEL 必须固定为 doubao-seedance-2-5-260628' },
  ).default('doubao-seedance-2-5-260628'),
  ARK_SEEDREAM_MODEL: z.string().trim().refine(
    model => model === 'doubao-seedream-5-0-pro-260628',
    { message: 'ARK_SEEDREAM_MODEL 必须固定为 doubao-seedream-5-0-pro-260628' },
  ).default('doubao-seedream-5-0-pro-260628'),
  ARK_SEEDREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(3 * 60 * 1000),
  ARK_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  ARK_TASK_TIMEOUT_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  ARK_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(2 * 60 * 1000),
  // 成片归档下载：连续多久收不到数据视为停滞、整个下载最多多久；超时后自动重试。
  ARK_ARCHIVE_STALL_TIMEOUT_MS: z.coerce.number().int().positive().default(30 * 1000),
  ARK_ARCHIVE_TOTAL_TIMEOUT_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  REAL_PORTRAIT_PROVIDER_MODE: z.enum(['disabled', 'volcengine', 'fake']).default('disabled'),
  VOLC_ARK_ASSET_ACCESS_KEY_ID: optionalString,
  VOLC_ARK_ASSET_SECRET_ACCESS_KEY: optionalString,
  VOLC_ARK_ASSET_ENDPOINT: z.string().url().default('https://ark.cn-beijing.volcengineapi.com/'),
  VOLC_ARK_ASSET_REGION: z.string().trim().min(1).default('cn-beijing'),
  VOLC_ARK_ASSET_SERVICE: z.string().trim().min(1).default('ark'),
  VOLC_ARK_ASSET_VERSION: z.string().trim().min(1).default('2024-01-01'),
  VOLC_ARK_ASSET_PROJECT_NAME: z.string().trim().min(1).default('default'),
  REAL_PORTRAIT_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(15_000),
  REAL_PORTRAIT_GROUP_SOFT_LIMIT: z.coerce.number().int().positive().max(45).default(45),
  REAL_PORTRAIT_ASSET_SOFT_LIMIT: z.coerce.number().int().positive().max(45).default(45),
  REAL_PORTRAIT_INVITE_TTL_SECONDS: z.coerce.number().int().positive().max(30 * 60).default(30 * 60),
  REAL_PORTRAIT_TOKEN_ENCRYPTION_KEY: optionalString,
  REAL_PORTRAIT_CONTROLLER_NAME: optionalString,
  REAL_PORTRAIT_PROCESSOR_NAME: optionalString,
  REAL_PORTRAIT_PRIVACY_CONTACT: optionalString,
  REAL_PORTRAIT_PRIVACY_POLICY_URL: optionalUrl,
  ARK_PROMPT_WIZARD_API_KEY: optionalString,
  ARK_PROMPT_WIZARD_MODEL: z.string().trim().min(1)
    .refine(model => model === 'doubao-seed-2-0-lite-260428', {
      message: 'ARK_PROMPT_WIZARD_MODEL 必须固定为 doubao-seed-2-0-lite-260428',
    })
    .default('doubao-seed-2-0-lite-260428'),
  PROMPT_WIZARD_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(120_000),
  PROMPT_WIZARD_REQUEST_BUDGET_MS: z.coerce.number().int().positive().max(180_000).default(180_000),
  PROMPT_WIZARD_BATCH_BUDGET_MS: z.coerce.number().int().positive().max(240_000).default(240_000),
  PROMPT_WIZARD_MAX_RETRIES: z.coerce.number().int().min(0).max(1).default(1),
  PROMPT_WIZARD_RETRY_BASE_DELAY_MS: z.coerce.number().int().nonnegative().max(30_000).default(1_000),
  PROMPT_WIZARD_RETRY_MAX_DELAY_MS: z.coerce.number().int().nonnegative().max(30_000).default(8_000),
  PROMPT_WIZARD_QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(10),
  PROMPT_WIZARD_PROVIDER_CONCURRENCY: z.coerce.number().int().positive().default(30),
  VOLC_BILLING_ACCESS_KEY_ID: optionalString,
  VOLC_BILLING_SECRET_ACCESS_KEY: optionalString,
  VOLC_BILLING_ENDPOINT: z.string().url().default('https://open.volcengineapi.com'),
  VOLC_BILLING_REGION: z.string().default('cn-north-1'),
  VOLC_BILLING_SERVICE: z.string().default('billing'),
  VOLC_BILLING_VERSION: z.string().default('2022-01-01'),
  VOLC_BILLING_SYNC_TTL_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  VOLC_BILLING_BALANCE_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  VOLC_BILLING_BILL_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  VOLC_BILLING_REQUEST_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  VOLC_BILLING_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  VOLC_BILLING_MAX_RETRIES: z.coerce.number().int().nonnegative().default(4),
  VOLC_BILLING_RETRY_BASE_DELAY_MS: z.coerce.number().int().nonnegative().default(500),
  VOLC_BILLING_PAGE_DELAY_MS: z.coerce.number().int().nonnegative().default(250),
  // 账单同步数据保留：run_items/资源包快照默认保留 30 天，同步运行记录默认保留 90 天。
  VOLC_BILLING_RUN_ITEMS_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  VOLC_BILLING_PACKAGE_SNAPSHOTS_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  VOLC_BILLING_SYNC_RUNS_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  VOLC_BILLING_RETENTION_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(24 * 60 * 60 * 1000),
  VOLC_BILLING_RETENTION_BATCH_SIZE: z.coerce.number().int().positive().max(20_000).default(5_000),
  PAYMENT_CONFIG_ENCRYPTION_KEY: optionalString,
  PAYMENT_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  PAYMENT_ORDER_EXPIRES_SECONDS: z.coerce.number().int().positive().default(7_200),
  PAYMENT_EXPIRY_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  RESEND_API_KEY: optionalString,
  RESEND_FROM: resendFrom,
  RESEND_NOTIFY_TO: optionalString,
  RESEND_BLOCKED_TO: optionalString,
  QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(2),
  MEDIA_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  MEDIA_COMMAND_MAX_OUTPUT_BYTES: z.coerce.number().int().positive().default(32 * 1024 * 1024),
  THUMBNAIL_IMAGE_CONCURRENCY: z.coerce.number().int().positive().default(2),
  THUMBNAIL_VIDEO_CONCURRENCY: z.coerce.number().int().positive().default(1),
  THUMBNAIL_TEMP_ROOT: optionalString,
  THUMBNAIL_TEMP_MAX_AGE_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  THUMBNAIL_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  ENABLE_FAKE_PROVIDER: booleanString.default(false),
  FAKE_PROVIDER_DELAY_MS: z.coerce.number().int().nonnegative().default(1500),
});

const parsedEnv = envSchema.parse(process.env);
assertMcpConfiguration(parsedEnv);
assertPromptWizardRetryConfiguration(parsedEnv);
assertSecureProductionJwtSecret(parsedEnv.NODE_ENV, parsedEnv.JWT_SECRET);
assertSecureProductionCorsOrigin(parsedEnv.NODE_ENV, parsedEnv.CORS_ORIGIN);
assertSecureProductionPublicUrls(parsedEnv.NODE_ENV, {
  PUBLIC_BASE_URL: parsedEnv.PUBLIC_BASE_URL,
  APP_BASE_URL: parsedEnv.APP_BASE_URL,
});
assertPrivateProductionStorage(parsedEnv.NODE_ENV, parsedEnv.STORAGE_PUBLIC_BASE_URL);
assertStorageDriverConfiguration(parsedEnv.NODE_ENV, parsedEnv.STORAGE_DRIVER, {
  endpoint: parsedEnv.TOS_ENDPOINT,
  bucket: parsedEnv.TOS_BUCKET,
  accessKeyId: parsedEnv.TOS_ACCESS_KEY_ID,
  secretAccessKey: parsedEnv.TOS_SECRET_ACCESS_KEY,
});
assertRealPortraitProviderConfiguration(parsedEnv);
assertSecureProductionInfrastructureUrls(
  parsedEnv.NODE_ENV,
  parsedEnv.DATABASE_URL,
  parsedEnv.REDIS_URL,
);

export const env = parsedEnv;

export function assertMcpConfiguration(config: {
  MCP_ENABLED: boolean;
  MCP_PUBLIC_URL?: string;
  MCP_OAUTH_SECRET?: string;
  MCP_OAUTH_JWKS_JSON?: string;
  MCP_FILE_ENCRYPTION_KEY?: string;
  APP_BASE_URL: string;
  NODE_ENV: string;
}) {
  if (!config.MCP_ENABLED) return;
  if (!config.MCP_PUBLIC_URL) throw new Error('启用 MCP 必须配置 MCP_PUBLIC_URL');
  const url = new URL(config.MCP_PUBLIC_URL);
  if (url.pathname !== '/mcp' || url.search || url.hash || url.username || url.password
    || url.origin !== new URL(config.APP_BASE_URL).origin
    || (url.protocol !== 'https:' && !(config.NODE_ENV !== 'production'
      && url.protocol === 'http:' && (['localhost', '127.0.0.1'].includes(url.hostname) || url.hostname.endsWith('.localhost'))))) {
    throw new Error('MCP_PUBLIC_URL 必须为与 APP_BASE_URL 同源的 HTTPS /mcp 地址（本地开发允许 HTTP）');
  }
  if (!config.MCP_OAUTH_SECRET || config.MCP_OAUTH_SECRET.length < 32
    || !/^[a-fA-F0-9]{64}$/.test(config.MCP_FILE_ENCRYPTION_KEY ?? '')
    || !config.MCP_OAUTH_JWKS_JSON) {
    throw new Error('启用 MCP 必须配置独立 OAuth 密钥、私有 JWKS 和 32 字节十六进制附件加密密钥');
  }
  try {
    const jwks = JSON.parse(config.MCP_OAUTH_JWKS_JSON);
    if (!Array.isArray(jwks.keys) || !jwks.keys.some((key: { d?: string; kid?: string }) => key.d && key.kid)) throw new Error();
  } catch { throw new Error('MCP_OAUTH_JWKS_JSON 必须包含带 kid 的私有签名密钥'); }
}

export function assertRealPortraitProviderConfiguration(config: {
  NODE_ENV: 'development' | 'test' | 'production';
  REAL_PORTRAIT_PROVIDER_MODE: 'disabled' | 'volcengine' | 'fake';
  VOLC_ARK_ASSET_ACCESS_KEY_ID?: string;
  VOLC_ARK_ASSET_SECRET_ACCESS_KEY?: string;
  REAL_PORTRAIT_TOKEN_ENCRYPTION_KEY?: string;
  REAL_PORTRAIT_CONTROLLER_NAME?: string;
  REAL_PORTRAIT_PROCESSOR_NAME?: string;
  REAL_PORTRAIT_PRIVACY_CONTACT?: string;
  REAL_PORTRAIT_PRIVACY_POLICY_URL?: string;
}) {
  if (config.NODE_ENV === 'production' && config.REAL_PORTRAIT_PROVIDER_MODE === 'fake') {
    throw new Error('生产环境禁止启用 fake 真人素材供应商。');
  }
  if (config.REAL_PORTRAIT_PROVIDER_MODE === 'disabled') return;
  if (config.REAL_PORTRAIT_PROVIDER_MODE === 'volcengine'
      && (!config.VOLC_ARK_ASSET_ACCESS_KEY_ID || !config.VOLC_ARK_ASSET_SECRET_ACCESS_KEY)) {
    throw new Error('启用真人素材供应商时必须配置独立的火山方舟 Assets API AK/SK。');
  }
  if (!config.REAL_PORTRAIT_TOKEN_ENCRYPTION_KEY || config.REAL_PORTRAIT_TOKEN_ENCRYPTION_KEY.length < 32) {
    throw new Error('启用真人素材供应商时必须配置至少 32 位的 REAL_PORTRAIT_TOKEN_ENCRYPTION_KEY。');
  }
  if (!config.REAL_PORTRAIT_CONTROLLER_NAME
      || !config.REAL_PORTRAIT_PROCESSOR_NAME
      || !config.REAL_PORTRAIT_PRIVACY_CONTACT
      || !config.REAL_PORTRAIT_PRIVACY_POLICY_URL) {
    throw new Error(
      '启用真人素材供应商时必须配置个人信息处理者、受托处理方、隐私联系人和隐私政策地址。',
    );
  }
  if (new URL(config.REAL_PORTRAIT_PRIVACY_POLICY_URL).protocol !== 'https:') {
    throw new Error('真人素材服务的隐私政策地址必须使用 HTTPS。');
  }
}

export function assertPromptWizardRetryConfiguration(config: {
  PROMPT_WIZARD_TIMEOUT_MS: number;
  PROMPT_WIZARD_REQUEST_BUDGET_MS: number;
  PROMPT_WIZARD_BATCH_BUDGET_MS: number;
  PROMPT_WIZARD_MAX_RETRIES: number;
  PROMPT_WIZARD_RETRY_BASE_DELAY_MS: number;
  PROMPT_WIZARD_RETRY_MAX_DELAY_MS: number;
}) {
  if (config.PROMPT_WIZARD_TIMEOUT_MS > 120_000) {
    throw new Error('提示词向导单次尝试超时不能超过 120 秒硬上限。');
  }
  if (config.PROMPT_WIZARD_REQUEST_BUDGET_MS > 180_000) {
    throw new Error('提示词向导单个请求重试总预算不能超过 180 秒硬上限。');
  }
  if (config.PROMPT_WIZARD_BATCH_BUDGET_MS > 240_000) {
    throw new Error('提示词向导方案批次总预算不能超过 240 秒硬上限。');
  }
  if (config.PROMPT_WIZARD_TIMEOUT_MS > config.PROMPT_WIZARD_REQUEST_BUDGET_MS) {
    throw new Error('提示词向导单次尝试超时不能大于单个请求重试总预算。');
  }
  if (config.PROMPT_WIZARD_REQUEST_BUDGET_MS > config.PROMPT_WIZARD_BATCH_BUDGET_MS) {
    throw new Error('提示词向导单个请求重试总预算不能大于方案批次总预算。');
  }
  if (config.PROMPT_WIZARD_RETRY_BASE_DELAY_MS > config.PROMPT_WIZARD_RETRY_MAX_DELAY_MS) {
    throw new Error('提示词向导重试基础等待不能大于最大等待。');
  }
  if (config.PROMPT_WIZARD_MAX_RETRIES > 1) {
    throw new Error('提示词向导最多只能配置一次传输重试。');
  }
}

export function assertSecureProductionJwtSecret(nodeEnv: string, secret: string) {
  if (nodeEnv !== 'production') return;

  const normalized = secret.trim().toLowerCase();
  if (
    secret.length < 32
    || REJECTED_PRODUCTION_JWT_SECRETS.has(secret)
    || normalized.includes('change-this')
    || normalized.includes('dev-only')
    || new Set(secret).size < 12
  ) {
    throw new Error('生产环境 JWT_SECRET 必须使用至少 32 位的强随机值，且不能使用示例默认值。');
  }
}

export function assertSecureProductionCorsOrigin(nodeEnv: string, corsOrigin: string) {
  if (nodeEnv !== 'production') return;
  const origins = corsOrigin.split(',').map(value => value.trim()).filter(Boolean);
  if (!origins.length || origins.includes('*')) {
    throw new Error('生产环境 CORS_ORIGIN 必须配置明确的 HTTPS 来源，不能使用通配符。');
  }

  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`生产环境 CORS_ORIGIN 包含无效来源：${origin}`);
    }
    if (url.protocol !== 'https:' || url.origin !== origin) {
      throw new Error(`生产环境 CORS_ORIGIN 必须是无路径的 HTTPS 来源：${origin}`);
    }
  }
}

export function assertSecureProductionPublicUrls(
  nodeEnv: string,
  urls: { PUBLIC_BASE_URL: string; APP_BASE_URL: string },
) {
  if (nodeEnv !== 'production') return;
  for (const [name, value] of Object.entries(urls)) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value.replace(/\/$/, '')) {
      throw new Error(`生产环境 ${name} 必须是无路径的 HTTPS 公开来源。`);
    }
  }
}

export function assertPrivateProductionStorage(
  nodeEnv: string,
  storagePublicBaseUrl: string | undefined,
) {
  if (nodeEnv !== 'production') return;
  if (storagePublicBaseUrl) {
    throw new Error('生产环境禁止配置 STORAGE_PUBLIC_BASE_URL；资产必须通过即时鉴权签名地址访问。');
  }
}

export function assertStorageDriverConfiguration(
  nodeEnv: string,
  storageDriver: 'local' | 'tos',
  tos: {
    endpoint?: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  },
) {
  if (storageDriver !== 'tos') return;
  if (!tos.endpoint || !tos.bucket || !tos.accessKeyId || !tos.secretAccessKey) {
    throw new Error('STORAGE_DRIVER=tos 时必须完整配置 TOS endpoint、bucket 和访问密钥。');
  }
  if (nodeEnv === 'production' && new URL(tos.endpoint).protocol !== 'https:') {
    throw new Error('生产环境 TOS_ENDPOINT 必须使用 HTTPS。');
  }
}

export function assertSecureProductionInfrastructureUrls(
  nodeEnv: string,
  databaseUrl: string,
  redisUrl: string,
) {
  if (nodeEnv !== 'production') return;
  const database = new URL(databaseUrl);
  if (!database.password || database.password === 'lindyson') {
    throw new Error('生产环境 DATABASE_URL 必须显式配置非默认数据库密码。');
  }
  const redis = new URL(redisUrl);
  if (!redis.password) {
    throw new Error('生产环境 REDIS_URL 必须显式配置 Redis 密码。');
  }
}

function loadLocalEnv() {
  const cwd = process.cwd();
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(cwd, '.env'),
    cwd.endsWith(`${sep}apps${sep}api`) ? resolve(cwd, '..', '..', '.env') : null,
    resolve(moduleDir, '..', '..', '..', '..', '.env'),
  ].filter((filePath): filePath is string => Boolean(filePath));

  for (const filePath of new Set(candidates)) {
    if (existsSync(filePath)) {
      process.loadEnvFile(filePath);
    }
  }
}

/**
 * 用 HKDF 从 JWT_SECRET 派生各用途独立的 32 字节签名密钥，避免会话签名密钥被直接复用于
 * 限流键哈希、本地存储 URL 签名和分页游标签名。purpose 不同则密钥不同；JWT 本身仍直接用 JWT_SECRET。
 */
export function deriveSigningKey(purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', env.JWT_SECRET, 'lindyson-signing-v1', purpose, 32));
}
