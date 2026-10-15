import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { pool, type DbClient } from '../db/pool.js';
import { toIsoDateTime } from '../domain/serialization.js';

export type PaymentWayCode = 'ALI_WAP';
export type PaymentSurface = 'pc' | 'mobile';

export interface PaymentChannelAdminView {
  enabled: boolean;
  apiBase: string;
  mchNo: string;
  appId: string;
  hasApiKey: boolean;
  desktopWayCode: 'ALI_WAP';
  mobileWayCode: 'ALI_WAP';
  updatedAt: string | null;
}

export interface PaymentChannelCredentials extends PaymentChannelAdminView {
  /** 旧的纯协议测试 fixture 可省略；持久化 attempt 前业务层会强制要求。 */
  revisionId?: string;
  apiKey: string;
}

interface PaymentChannelRow {
  provider: string;
  enabled: boolean;
  api_base: string;
  mch_no: string;
  app_id: string;
  api_key_ciphertext: string | null;
  api_key_iv: string | null;
  api_key_tag: string | null;
  desktop_way_code: 'ALI_WAP';
  mobile_way_code: 'ALI_WAP';
  current_revision_id?: string | null;
  updated_at: Date | string;
}

interface PaymentChannelRevisionRow extends PaymentChannelRow {
  id: string;
}

export interface SavePaymentChannelInput {
  enabled: boolean;
  apiBase: string;
  mchNo: string;
  appId: string;
  apiKey?: string;
  desktopWayCode: 'ALI_WAP';
  mobileWayCode: 'ALI_WAP';
}

const PROVIDER = 'jeepay';

export async function getPaymentChannelAdminView(client: DbClient = pool): Promise<PaymentChannelAdminView> {
  const row = await readPaymentChannelRow(client);
  if (!row) return emptyAdminView();
  return mapAdminView(row);
}

export async function getUnchangedPaymentChannelView(
  client: DbClient,
  input: SavePaymentChannelInput,
  encryptionKey = env.PAYMENT_CONFIG_ENCRYPTION_KEY,
): Promise<PaymentChannelAdminView | null> {
  const current = await readPaymentChannelRow(client, true);
  if (!current) return null;

  const suppliedApiKey = input.apiKey?.trim();
  if (suppliedApiKey) {
    if (!current.api_key_ciphertext || !current.api_key_iv || !current.api_key_tag) return null;
    try {
      const currentApiKey = decryptPaymentSecret({
        ciphertext: current.api_key_ciphertext,
        iv: current.api_key_iv,
        tag: current.api_key_tag,
      }, encryptionKey);
      if (currentApiKey !== suppliedApiKey) return null;
    } catch {
      // 已有密文损坏时允许管理员用新密钥覆盖，不能让等值检查阻断保存。
      return null;
    }
  }

  const unchanged = current.enabled === input.enabled
    && current.api_base === normalizePaymentApiBase(input.apiBase)
    && current.mch_no === input.mchNo.trim()
    && current.app_id === input.appId.trim()
    && current.desktop_way_code === input.desktopWayCode
    && current.mobile_way_code === input.mobileWayCode;
  return unchanged ? mapAdminView(current) : null;
}

export async function savePaymentChannel(
  client: DbClient,
  adminUserId: string,
  input: SavePaymentChannelInput,
) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`payment-channel:${PROVIDER}`]);
  const apiBase = normalizePaymentApiBase(input.apiBase);
  const mchNo = input.mchNo.trim();
  const appId = input.appId.trim();
  const apiKey = input.apiKey?.trim();

  const current = await readPaymentChannelRow(client, true);
  const encrypted = apiKey ? encryptPaymentSecret(apiKey) : null;
  const hasApiKey = Boolean(encrypted || current?.api_key_ciphertext);

  if (input.enabled && (!apiBase || !mchNo || !appId || !hasApiKey)) {
    throw publicError('启用支付通道前请填写完整配置', 400);
  }

  const result = await client.query<PaymentChannelRow>(
    `WITH saved AS (
       INSERT INTO payment_channels (
         provider, enabled, api_base, mch_no, app_id,
         api_key_ciphertext, api_key_iv, api_key_tag,
         desktop_way_code, mobile_way_code, updated_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (provider) DO UPDATE
       SET enabled = EXCLUDED.enabled,
           api_base = EXCLUDED.api_base,
           mch_no = EXCLUDED.mch_no,
           app_id = EXCLUDED.app_id,
           api_key_ciphertext = COALESCE(EXCLUDED.api_key_ciphertext, payment_channels.api_key_ciphertext),
           api_key_iv = COALESCE(EXCLUDED.api_key_iv, payment_channels.api_key_iv),
           api_key_tag = COALESCE(EXCLUDED.api_key_tag, payment_channels.api_key_tag),
           desktop_way_code = EXCLUDED.desktop_way_code,
           mobile_way_code = EXCLUDED.mobile_way_code,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()
       RETURNING *
     ), revision AS (
       INSERT INTO payment_channel_revisions (
         provider, revision, enabled, api_base, mch_no, app_id,
         api_key_ciphertext, api_key_iv, api_key_tag,
         desktop_way_code, mobile_way_code, created_by
       )
       SELECT saved.provider,
              COALESCE((SELECT max(item.revision) + 1 FROM payment_channel_revisions item WHERE item.provider = saved.provider), 1),
              saved.enabled, saved.api_base, saved.mch_no, saved.app_id,
              saved.api_key_ciphertext, saved.api_key_iv, saved.api_key_tag,
              saved.desktop_way_code, saved.mobile_way_code, $11
       FROM saved
       RETURNING id, provider
     ), linked AS (
       UPDATE payment_channels channel
       SET current_revision_id = revision.id
       FROM revision
       WHERE channel.provider = revision.provider
       RETURNING channel.*
     )
     SELECT * FROM linked`,
    [
      PROVIDER,
      input.enabled,
      apiBase,
      mchNo,
      appId,
      encrypted?.ciphertext ?? null,
      encrypted?.iv ?? null,
      encrypted?.tag ?? null,
      input.desktopWayCode,
      input.mobileWayCode,
      adminUserId,
    ],
  );

  return mapAdminView(result.rows[0]!);
}

