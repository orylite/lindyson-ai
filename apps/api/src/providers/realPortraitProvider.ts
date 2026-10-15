import { createHash, createHmac, randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import type { RealPortraitProviderAssetType } from '../domain/realPortraitTypes.js';

export interface CreateVisualValidationSessionInput {
  callbackUrl: string;
  projectName: string;
}

export interface VisualValidationSessionResult {
  bytedToken: string;
  h5Link: string;
  requestId: string | null;
}

export interface VisualValidationResult {
  groupId: string;
  requestId: string | null;
}

export interface CreateRealPortraitAssetInput {
  groupId: string;
  sourceUrl: string;
  name: string;
  assetType: RealPortraitProviderAssetType;
  projectName: string;
}

export interface ListRealPortraitAssetsInput {
  groupId: string;
  name: string;
  projectName: string;
  pageSize?: number;
}

export interface RealPortraitProviderAsset {
  id: string;
  name: string;
  sourceUrl: string;
  assetType: RealPortraitProviderAssetType;
  groupId: string;
  status: 'Active' | 'Processing' | 'Failed';
  projectName: string;
  errorCode: string | null;
  errorMessage: string | null;
  requestId: string | null;
}

export interface RealPortraitProvider {
  readonly name: 'volcengine-ark-assets' | 'fake-real-portrait' | 'disabled';
  createVisualValidationSession(input: CreateVisualValidationSessionInput): Promise<VisualValidationSessionResult>;
  getVisualValidationResult(bytedToken: string, projectName: string): Promise<VisualValidationResult>;
  createAsset(input: CreateRealPortraitAssetInput): Promise<{ assetId: string; requestId: string | null }>;
  listRealPortraitAssets(input: ListRealPortraitAssetsInput): Promise<{
    items: RealPortraitProviderAsset[];
    totalCount: number;
    requestId: string | null;
  }>;
  getAsset(assetId: string, projectName: string): Promise<RealPortraitProviderAsset>;
  deleteAsset(assetId: string, projectName: string): Promise<{ assetId: string; requestId: string | null }>;
  deleteAssetGroup(groupId: string, projectName: string): Promise<{ groupId: string; requestId: string | null }>;
}

export interface VolcengineRealPortraitProviderConfig {
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint: string;
  region: string;
  service: string;
  version: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface VolcengineResponse {
  ResponseMetadata?: {
    RequestId?: unknown;
    Error?: { Code?: unknown; Message?: unknown } | null;
  };
  Result?: Record<string, unknown> | null;
}

export function getConfiguredRealPortraitProvider(): RealPortraitProvider {
  if (env.REAL_PORTRAIT_PROVIDER_MODE === 'fake') return createFakeRealPortraitProvider();
  if (env.REAL_PORTRAIT_PROVIDER_MODE !== 'volcengine') return createDisabledRealPortraitProvider();
  return createVolcengineRealPortraitProvider({
    accessKeyId: env.VOLC_ARK_ASSET_ACCESS_KEY_ID,
    secretAccessKey: env.VOLC_ARK_ASSET_SECRET_ACCESS_KEY,
    endpoint: env.VOLC_ARK_ASSET_ENDPOINT,
    region: env.VOLC_ARK_ASSET_REGION,
    service: env.VOLC_ARK_ASSET_SERVICE,
    version: env.VOLC_ARK_ASSET_VERSION,
    timeoutMs: env.REAL_PORTRAIT_PROVIDER_TIMEOUT_MS,
  });
}

export function createDisabledRealPortraitProvider(): RealPortraitProvider {
  const unavailable = async (): Promise<never> => {
    throw providerUnavailable('真人素材供应商尚未配置');
  };
  return {
    name: 'disabled',
    createVisualValidationSession: unavailable,
    getVisualValidationResult: unavailable,
    createAsset: unavailable,
    listRealPortraitAssets: unavailable,
    getAsset: unavailable,
    deleteAsset: unavailable,
    deleteAssetGroup: unavailable,
  };
}

export function createVolcengineRealPortraitProvider(
  config: VolcengineRealPortraitProviderConfig,
): RealPortraitProvider {
  const request = createVolcengineRequest(config);
  return {
    name: 'volcengine-ark-assets',
    async createVisualValidationSession(input) {
      const response = await request('CreateVisualValidateSession', {
        CallbackURL: requireHttpsOrTestUrl(input.callbackUrl, 'CallbackURL'),
        ProjectName: requireText(input.projectName, 'ProjectName'),
      });
      return {
        bytedToken: requireResultString(response, 'BytedToken'),
        h5Link: requireHttpsOrTestUrl(requireResultString(response, 'H5Link'), 'H5Link'),
        requestId: response.requestId,
      };
    },
    async getVisualValidationResult(bytedToken, projectName) {
      const response = await request('GetVisualValidateResult', {
        BytedToken: requireText(bytedToken, 'BytedToken'),
        ProjectName: requireText(projectName, 'ProjectName'),
      });
      return { groupId: requireResultString(response, 'GroupId'), requestId: response.requestId };
    },
    async createAsset(input) {
      const response = await request('CreateAsset', {
        GroupId: requireText(input.groupId, 'GroupId'),
        URL: requireHttpsOrTestUrl(input.sourceUrl, 'URL'),
        Name: requireBoundedText(input.name, 'Name', 64),
        AssetType: input.assetType,
        ProjectName: requireText(input.projectName, 'ProjectName'),
      });
      return { assetId: requireResultString(response, 'Id'), requestId: response.requestId };
    },
    async listRealPortraitAssets(input) {
      const pageSize = input.pageSize ?? 100;
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
        throw invalidInput('PageSize 必须是 1 到 100 的整数');
      }
      const response = await request('ListAssets', {
        Filter: {
          GroupIds: [requireText(input.groupId, 'GroupId')],
          GroupType: 'LivenessFace',
          Name: requireBoundedText(input.name, 'Name', 64),
        },
        PageNumber: 1,
        PageSize: pageSize,
        SortBy: 'CreateTime',
        SortOrder: 'Desc',
        ProjectName: requireText(input.projectName, 'ProjectName'),
      });
      if (!Array.isArray(response.result.Items)) {
        throw invalidProviderResponse('ListAssets.Items', response.requestId);
      }
      const items = response.result.Items.map((value, index) => (
        parseProviderAsset(value, input.projectName, response.requestId, `ListAssets.Items[${index}]`)
      ));
      const totalCount = requireNonnegativeInteger(response.result.TotalCount, 'ListAssets.TotalCount', response.requestId);
      return { items, totalCount, requestId: response.requestId };
    },
    async getAsset(assetId, projectName) {
      const response = await request('GetAsset', {
        Id: requireText(assetId, 'Id'),
        ProjectName: requireText(projectName, 'ProjectName'),
      });
      const status = requireResultString(response, 'Status');
      if (!isProviderAssetStatus(status)) throw invalidProviderResponse('GetAsset.Status');
      const assetType = requireResultString(response, 'AssetType');
      if (!isProviderAssetType(assetType)) throw invalidProviderResponse('GetAsset.AssetType');
      const error = readRecord(response.result.Error);
      return {
        id: requireResultString(response, 'Id'),
        name: optionalString(response.result.Name) ?? '',
        sourceUrl: optionalString(response.result.URL) ?? '',
        assetType,
        groupId: requireResultString(response, 'GroupId'),
        status,
        projectName: optionalString(response.result.ProjectName) ?? projectName,
        errorCode: optionalString(error?.Code),
        errorMessage: optionalString(error?.Message),
        requestId: response.requestId,
      };
    },
    async deleteAsset(assetId, projectName) {
      const response = await request('DeleteAsset', {
        Id: requireText(assetId, 'Id'),
        ProjectName: requireText(projectName, 'ProjectName'),
      });
      return { assetId: requireResultString(response, 'Id'), requestId: response.requestId };
    },
    async deleteAssetGroup(groupId, projectName) {
      const response = await request('DeleteAssetGroup', {
        Id: requireText(groupId, 'Id'),
        ProjectName: requireText(projectName, 'ProjectName'),
      });
      return { groupId: requireResultString(response, 'Id'), requestId: response.requestId };
    },
  };
}

export function createFakeRealPortraitProvider(): RealPortraitProvider {
  const assets = new Map<string, RealPortraitProviderAsset>();
  const deletedAssetIds = new Set<string>();
  return {
    name: 'fake-real-portrait',
    async createVisualValidationSession(input) {
      const token = `fake-byted-${randomUUID()}`;
      return {
        bytedToken: token,
        // 仅供本地/fullstack 假供应商页面模拟 H5 完成后回调；fragment 不会发往 example.invalid。
        h5Link: `https://example.invalid/real-portrait-verify#callbackUrl=${encodeURIComponent(input.callbackUrl)}&bytedToken=${encodeURIComponent(token)}`,
        requestId: `fake-request-${digest(input.callbackUrl).slice(0, 16)}`,
      };
    },
    async getVisualValidationResult(bytedToken) {
      if (!bytedToken.startsWith('fake-byted-')) throw fakeNotFound('验证会话不存在或已过期');
      const groupId = `fake-group-${digest(bytedToken).slice(0, 24)}`;
      return { groupId, requestId: `fake-request-${digest(groupId).slice(0, 16)}` };
    },
    async createAsset(input) {
      const assetId = encodeFakeAssetId(input);
      assets.set(assetId, {
        id: assetId,
        name: input.name,
        sourceUrl: input.sourceUrl,
        assetType: input.assetType,
        groupId: input.groupId,
        status: 'Active',
        projectName: input.projectName,
        errorCode: null,
        errorMessage: null,
        requestId: null,
      });
      deletedAssetIds.delete(assetId);
      return { assetId, requestId: `fake-request-${digest(assetId).slice(0, 16)}` };
    },
    async listRealPortraitAssets(input) {
      const items = [...assets.values()].filter(asset => (
        asset.groupId === input.groupId
        && asset.name === input.name
        && asset.projectName === input.projectName
        && !deletedAssetIds.has(asset.id)
      ));
      return {
        items: items.map(asset => ({ ...asset })),
        totalCount: items.length,
        requestId: `fake-request-${digest(`${input.projectName}:${input.groupId}:${input.name}`).slice(0, 16)}`,
      };
    },
    async getAsset(assetId, projectName) {
      const asset = assets.get(assetId) ?? decodeFakeAssetId(assetId, projectName);
      if (deletedAssetIds.has(assetId)) throw fakeNotFound('真人素材不存在');
      if (!asset) throw fakeNotFound('真人素材不存在');
      return { ...asset, requestId: `fake-request-${digest(assetId).slice(0, 16)}` };
    },
    async deleteAsset(assetId) {
      assets.delete(assetId);
      deletedAssetIds.add(assetId);
      return { assetId, requestId: `fake-request-${digest(assetId).slice(0, 16)}` };
    },
    async deleteAssetGroup(groupId) {
      for (const [assetId, asset] of assets) {
        if (asset.groupId === groupId) {
          assets.delete(assetId);
          deletedAssetIds.add(assetId);
        }
      }
      return { groupId, requestId: `fake-request-${digest(groupId).slice(0, 16)}` };
    },
  };
}

function createVolcengineRequest(config: VolcengineRealPortraitProviderConfig) {
  return async (action: string, body: Record<string, unknown>) => {
    const accessKeyId = config.accessKeyId?.trim();
    const secretAccessKey = config.secretAccessKey?.trim();
    if (!accessKeyId || !secretAccessKey) throw providerUnavailable('真人素材供应商访问密钥未配置');
    const request = buildVolcengineRealPortraitRequest({
      ...config,
      accessKeyId,
      secretAccessKey,
      action,
      body,
      now: config.now?.() ?? new Date(),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response: Response;
    try {
      response = await (config.fetchImpl ?? fetch)(request.url, {
        method: 'POST',
        body: request.body,
        headers: request.headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw providerError('真人素材供应商请求超时', 'REAL_PORTRAIT_PROVIDER_TIMEOUT', 504, error);
      throw providerError('真人素材供应商暂不可用', 'REAL_PORTRAIT_PROVIDER_UNAVAILABLE', 503, error);
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    const payload = parseProviderJson(text);
    const requestId = readRequestId(response, payload);
    const providerFailure = readRecord(payload.ResponseMetadata)?.Error;
    if (!response.ok || providerFailure) {
      const failure = readRecord(providerFailure);
      const code = optionalString(failure?.Code) ?? `HTTP_${response.status}`;
      const message = optionalString(failure?.Message) ?? `真人素材供应商请求失败（HTTP ${response.status}）`;
      throw providerError(message, code, response.status >= 500 ? 503 : 409, undefined, requestId);
    }
    const result = readRecord(payload.Result);
    if (!result) throw invalidProviderResponse(`${action}.Result`, requestId);
    return { result, requestId };
  };
}

export function buildVolcengineRealPortraitRequest(input: {
  action: string;
  body: Record<string, unknown>;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  region: string;
  service: string;
  version: string;
  now: Date;
}) {
  const endpoint = new URL(input.endpoint);
  const query = new URLSearchParams({ Action: input.action, Version: input.version });
  const canonicalQuery = [...query.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
    ))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  const body = JSON.stringify(input.body);
  const xDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const shortDate = xDate.slice(0, 8);
  const payloadHash = digest(body);
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const canonicalRequest = [
    'POST',
    endpoint.pathname || '/',
    canonicalQuery,
    'content-type:application/json',
    `host:${endpoint.host}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${xDate}`,
    '',
    signedHeaders,
    payloadHash,
  ].join('\n');
  const credentialScope = `${shortDate}/${input.region}/${input.service}/request`;
  const stringToSign = ['HMAC-SHA256', xDate, credentialScope, digest(canonicalRequest)].join('\n');
  const dateKey = hmac(input.secretAccessKey, shortDate);
  const regionKey = hmac(dateKey, input.region);
  const serviceKey = hmac(regionKey, input.service);
  const signingKey = hmac(serviceKey, 'request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  endpoint.search = canonicalQuery;
  return {
    url: endpoint.toString(),
    body,
    headers: {
      Authorization: `HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'Content-Type': 'application/json',
      'X-Content-Sha256': payloadHash,
      'X-Date': xDate,
    },
    canonicalRequest,
  };
}

function requireResultString(response: { result: Record<string, unknown>; requestId: string | null }, field: string) {
  const value = optionalString(response.result[field]);
  if (!value) throw invalidProviderResponse(field, response.requestId);
  return value;
}

function parseProviderAsset(
  value: unknown,
  fallbackProjectName: string,
  requestId: string | null,
  fieldPrefix: string,
): RealPortraitProviderAsset {
  const record = readRecord(value);
  if (!record) throw invalidProviderResponse(fieldPrefix, requestId);
  const status = optionalString(record.Status);
  if (!status || !isProviderAssetStatus(status)) {
    throw invalidProviderResponse(`${fieldPrefix}.Status`, requestId);
  }
  const assetType = optionalString(record.AssetType);
  if (!assetType || !isProviderAssetType(assetType)) {
    throw invalidProviderResponse(`${fieldPrefix}.AssetType`, requestId);
  }
  const error = readRecord(record.Error);
  const id = optionalString(record.Id);
  const name = optionalString(record.Name);
  const groupId = optionalString(record.GroupId);
  if (!id || !name || !groupId) {
    throw invalidProviderResponse(`${fieldPrefix}.Id/Name/GroupId`, requestId);
  }
  return {
    id,
    name,
    sourceUrl: optionalString(record.URL) ?? '',
    assetType,
    groupId,
    status,
    projectName: optionalString(record.ProjectName) ?? fallbackProjectName,
    errorCode: optionalString(error?.Code),
    errorMessage: optionalString(error?.Message),
    requestId,
  };
}

function requireNonnegativeInteger(value: unknown, field: string, requestId: string | null) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw invalidProviderResponse(field, requestId);
  return parsed;
}

function encodeFakeAssetId(input: CreateRealPortraitAssetInput) {
  const payload = Buffer.from(JSON.stringify({
    g: input.groupId,
    n: input.name,
    t: input.assetType,
    p: input.projectName,
  })).toString('base64url');
  return `fake-asset-${payload}`;
}

function decodeFakeAssetId(assetId: string, projectName: string): RealPortraitProviderAsset | null {
  if (!assetId.startsWith('fake-asset-')) return null;
  try {
    const parsed = JSON.parse(Buffer.from(assetId.slice('fake-asset-'.length), 'base64url').toString('utf8')) as {
      g?: unknown;
      n?: unknown;
      t?: unknown;
      p?: unknown;
    };
    if (typeof parsed.g !== 'string' || typeof parsed.n !== 'string'
      || typeof parsed.p !== 'string' || parsed.p !== projectName
      || typeof parsed.t !== 'string' || !isProviderAssetType(parsed.t)) return null;
    return {
      id: assetId,
      name: parsed.n,
      sourceUrl: '',
      assetType: parsed.t,
      groupId: parsed.g,
      status: 'Active',
      projectName: parsed.p,
      errorCode: null,
      errorMessage: null,
      requestId: null,
    };
  } catch {
    return null;
  }
}

function requireText(value: string, field: string) {
  const text = value.trim();
  if (!text) throw invalidInput(`${field} 不能为空`);
  return text;
}

function requireBoundedText(value: string, field: string, maxLength: number) {
  const text = requireText(value, field);
  if ([...text].length > maxLength) throw invalidInput(`${field} 不能超过 ${maxLength} 个字符`);
  return text;
}

function requireHttpsOrTestUrl(value: string, field: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidInput(`${field} 必须是有效 URL`);
  }
  if (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && url.protocol === 'http:')) {
    throw invalidInput(`${field} 必须使用 HTTPS`);
  }
  return url.toString();
}

function parseProviderJson(text: string): VolcengineResponse {
  try {
    const value = JSON.parse(text) as unknown;
    if (!readRecord(value)) throw new Error('not-object');
    return value as VolcengineResponse;
  } catch (error) {
    throw providerError('真人素材供应商返回了无效响应', 'REAL_PORTRAIT_PROVIDER_INVALID_RESPONSE', 502, error);
  }
}

function readRequestId(response: Response, payload: VolcengineResponse) {
  return response.headers.get('x-request-id')
    ?? optionalString(readRecord(payload.ResponseMetadata)?.RequestId)
    ?? null;
}

function isProviderAssetType(value: string): value is RealPortraitProviderAssetType {
  return value === 'Image' || value === 'Video' || value === 'Audio';
}

function isProviderAssetStatus(value: string): value is RealPortraitProviderAsset['status'] {
  return value === 'Active' || value === 'Processing' || value === 'Failed';
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value).digest();
}

function invalidInput(message: string) {
  return Object.assign(new Error(message), { statusCode: 400, code: 'REAL_PORTRAIT_INPUT_INVALID', exposeMessage: true });
}

function providerUnavailable(message: string) {
  return Object.assign(new Error(message), { statusCode: 503, code: 'REAL_PORTRAIT_PROVIDER_NOT_CONFIGURED', exposeMessage: true });
}

function invalidProviderResponse(field: string, requestId: string | null = null) {
  return Object.assign(new Error(`真人素材供应商响应缺少有效字段：${field}`), {
    statusCode: 502,
    code: 'REAL_PORTRAIT_PROVIDER_INVALID_RESPONSE',
    requestId,
  });
}

function providerError(
  message: string,
  code: string,
  statusCode: number,
  cause?: unknown,
  requestId: string | null = null,
) {
  return Object.assign(new Error(message, { cause }), { statusCode, code, requestId, exposeMessage: statusCode < 500 });
}

function fakeNotFound(message: string) {
  return Object.assign(new Error(message), { statusCode: 404, code: 'REAL_PORTRAIT_FAKE_NOT_FOUND', exposeMessage: true });
}
