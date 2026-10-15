import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import {
  assertProfileQuota,
  decideRealPortraitCapacity,
  selectRealPortraitEvictionPlan,
} from '../src/domain/realPortraitCapacity.js';
import {
  createRealPortraitBearerToken,
  decryptRealPortraitSecret,
  encryptRealPortraitSecret,
  fingerprintRealPortraitSecret,
} from '../src/domain/realPortraitSecrets.js';
import {
  buildVolcengineRealPortraitRequest,
  createDisabledRealPortraitProvider,
  createFakeRealPortraitProvider,
  createVolcengineRealPortraitProvider,
} from '../src/providers/realPortraitProvider.js';

const TEST_ENCRYPTION_KEY = 'real-portrait-test-encryption-key-32-bytes-minimum';
const originalEncryptionKey = env.REAL_PORTRAIT_TOKEN_ENCRYPTION_KEY;

function setEncryptionKey(value: string | undefined) {
  (env as { REAL_PORTRAIT_TOKEN_ENCRYPTION_KEY?: string }).REAL_PORTRAIT_TOKEN_ENCRYPTION_KEY = value;
}

function jsonResponse(
  payload: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
  });
}

function volcProvider(fetchImpl: typeof fetch, overrides: {
  accessKeyId?: string;
  secretAccessKey?: string;
} = {}) {
  return createVolcengineRealPortraitProvider({
    accessKeyId: overrides.accessKeyId ?? 'TESTAK',
    secretAccessKey: overrides.secretAccessKey ?? 'TESTSECRET',
    endpoint: 'https://ark.cn-beijing.volcengineapi.com/',
    region: 'cn-beijing',
    service: 'ark',
    version: '2024-01-01',
    timeoutMs: 1_000,
    now: () => new Date('2026-07-30T01:02:03.000Z'),
    fetchImpl,
  });
}