export async function getPaymentChannelCredentials(options: { requireEnabled?: boolean } = {}) {
  const row = await readCurrentPaymentChannelRevision(pool);
  if (!row || (options.requireEnabled && !row.enabled)) {
    throw publicError('支付通道尚未启用', 503);
  }
  if (!row.api_base || !row.mch_no || !row.app_id || !row.api_key_ciphertext || !row.api_key_iv || !row.api_key_tag) {
    throw publicError('支付通道配置不完整', 503);
  }
  const apiBase = normalizePaymentApiBase(row.api_base);

  return {
    ...mapAdminView(row),
    revisionId: row.id,
    apiBase,
    apiKey: decryptPaymentSecret({
      ciphertext: row.api_key_ciphertext,
      iv: row.api_key_iv,
      tag: row.api_key_tag,
    }),
  } satisfies PaymentChannelCredentials;
}

export async function getPaymentChannelCredentialsByRevision(
  revisionId: string,
  client: DbClient = pool,
): Promise<PaymentChannelCredentials> {
  const result = await client.query<PaymentChannelRevisionRow>(
    `SELECT revision.*
     FROM payment_channel_revisions revision
     WHERE revision.id = $1
     LIMIT 1`,
    [revisionId],
  );
  const row = result.rows[0];
  if (!row || !row.api_base || !row.mch_no || !row.app_id || !row.api_key_ciphertext || !row.api_key_iv || !row.api_key_tag) {
    throw publicError('订单绑定的支付通道版本不存在或配置不完整', 503);
  }
  return {
    ...mapAdminView(row),
    revisionId: row.id,
    apiBase: normalizePaymentApiBase(row.api_base),
    apiKey: decryptPaymentSecret({
      ciphertext: row.api_key_ciphertext,
      iv: row.api_key_iv,
      tag: row.api_key_tag,
    }),
  };
}

export function encryptPaymentSecret(secret: string, keyValue = env.PAYMENT_CONFIG_ENCRYPTION_KEY) {
  const key = paymentEncryptionKey(keyValue);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptPaymentSecret(
  encrypted: { ciphertext: string; iv: string; tag: string },
  keyValue = env.PAYMENT_CONFIG_ENCRYPTION_KEY,
) {
  const key = paymentEncryptionKey(keyValue);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw publicError('支付通道密钥无法解密，请重新保存配置', 503);
  }
}

function paymentEncryptionKey(value: string | undefined) {
  if (!value) throw publicError('支付通道加密主密钥未配置', 503);
  const buffer = Buffer.from(value, 'base64');
  if (buffer.length !== 32) {
    throw publicError('支付通道加密主密钥格式不正确', 503);
  }
  return buffer;
}

export function normalizePaymentApiBase(value: string, nodeEnv = env.NODE_ENV) {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw publicError('API 基础地址格式不正确', 400);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw publicError('API 基础地址仅支持 HTTP 或 HTTPS', 400);
  }
  if (nodeEnv === 'production' && url.protocol !== 'https:') {
    throw publicError('生产环境支付 API 基础地址必须使用 HTTPS', 400);
  }
  return url.toString().replace(/\/$/, '');
}

async function readPaymentChannelRow(client: DbClient, forUpdate = false) {
  const result = await client.query<PaymentChannelRow>(
    `SELECT * FROM payment_channels WHERE provider = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [PROVIDER],
  );
  return result.rows[0] ?? null;
}

async function readCurrentPaymentChannelRevision(client: DbClient) {
  const result = await client.query<PaymentChannelRevisionRow>(
    `SELECT revision.*
     FROM payment_channels channel
     JOIN payment_channel_revisions revision ON revision.id = channel.current_revision_id
     WHERE channel.provider = $1`,
    [PROVIDER],
  );
  return result.rows[0] ?? null;
}

function mapAdminView(row: PaymentChannelRow): PaymentChannelAdminView {
  return {
    enabled: row.enabled,
    apiBase: row.api_base,
    mchNo: row.mch_no,
    appId: row.app_id,
    hasApiKey: Boolean(row.api_key_ciphertext),
    desktopWayCode: row.desktop_way_code,
    mobileWayCode: row.mobile_way_code,
    updatedAt: toIsoDateTime(row.updated_at),
  };
}

function emptyAdminView(): PaymentChannelAdminView {
  return {
    enabled: false,
    apiBase: '',
    mchNo: '',
    appId: '',
    hasApiKey: false,
    desktopWayCode: 'ALI_WAP',
    mobileWayCode: 'ALI_WAP',
    updatedAt: null,
  };
}

function publicError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode, exposeMessage: true });
}
