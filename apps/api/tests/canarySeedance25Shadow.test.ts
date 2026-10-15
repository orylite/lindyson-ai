import { describe, expect, test } from 'vitest';
import {
  assertShadowCanarySafety,
  bindCompletedOutputAsReferenceVideo,
  buildCanarySignedUploadRequest,
  calculateCanaryEstimatedListPrice,
  isExactCanaryEstimatedListPrice,
  redactCanaryError,
  SHADOW_CANARY_CONFIRMATION,
  SHADOW_CANARY_EVIDENCE_RETENTION,
  SHADOW_SCENARIO_BLUEPRINTS,
  type ScenarioReference,
  type ShadowScenarioId,
  validateShadowOutputGeometry,
} from '../src/tools/canarySeedance25Shadow.js';

const safeInput = {
  confirmation: SHADOW_CANARY_CONFIRMATION,
  apiBaseUrl: 'http://127.0.0.1:14300',
  databaseUrl: 'postgres://canary:secret@shadow-postgres:5432/lindyson_shadow_release_075',
  expectedDatabaseName: 'lindyson_shadow_release_075',
};

describe('Seedance 2.5 影子 canary 硬门禁', () => {
  test('只接受精确确认短语、回环候选 API 与显式影子数据库', () => {
    const result = assertShadowCanarySafety(safeInput);

    expect(result.apiBaseUrl.origin).toBe('http://127.0.0.1:14300');
    expect(result.expectedDatabaseName).toBe('lindyson_shadow_release_075');
  });

  test.each([
    [{ ...safeInput, confirmation: undefined }, 'SHADOW_CANARY_CONFIRMATION_REQUIRED'],
    [{ ...safeInput, confirmation: 'yes' }, 'SHADOW_CANARY_CONFIRMATION_REQUIRED'],
    [{ ...safeInput, apiBaseUrl: 'https://127.0.0.1:14300' }, 'SHADOW_CANARY_PUBLIC_API_REJECTED'],
    [{ ...safeInput, apiBaseUrl: 'http://api.lindyson.com' }, 'SHADOW_CANARY_PUBLIC_API_REJECTED'],
    [{ ...safeInput, apiBaseUrl: 'http://127.0.0.1:14300/api' }, 'SHADOW_CANARY_PUBLIC_API_REJECTED'],
    [{ ...safeInput, expectedDatabaseName: 'lindyson', databaseUrl: 'postgres://u:p@127.0.0.1/lindyson' }, 'SHADOW_CANARY_PRODUCTION_DATABASE_REJECTED'],
    [{ ...safeInput, expectedDatabaseName: 'lindyson_production_shadow' }, 'SHADOW_CANARY_PRODUCTION_DATABASE_REJECTED'],
    [{ ...safeInput, databaseUrl: 'postgres://u:p@203.0.113.10/lindyson_shadow_release_075' }, 'SHADOW_CANARY_PRODUCTION_DATABASE_REJECTED'],
    [{ ...safeInput, databaseUrl: 'postgres://u:p@shadow-postgres/other_shadow', expectedDatabaseName: 'lindyson_shadow_release_075' }, 'SHADOW_CANARY_PRODUCTION_DATABASE_REJECTED'],
  ])('拒绝不安全运行目标 %#', (input, expectedCode) => {
    expect(() => assertShadowCanarySafety(input)).toThrow(
      expect.objectContaining({ code: expectedCode }),
    );
  });

  test('错误输出隐藏数据库 URL、公网 URL、邮箱和凭据', () => {
    const safe = redactCanaryError(Object.assign(
      new Error(
        'postgres://user:pass@shadow-postgres/db https://api.example.com/a '
        + 'owner@example.com token=abc123 password=hunter2 Authorization: Bearer session-value',
      ),
      { code: 'CANARY_FAILED' },
    ));

    expect(safe.code).toBe('CANARY_FAILED');
    expect(safe.message).toContain('[已隐藏数据库地址]');
    expect(safe.message).toContain('[已隐藏地址]');
    expect(safe.message).toContain('[已隐藏邮箱]');
    expect(safe.message).toContain('token=[已隐藏]');
    expect(safe.message).toContain('password=[已隐藏]');
    expect(safe.message).toContain('authorization=[已隐藏]');
    expect(safe.message).not.toMatch(/user:pass|api\.example|owner@example|abc123|hunter2|session-value/u);
  });
});

test('影子 canary 固定覆盖五类且顺序稳定', () => {
  expect(SHADOW_SCENARIO_BLUEPRINTS).toEqual([
    expect.objectContaining({
      id: 'no-reference', resolution: '480p', durationSeconds: 5,
      referenceRoles: [], hasReferenceVideo: false,
    }),
    expect.objectContaining({
      id: 'reference-video', durationSeconds: 25,
      referenceRoles: ['reference_video'], hasReferenceVideo: true,
    }),
    expect.objectContaining({
      id: 'audio-only', referenceRoles: ['reference_audio'], hasReferenceVideo: false,
    }),
    expect.objectContaining({
      id: 'first-last-adaptive', mode: 'first-last', aspectRatio: 'adaptive',
      referenceRoles: ['first_frame', 'last_frame'],
    }),
    expect.objectContaining({
      id: '720p-25s', resolution: '720p', durationSeconds: 25,
      referenceRoles: [], hasReferenceVideo: false,
    }),
  ]);
});