describe('真人素材容量核心规则', () => {
  const quota = {
    enabled: true,
    profileLimit: 10,
    activeLimit: 2,
    assetsPerActor: 2 as const,
    sourcePlanId: 'plan-test',
  };
  const snapshot = {
    residentGroups: 40,
    residentAssets: 38,
    heldGroupSlots: 2,
    heldAssetSlots: 2,
    groupSoftLimit: 45,
    assetSoftLimit: 45,
  };

  it('同时满足用户与共享软上限时返回原子预留槽位', () => {
    expect(decideRealPortraitCapacity({
      quota,
      currentUserActiveActors: 1,
      snapshot,
    })).toEqual({
      outcome: 'reserve',
      groupSlots: 1,
      assetSlots: 2,
      reason: null,
    });
  });

  it('共享组或素材容量包含 resident 与 held，满额时进入等待队列', () => {
    expect(decideRealPortraitCapacity({
      quota,
      currentUserActiveActors: 1,
      snapshot: {
        ...snapshot,
        residentGroups: 43,
      },
    })).toEqual({
      outcome: 'wait-capacity',
      groupSlots: 1,
      assetSlots: 2,
      reason: '真人组共享容量暂时不足',
    });

    expect(decideRealPortraitCapacity({
      quota,
      currentUserActiveActors: 1,
      needsGroup: false,
      desiredAssetCount: 2,
      snapshot: {
        ...snapshot,
        residentAssets: 42,
      },
    })).toEqual({
      outcome: 'wait-capacity',
      groupSlots: 0,
      assetSlots: 2,
      reason: '真人素材共享容量暂时不足',
    });
  });

  it('新增真人组超过用户活跃额度时优先失败，但已有组追加素材不重复占用活跃额度', () => {
    expect(decideRealPortraitCapacity({
      quota,
      currentUserActiveActors: 2,
      snapshot,
    })).toMatchObject({
      outcome: 'over-user-quota',
      groupSlots: 1,
      assetSlots: 2,
    });

    expect(decideRealPortraitCapacity({
      quota,
      currentUserActiveActors: 2,
      needsGroup: false,
      desiredAssetCount: 1,
      snapshot,
    })).toMatchObject({
      outcome: 'reserve',
      groupSlots: 0,
      assetSlots: 1,
    });
  });

  it('档案数达到套餐上限时 fail closed，无限档案额度则放行', () => {
    expect(() => assertProfileQuota(10, 10)).toThrowError(
      expect.objectContaining({
        code: 'REAL_PORTRAIT_PROFILE_QUOTA_EXCEEDED',
        statusCode: 409,
      }),
    );
    expect(() => assertProfileQuota(9, 10)).not.toThrow();
    expect(() => assertProfileQuota(999, null)).not.toThrow();
  });

  it('只淘汰空闲至少 30 天且未被生成或远端操作 pin 的 LRU 素材组', () => {
    const plan = selectRealPortraitEvictionPlan({
      now: new Date('2026-07-30T00:00:00.000Z'),
      requiredGroupSlots: 2,
      requiredAssetSlots: 3,
      candidates: [
        {
          materializationId: 'recent',
          actorId: 'actor-recent',
          activeAssetCount: 2,
          lastUsedAt: '2026-07-01T00:00:00.000Z',
          activatedAt: '2026-05-01T00:00:00.000Z',
          hasPinnedGeneration: false,
          hasPendingRemoteOperation: false,
          status: 'active',
        },
        {
          materializationId: 'generation-pinned',
          actorId: 'actor-generation-pinned',
          activeAssetCount: 2,
          lastUsedAt: '2026-05-01T00:00:00.000Z',
          activatedAt: null,
          hasPinnedGeneration: true,
          hasPendingRemoteOperation: false,
          status: 'active',
        },
        {
          materializationId: 'operation-pinned',
          actorId: 'actor-operation-pinned',
          activeAssetCount: 2,
          lastUsedAt: '2026-05-01T00:00:00.000Z',
          activatedAt: null,
          hasPinnedGeneration: false,
          hasPendingRemoteOperation: true,
          status: 'eviction_warning',
        },
        {
          materializationId: 'never-used',
          actorId: 'actor-never-used',
          activeAssetCount: 1,
          lastUsedAt: null,
          activatedAt: null,
          hasPinnedGeneration: false,
          hasPendingRemoteOperation: false,
          status: 'active',
        },
        {
          materializationId: 'old-large',
          actorId: 'actor-old-large',
          activeAssetCount: 2,
          lastUsedAt: '2026-06-01T00:00:00.000Z',
          activatedAt: null,
          hasPinnedGeneration: false,
          hasPendingRemoteOperation: false,
          status: 'eviction_warning',
        },
        {
          materializationId: 'exactly-30-days',
          actorId: 'actor-exactly-30-days',
          activeAssetCount: 2,
          lastUsedAt: '2026-06-30T00:00:00.000Z',
          activatedAt: null,
          hasPinnedGeneration: false,
          hasPendingRemoteOperation: false,
          status: 'active',
        },
      ],
    });

    expect(plan).toEqual({
      candidateIds: ['never-used', 'old-large'],
      freedGroupSlots: 2,
      freedAssetSlots: 3,
      complete: true,
    });
    expect(plan.candidateIds).not.toContain('generation-pinned');
    expect(plan.candidateIds).not.toContain('operation-pinned');
    expect(plan.candidateIds).not.toContain('recent');
  });
});