test.each([
  { billableTokens: 48_437, unitPricePerMillionCny: 70, expected: '3.390590' },
  { billableTokens: 96_475, unitPricePerMillionCny: 42, expected: '4.051950' },
])('供应商估算成本必须精确等于 tokens × 刊例价 / 1,000,000：%#', input => {
  expect(calculateCanaryEstimatedListPrice(
    input.billableTokens,
    input.unitPricePerMillionCny,
  )).toBe(input.expected);
  expect(isExactCanaryEstimatedListPrice({
    billableTokens: input.billableTokens,
    unitPricePerMillionCny: input.unitPricePerMillionCny,
    estimatedCostCny: input.expected,
  })).toBe(true);
  expect(isExactCanaryEstimatedListPrice({
    billableTokens: input.billableTokens,
    unitPricePerMillionCny: input.unitPricePerMillionCny,
    estimatedCostCny: (Number(input.expected) + 0.000001).toFixed(6),
  })).toBe(false);
});

test('成功摘要只声明 runner 保留的 dump、脱敏 NDJSON 与 TOS 对象索引', () => {
  expect(SHADOW_CANARY_EVIDENCE_RETENTION).toEqual({
    owner: 'shadow-runner-finalizer',
    retainedArtifacts: [
      'post-canary-dump',
      'redacted-ndjson-summary',
      'tos-object-index',
    ],
  });
  expect(JSON.stringify(SHADOW_CANARY_EVIDENCE_RETENTION)).not.toMatch(/shadow-(?:database|storage|volume).*retained/u);
});

test('参考视频场景使用首项已验证归档成片，避免测试夹具编码差异掩盖正式链路', () => {
  const scenarios: Array<{ id: ShadowScenarioId; references: ScenarioReference[] }> = [
    { id: 'no-reference', references: [] },
    { id: 'reference-video', references: [{ assetId: 'uploaded-fixture', role: 'reference_video' }] },
  ];

  bindCompletedOutputAsReferenceVideo(
    scenarios,
    '00000000-0000-4000-8000-000000000025',
  );

  expect(scenarios[1]?.references).toEqual([{
    assetId: '00000000-0000-4000-8000-000000000025',
    role: 'reference_video',
  }]);
});

test('TOS 签名构造成 multipart POST，字段在前且不注入自定义请求头', () => {
  const upload = buildCanarySignedUploadRequest({
    signature: {
      driver: 'tos',
      method: 'POST',
      uploadUrl: 'https://bucket.tos-cn-beijing.volces.com',
      headers: {},
      fields: {
        key: 'users/canary/upload-staging/material.png',
        policy: 'base64-policy',
        'content-type': 'image/png',
        'x-tos-signature': 'signature-value',
      },
    },
    bytes: Buffer.from('png-bytes'),
    filename: 'material.png',
    contentType: 'image/png',
  });

  expect(upload.driver).toBe('tos');
  expect(upload.request.method).toBe('POST');
  expect(upload.request).not.toHaveProperty('headers');
  expect(upload.request.body).toBeInstanceOf(FormData);
  const form = upload.request.body as FormData;
  expect(form.get('key')).toBe('users/canary/upload-staging/material.png');
  expect(form.get('policy')).toBe('base64-policy');
  expect(form.get('content-type')).toBe('image/png');
  const file = form.get('file');
  expect(file).toBeInstanceOf(Blob);
  expect((file as File).name).toBe('material.png');
  expect((file as File).type).toBe('image/png');
});

describe('Seedance 2.5 影子输出规格证据', () => {
  test.each([
    [{ width: 480, height: 854, durationSeconds: 4.6, requestedDurationSeconds: 5, resolution: '480p', aspectRatio: '9:16' }, 480],
    [{ width: 1280, height: 720, durationSeconds: 25.4, requestedDurationSeconds: 25, resolution: '720p', aspectRatio: '16:9' }, 720],
    [{ width: 1280, height: 720, durationSeconds: 30.4, requestedDurationSeconds: 30, resolution: '720p', aspectRatio: '16:9' }, 720],
    // adaptive 按 canary 的 640x360 首帧比例验证；输出尺寸仍按 480p 短边档。
    [{ width: 854, height: 480, durationSeconds: 5, requestedDurationSeconds: 5, resolution: '480p', aspectRatio: 'adaptive' }, 480],
  ] as const)('接受时长、短边和比例均在阈值内的输出 %#', (input, shortEdge) => {
    expect(validateShadowOutputGeometry(input)).toMatchObject({ shortEdge, requestedShortEdge: shortEdge });
  });

  test.each([
    [
      { width: 480, height: 854, durationSeconds: 3.9, requestedDurationSeconds: 5, resolution: '480p', aspectRatio: '9:16' },
      'SHADOW_CANARY_OUTPUT_DURATION_INVALID',
    ],
    [
      { width: 448, height: 796, durationSeconds: 5, requestedDurationSeconds: 5, resolution: '480p', aspectRatio: '9:16' },
      'SHADOW_CANARY_OUTPUT_RESOLUTION_INVALID',
    ],
    [
      { width: 640, height: 480, durationSeconds: 5, requestedDurationSeconds: 5, resolution: '480p', aspectRatio: 'adaptive' },
      'SHADOW_CANARY_OUTPUT_ASPECT_RATIO_INVALID',
    ],
  ] as const)('拒绝越过任一输出阈值的证据 %#', (input, code) => {
    expect(() => validateShadowOutputGeometry(input)).toThrow(expect.objectContaining({ code }));
  });
});