describe('真人验证会话密钥', () => {
  beforeEach(() => {
    setEncryptionKey(TEST_ENCRYPTION_KEY);
  });

  afterEach(() => {
    setEncryptionKey(originalEncryptionKey);
  });

  it('生成不可预测的 bearer token，并用 keyed fingerprint 匹配', () => {
    const first = createRealPortraitBearerToken();
    const second = createRealPortraitBearerToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    expect(fingerprintRealPortraitSecret(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprintRealPortraitSecret(first)).toBe(fingerprintRealPortraitSecret(first));
    expect(fingerprintRealPortraitSecret(first)).not.toBe(fingerprintRealPortraitSecret(second));
  });

  it('使用 AES-GCM 加密并可完整解密，持久化结构不包含明文', () => {
    const plaintext = 'byted-token-sensitive-value';
    const encrypted = encryptRealPortraitSecret(plaintext);

    expect(encrypted.ciphertext).not.toContain(plaintext);
    expect(encrypted.iv).not.toContain(plaintext);
    expect(encrypted.tag).not.toContain(plaintext);
    expect(decryptRealPortraitSecret(encrypted)).toBe(plaintext);
  });

  it('密文被篡改时 fail closed，不返回任何部分明文', () => {
    const encrypted = encryptRealPortraitSecret('secret-session-token');
    const firstCharacter = encrypted.ciphertext[0] === 'A' ? 'B' : 'A';

    expect(() => decryptRealPortraitSecret({
      ...encrypted,
      ciphertext: `${firstCharacter}${encrypted.ciphertext.slice(1)}`,
    })).toThrowError(expect.objectContaining({
      code: 'REAL_PORTRAIT_SECRET_DECRYPT_FAILED',
      statusCode: 503,
    }));
  });

  it('未配置至少 32 位密钥时加密与指纹均 fail closed', () => {
    setEncryptionKey(undefined);

    expect(() => encryptRealPortraitSecret('secret')).toThrowError(expect.objectContaining({
      code: 'REAL_PORTRAIT_SECRET_KEY_NOT_CONFIGURED',
      statusCode: 503,
    }));
    expect(() => fingerprintRealPortraitSecret('secret')).toThrowError(expect.objectContaining({
      code: 'REAL_PORTRAIT_SECRET_KEY_NOT_CONFIGURED',
      statusCode: 503,
    }));
  });
});

describe('真人素材 provider', () => {
  it('disabled provider 的所有远端能力都显式 fail closed', async () => {
    const provider = createDisabledRealPortraitProvider();

    expect(provider.name).toBe('disabled');
    await expect(provider.createVisualValidationSession({
      callbackUrl: 'https://callback.example.com/portrait',
      projectName: 'default',
    })).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_PROVIDER_NOT_CONFIGURED',
      statusCode: 503,
    });
    await expect(provider.getAsset('asset-1', 'default')).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_PROVIDER_NOT_CONFIGURED',
      statusCode: 503,
    });
    await expect(provider.listRealPortraitAssets({
      groupId: 'group-1',
      name: '正面照',
      projectName: 'default',
    })).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_PROVIDER_NOT_CONFIGURED',
      statusCode: 503,
    });
  });

  it('fake provider 支持验证会话与素材 CRUD，删除后查询返回 404', async () => {
    const provider = createFakeRealPortraitProvider();
    const session = await provider.createVisualValidationSession({
      callbackUrl: 'https://callback.example.com/portrait',
      projectName: 'default',
    });
    const validation = await provider.getVisualValidationResult(session.bytedToken, 'default');

    expect(provider.name).toBe('fake-real-portrait');
    expect(session.bytedToken).toMatch(/^fake-byted-/);
    const fakeH5Url = new URL(session.h5Link);
    const fragment = new URLSearchParams(fakeH5Url.hash.slice(1));
    expect(fakeH5Url.search).toBe('');
    expect(fragment.get('bytedToken')).toBe(session.bytedToken);
    expect(fragment.get('callbackUrl')).toBe('https://callback.example.com/portrait');
    expect(validation.groupId).toMatch(/^fake-group-/);

    const first = await provider.createAsset({
      groupId: validation.groupId,
      sourceUrl: 'https://storage.example.com/portrait-1.jpg',
      name: '正面照',
      assetType: 'Image',
      projectName: 'default',
    });
    const second = await provider.createAsset({
      groupId: validation.groupId,
      sourceUrl: 'https://storage.example.com/portrait-2.jpg',
      name: '半身照',
      assetType: 'Image',
      projectName: 'default',
    });
    const other = await provider.createAsset({
      groupId: 'other-group',
      sourceUrl: 'https://storage.example.com/portrait-3.jpg',
      name: '正面照',
      assetType: 'Image',
      projectName: 'default',
    });

    await expect(provider.listRealPortraitAssets({
      groupId: validation.groupId,
      name: '正面照',
      projectName: 'default',
    })).resolves.toMatchObject({
      items: [{
        id: first.assetId,
        groupId: validation.groupId,
        name: '正面照',
        projectName: 'default',
      }],
      totalCount: 1,
    });
    await expect(provider.listRealPortraitAssets({
      groupId: validation.groupId,
      name: '不存在',
      projectName: 'default',
    })).resolves.toMatchObject({ items: [], totalCount: 0 });
    await expect(provider.listRealPortraitAssets({
      groupId: 'other-group',
      name: '正面照',
      projectName: 'default',
    })).resolves.toMatchObject({
      items: [{ id: other.assetId, groupId: 'other-group' }],
      totalCount: 1,
    });

    const duplicate = await provider.createAsset({
      groupId: validation.groupId,
      sourceUrl: 'https://storage.example.com/portrait-1-retried.jpg',
      name: '正面照',
      assetType: 'Image',
      projectName: 'default',
    });
    expect(duplicate.assetId).toBe(first.assetId);
    await expect(provider.listRealPortraitAssets({
      groupId: validation.groupId,
      name: '正面照',
      projectName: 'default',
    })).resolves.toMatchObject({
      items: [{ id: first.assetId, sourceUrl: 'https://storage.example.com/portrait-1-retried.jpg' }],
      totalCount: 1,
    });

    await expect(provider.getAsset(first.assetId, 'default')).resolves.toMatchObject({
      id: first.assetId,
      groupId: validation.groupId,
      status: 'Active',
      assetType: 'Image',
      projectName: 'default',
    });

    await provider.deleteAsset(first.assetId, 'default');
    await expect(provider.getAsset(first.assetId, 'default')).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_FAKE_NOT_FOUND',
      statusCode: 404,
    });
    await expect(provider.listRealPortraitAssets({
      groupId: validation.groupId,
      name: '正面照',
      projectName: 'default',
    })).resolves.toMatchObject({ items: [], totalCount: 0 });

    await provider.deleteAssetGroup(validation.groupId, 'default');
    await expect(provider.getAsset(second.assetId, 'default')).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_FAKE_NOT_FOUND',
      statusCode: 404,
    });
    await expect(provider.getAsset(other.assetId, 'default')).resolves.toMatchObject({
      id: other.assetId,
      groupId: 'other-group',
    });
    await expect(provider.getVisualValidationResult('missing-token', 'default')).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_FAKE_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('生成固定可复核的 Volc AK/SK HMAC 请求', () => {
    const request = buildVolcengineRealPortraitRequest({
      action: 'GetAsset',
      body: { Id: 'asset-1', ProjectName: 'default' },
      accessKeyId: 'TESTAK',
      secretAccessKey: 'TESTSECRET',
      endpoint: 'https://ark.cn-beijing.volcengineapi.com/',
      region: 'cn-beijing',
      service: 'ark',
      version: '2024-01-01',
      now: new Date('2026-07-30T01:02:03.000Z'),
    });

    expect(request.url).toBe(
      'https://ark.cn-beijing.volcengineapi.com/?Action=GetAsset&Version=2024-01-01',
    );
    expect(request.body).toBe('{"Id":"asset-1","ProjectName":"default"}');
    expect(request.headers).toEqual({
      Authorization: 'HMAC-SHA256 Credential=TESTAK/20260730/cn-beijing/ark/request, '
        + 'SignedHeaders=content-type;host;x-content-sha256;x-date, '
        + 'Signature=73a4cc984799a17e2815fa1f528bcd0b29484a720760b2c4e3dc9604471fda66',
      'Content-Type': 'application/json',
      'X-Content-Sha256': 'f350a83877d1ff873274e702ef71d8adc3953c20c2b932d346bc50156831cc99',
      'X-Date': '20260730T010203Z',
    });
    expect(request.canonicalRequest).toContain(
      '\nAction=GetAsset&Version=2024-01-01\n',
    );
  });

  it('Volc provider 缺少 AK 或 SK 时不发起网络请求并 fail closed', async () => {
    const fetchMock = vi.fn();
    const provider = volcProvider(fetchMock as unknown as typeof fetch, {
      accessKeyId: ' ',
      secretAccessKey: ' ',
    });

    await expect(provider.getAsset('asset-1', 'default')).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_PROVIDER_NOT_CONFIGURED',
      statusCode: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('解析七类 Volc 成功响应、失败素材详情和 request id，且请求体使用官方字段', async () => {
    const fetchMock = vi.fn(async (
      urlValue: string | URL | Request,
      _init?: RequestInit,
    ) => {
      const url = new URL(
        typeof urlValue === 'string'
          ? urlValue
          : urlValue instanceof URL
            ? urlValue.toString()
            : urlValue.url,
      );
      switch (url.searchParams.get('Action')) {
        case 'CreateVisualValidateSession':
          return jsonResponse({
            ResponseMetadata: { RequestId: 'request-session' },
            Result: {
              BytedToken: 'byted-token-1',
              H5Link: 'https://verify.example.com/h5/session-1',
            },
          });
        case 'GetVisualValidateResult':
          return jsonResponse({
            ResponseMetadata: { RequestId: 'request-validation' },
            Result: { GroupId: 'group-1' },
          });
        case 'CreateAsset':
          return jsonResponse({
            ResponseMetadata: { RequestId: 'request-create-asset' },
            Result: { Id: 'asset-1' },
          });
        case 'ListAssets':
          return jsonResponse({
            ResponseMetadata: { RequestId: 'request-list-assets' },
            Result: {
              Items: [{
                Id: 'asset-1',
                Name: '正面照',
                URL: 'https://storage.example.com/portrait.jpg',
                AssetType: 'Image',
                GroupId: 'group-1',
                Status: 'Active',
                ProjectName: 'default',
              }],
              TotalCount: 1,
            },
          });
        case 'GetAsset':
          return jsonResponse({
            ResponseMetadata: { RequestId: 'metadata-request-id' },
            Result: {
              Id: 'asset-1',
              Name: '正面照',
              URL: 'https://storage.example.com/portrait.jpg',
              AssetType: 'Image',
              GroupId: 'group-1',
              Status: 'Failed',
              ProjectName: 'default',
              Error: {
                Code: 'ModerationRejected',
                Message: '素材审核未通过',
              },
            },
          }, {
            headers: { 'x-request-id': 'header-request-id' },
          });
        case 'DeleteAsset':
          return jsonResponse({
            ResponseMetadata: { RequestId: 'request-delete-asset' },
            Result: { Id: 'asset-1' },
          });
        case 'DeleteAssetGroup':
          return jsonResponse({
            ResponseMetadata: { RequestId: 'request-delete-group' },
            Result: { Id: 'group-1' },
          });
        default:
          return jsonResponse({ ResponseMetadata: { RequestId: 'unknown' } }, { status: 404 });
      }
    });
    const provider = volcProvider(fetchMock as unknown as typeof fetch);

    await expect(provider.createVisualValidationSession({
      callbackUrl: 'https://callback.example.com/portrait',
      projectName: 'default',
    })).resolves.toEqual({
      bytedToken: 'byted-token-1',
      h5Link: 'https://verify.example.com/h5/session-1',
      requestId: 'request-session',
    });
    await expect(provider.getVisualValidationResult(
      'byted-token-1',
      'default',
    )).resolves.toEqual({
      groupId: 'group-1',
      requestId: 'request-validation',
    });
    await expect(provider.createAsset({
      groupId: 'group-1',
      sourceUrl: 'https://storage.example.com/portrait.jpg',
      name: '正面照',
      assetType: 'Image',
      projectName: 'default',
    })).resolves.toEqual({
      assetId: 'asset-1',
      requestId: 'request-create-asset',
    });
    await expect(provider.listRealPortraitAssets({
      groupId: 'group-1',
      name: '正面照',
      projectName: 'default',
      pageSize: 2,
    })).resolves.toEqual({
      items: [{
        id: 'asset-1',
        name: '正面照',
        sourceUrl: 'https://storage.example.com/portrait.jpg',
        assetType: 'Image',
        groupId: 'group-1',
        status: 'Active',
        projectName: 'default',
        errorCode: null,
        errorMessage: null,
        requestId: 'request-list-assets',
      }],
      totalCount: 1,
      requestId: 'request-list-assets',
    });
    await expect(provider.getAsset('asset-1', 'default')).resolves.toEqual({
      id: 'asset-1',
      name: '正面照',
      sourceUrl: 'https://storage.example.com/portrait.jpg',
      assetType: 'Image',
      groupId: 'group-1',
      status: 'Failed',
      projectName: 'default',
      errorCode: 'ModerationRejected',
      errorMessage: '素材审核未通过',
      requestId: 'header-request-id',
    });
    await expect(provider.deleteAsset('asset-1', 'default')).resolves.toEqual({
      assetId: 'asset-1',
      requestId: 'request-delete-asset',
    });
    await expect(provider.deleteAssetGroup('group-1', 'default')).resolves.toEqual({
      groupId: 'group-1',
      requestId: 'request-delete-group',
    });

    expect(fetchMock).toHaveBeenCalledTimes(7);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies).toEqual([
      {
        CallbackURL: 'https://callback.example.com/portrait',
        ProjectName: 'default',
      },
      {
        BytedToken: 'byted-token-1',
        ProjectName: 'default',
      },
      {
        GroupId: 'group-1',
        URL: 'https://storage.example.com/portrait.jpg',
        Name: '正面照',
        AssetType: 'Image',
        ProjectName: 'default',
      },
      {
        Filter: {
          GroupIds: ['group-1'],
          GroupType: 'LivenessFace',
          Name: '正面照',
        },
        PageNumber: 1,
        PageSize: 2,
        SortBy: 'CreateTime',
        SortOrder: 'Desc',
        ProjectName: 'default',
      },
      {
        Id: 'asset-1',
        ProjectName: 'default',
      },
      {
        Id: 'asset-1',
        ProjectName: 'default',
      },
      {
        Id: 'group-1',
        ProjectName: 'default',
      },
    ]);
  });

  it('ListAssets 对分页参数和响应结构 fail closed', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      ResponseMetadata: { RequestId: 'request-list-assets-invalid' },
      Result: { Items: [], TotalCount: -1 },
    }));
    const provider = volcProvider(fetchMock as unknown as typeof fetch);

    await expect(provider.listRealPortraitAssets({
      groupId: 'group-1',
      name: '正面照',
      projectName: 'default',
      pageSize: 0,
    })).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_INPUT_INVALID',
      statusCode: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(provider.listRealPortraitAssets({
      groupId: 'group-1',
      name: '正面照',
      projectName: 'default',
    })).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_PROVIDER_INVALID_RESPONSE',
      statusCode: 502,
      requestId: 'request-list-assets-invalid',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('解析 Volc 外层错误与无效 JSON 时保留 fail-closed 错误分类', async () => {
    const providerErrorResponse = volcProvider(
      vi.fn(async () => jsonResponse({
        ResponseMetadata: {
          RequestId: 'request-error',
          Error: {
            Code: 'InvalidParameter',
            Message: '参数不合法',
          },
        },
      })) as unknown as typeof fetch,
    );

    await expect(providerErrorResponse.getAsset('asset-1', 'default')).rejects.toMatchObject({
      code: 'InvalidParameter',
      statusCode: 409,
      requestId: 'request-error',
      message: '参数不合法',
    });

    const invalidJsonProvider = volcProvider(
      vi.fn(async () => new Response('<html>bad gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof fetch,
    );

    await expect(invalidJsonProvider.getAsset('asset-1', 'default')).rejects.toMatchObject({
      code: 'REAL_PORTRAIT_PROVIDER_INVALID_RESPONSE',
      statusCode: 502,
    });
  });
});
