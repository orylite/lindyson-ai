import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  withTransaction: vi.fn(),
  createPaymentOrder: vi.fn(),
  normalizePaymentLaunch: vi.fn(),
  queryPaymentOrder: vi.fn(),
  getPaymentChannelCredentialsByRevision: vi.fn(),
  markOrderPaid: vi.fn(),
  markOrderPaymentTerminalFromClaim: vi.fn(),
}));

vi.mock('../src/config/env.js', () => ({
  env: {
    PAYMENT_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    PAYMENT_ORDER_EXPIRES_SECONDS: 900,
  },
}));
vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
  withTransaction: mocks.withTransaction,
}));
vi.mock('../src/payments/jeepayService.js', () => ({
  createPaymentOrder: mocks.createPaymentOrder,
  normalizePaymentLaunch: mocks.normalizePaymentLaunch,
  queryPaymentOrder: mocks.queryPaymentOrder,
}));
vi.mock('../src/payments/paymentChannelService.js', () => ({
  getPaymentChannelCredentialsByRevision: mocks.getPaymentChannelCredentialsByRevision,
}));
vi.mock('../src/domain/ordersService.js', () => ({
  markOrderPaid: mocks.markOrderPaid,
  markOrderPaymentTerminalFromClaim: mocks.markOrderPaymentTerminalFromClaim,
}));

import {
  createPaymentRetryAttempt,
  ensurePaymentAttempt,
  getCurrentPaymentAttempt,
  markPaymentAttemptReady,
  markPaymentAttemptManualReviewFromClaim,
  markPaymentAttemptManualReviewFromProviderEvent,
  processDuePaymentAttempts,
} from '../src/payments/paymentAttemptService.js';

describe('支付 attempt 状态机', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPaymentChannelCredentialsByRevision.mockResolvedValue(channelConfig());
    mocks.markOrderPaid.mockResolvedValue({ status: 'paid' });
    mocks.markOrderPaymentTerminalFromClaim.mockResolvedValue({ status: 'failed' });
  });

  it('二维码按 attempt ID 作为 AAD 加密，重放同一 attempt 可恢复原 launch', async () => {
    let saved: ReturnType<typeof attemptRow> | undefined;
    mocks.poolQuery.mockImplementationOnce(async (_sql: unknown, values?: unknown[]) => {
      saved = attemptRow({
        status: 'ready',
        provider_order_id: 'P100',
        launch_ciphertext: values?.[3],
        launch_iv: values?.[4],
        launch_tag: values?.[5],
      });
      return result([saved]);
    });
    const launch = { surface: 'pc' as const, type: 'qr' as const, codeUrl: 'https://openapi.alipay.com/pay?id=P100' };

    await expect(markPaymentAttemptReady(claim(), 'P100', launch)).resolves.toMatchObject({ launch });
    mocks.poolQuery.mockResolvedValueOnce(result([saved!]));
    await expect(getCurrentPaymentAttempt(ORDER_ID, 'user-1')).resolves.toMatchObject({ launch });
  });

  it('旧 lease token 更新零行时抛出 stale claim，不能写终态', async () => {
    mocks.poolQuery.mockResolvedValueOnce(result([]));
    await expect(markPaymentAttemptReady(
      claim(),
      'P100',
      { surface: 'pc', type: 'qr', codeUrl: 'https://openapi.alipay.com/pay?id=P100' },
    )).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_STALE_CLAIM', statusCode: 409 });
  });

  it('旧 lease token 不能将 attempt 转人工核对', async () => {
    mocks.poolQuery.mockResolvedValueOnce(result([]));
    await expect(markPaymentAttemptManualReviewFromClaim(
      claim(),
      '供应商字段冲突',
    )).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_STALE_CLAIM', statusCode: 409 });
  });

  it('已支付订单即使当前 attempt 失败也禁止重置为 pending', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(result([{ ...retryOrder(), status: 'paid' }]))
        .mockResolvedValueOnce(result([])),
    };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(createPaymentRetryAttempt(
      ORDER_ID,
      'user-1',
      'payment-retry-new-key',
      channelConfig(),
      'https://www.lindyson.cn',
    )).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', statusCode: 409 });
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO payment_attempts'))).toBe(false);
  });

  it('重放相同 retry 幂等键时返回原 attempt，不受订单后续终态影响', async () => {
    const duplicate = attemptRow({ status: 'failed', terminal_at: '2026-07-10T06:05:00.000Z' });
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(result([{ ...retryOrder(), status: 'paid' }]))
        .mockResolvedValueOnce(result([duplicate])),
    };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await expect(createPaymentRetryAttempt(
      ORDER_ID,
      'user-1',
      duplicate.idempotency_key,
      channelConfig(),
      'https://www.lindyson.cn',
    )).resolves.toMatchObject({ id: duplicate.id, status: 'failed' });
  });

  it('首次 attempt 将可信请求来源作为不可变快照显式写入', async () => {
    const client = {
      query: vi.fn(async (sql: unknown, _values?: unknown[]) => {
        const query = String(sql);
        if (query.includes('JOIN payment_attempts attempt')) return result([]);
        if (query.includes('INSERT INTO payment_attempts')) {
          return result([attemptRow({ status: 'queued', return_origin: 'https://www.lindyson.cn' })]);
        }
        return result([]);
      }),
    };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await ensurePaymentAttempt({
      id: ORDER_ID,
      amount: 22800,
      paymentSurface: 'mobile',
      paymentWayCode: 'ALI_WAP',
    }, 'payment-create-cn', 'request-hash', channelConfig(), 'https://www.lindyson.cn');

    const insertCall = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO payment_attempts'));
    expect(String(insertCall?.[0])).toContain('return_origin');
    expect(insertCall?.[1]).toEqual(expect.arrayContaining(['https://www.lindyson.cn']));
  });

  it('支付重试把本次可信来源写入新 attempt，不继承旧 attempt 来源', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(result([retryOrder()]))
        .mockResolvedValueOnce(result([]))
        .mockResolvedValueOnce(result([attemptRow({
          status: 'failed',
          return_origin: 'https://www.lindyson.com',
        })]))
        .mockResolvedValueOnce(result([attemptRow({
          attempt: 2,
          status: 'queued',
          return_origin: 'https://www.lindyson.cn',
        })]))
        .mockResolvedValueOnce(result([])),
    };
    mocks.withTransaction.mockImplementation(async callback => callback(client));

    await createPaymentRetryAttempt(
      ORDER_ID,
      'user-1',
      'payment-retry-cn',
      channelConfig(),
      'https://www.lindyson.cn',
    );

    const insertCall = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO payment_attempts'));
    expect(String(insertCall?.[0])).toContain('return_origin');
    expect(insertCall?.[1]).toEqual(expect.arrayContaining(['https://www.lindyson.cn']));
  });

  it('事件冲突允许 paid attempt 转人工核对并清除 launch 密文', async () => {
    mocks.poolQuery.mockResolvedValueOnce(result([attemptRow({ status: 'manual-review' })]));
    await markPaymentAttemptManualReviewFromProviderEvent(
      { query: mocks.poolQuery } as never,
      ATTEMPT_ID,
      '同事件键载荷冲突',
    );
    const [sql] = mocks.poolQuery.mock.calls[0]!;
    expect(String(sql)).toContain("SET status = 'manual-review'");
    expect(String(sql)).toContain('launch_ciphertext = NULL');
  });

  it('uncertain attempt 恢复时只查单，绝不再次调用创建接口', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([dueAttempt({ previous_status: 'uncertain' })]))
      .mockResolvedValueOnce(result([attemptRow({ status: 'uncertain' })]));
    mocks.queryPaymentOrder.mockResolvedValue(paymentQuery(1));

    await expect(processDuePaymentAttempts(1)).resolves.toEqual({
      claimed: 1,
      ready: 0,
      paid: 0,
      failed: 0,
      uncertain: 1,
    });
    expect(mocks.createPaymentOrder).not.toHaveBeenCalled();
    expect(mocks.queryPaymentOrder).toHaveBeenCalledWith(channelConfig(), MERCHANT_ORDER_NO);
  });

  it('queued 创建响应丢失后先查固定商户号，不能进行第二次创建', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([dueAttempt({
        previous_status: 'queued',
        return_origin: 'https://www.lindyson.cn',
      })]))
      .mockResolvedValueOnce(result([attemptRow({ status: 'uncertain' })]));
    mocks.createPaymentOrder.mockRejectedValue(new Error('response lost'));
    mocks.queryPaymentOrder.mockResolvedValue(paymentQuery(1));

    await processDuePaymentAttempts(1);
    expect(mocks.createPaymentOrder).toHaveBeenCalledOnce();
    expect(mocks.createPaymentOrder).toHaveBeenCalledWith(
      channelConfig(),
      expect.objectContaining({ returnOrigin: 'https://www.lindyson.cn' }),
    );
    expect(mocks.queryPaymentOrder).toHaveBeenCalledOnce();
    expect(mocks.createPaymentOrder.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.queryPaymentOrder.mock.invocationCallOrder[0]!);
  });

  it('worker 确认失败时把当前 lease 传入订单与 attempt 原子终态服务', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([dueAttempt({ previous_status: 'uncertain' })]));
    mocks.queryPaymentOrder.mockResolvedValue(paymentQuery(3));

    await expect(processDuePaymentAttempts(1)).resolves.toMatchObject({ claimed: 1, failed: 1 });
    expect(mocks.markOrderPaymentTerminalFromClaim).toHaveBeenCalledWith(
      ORDER_ID,
      claimWithPreviousStatus('uncertain'),
      'failed',
      '支付未完成',
      'P100',
    );
  });
});

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const REVISION_ID = '33333333-3333-4333-8333-333333333333';
const LEASE_TOKEN = '44444444-4444-4444-8444-444444444444';
const MERCHANT_ORDER_NO = 'ord_123456789012345678901234';

function claim() {
  return {
    id: ATTEMPT_ID,
    orderId: ORDER_ID,
    merchantOrderNo: MERCHANT_ORDER_NO,
    channelRevisionId: REVISION_ID,
    returnOrigin: 'https://www.lindyson.com',
    leaseToken: LEASE_TOKEN,
    previousStatus: 'queued' as const,
    status: 'processing' as const,
  };
}

function claimWithPreviousStatus(previousStatus: 'queued' | 'processing' | 'ready' | 'uncertain') {
  return { ...claim(), previousStatus };
}

function attemptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    order_id: ORDER_ID,
    attempt: 1,
    idempotency_key: 'payment-retry-existing-key',
    request_hash: 'request-hash',
    merchant_order_no: MERCHANT_ORDER_NO,
    channel_revision_id: REVISION_ID,
    provider_order_id: null,
    amount: 22800,
    currency: 'CNY',
    surface: 'pc',
    way_code: 'ALI_WAP',
    return_origin: 'https://www.lindyson.com',
    status: 'processing',
    launch_ciphertext: null,
    launch_iv: null,
    launch_tag: null,
    attempts: 1,
    next_at: null,
    lease_token: LEASE_TOKEN,
    lease_until: '2026-07-10T06:01:00.000Z',
    error: null,
    manual_review_reason: null,
    created_at: '2026-07-10T06:00:00.000Z',
    updated_at: '2026-07-10T06:00:00.000Z',
    ...overrides,
  };
}

function dueAttempt(overrides: Record<string, unknown> = {}) {
  return {
    ...attemptRow(),
    previous_status: 'uncertain',
    plan_name: '专业版',
    billing: 'yearly',
    order_status: 'pending',
    ...overrides,
  };
}

function retryOrder() {
  return {
    id: ORDER_ID,
    user_id: 'user-1',
    amount: 22800,
    payment_surface: 'pc',
    payment_way_code: 'ALI_WAP',
    status: 'failed',
    current_payment_attempt_id: ATTEMPT_ID,
  };
}

function channelConfig() {
  return {
    revisionId: REVISION_ID,
    enabled: true,
    apiBase: 'https://pay.example.com',
    mchNo: 'M100',
    appId: 'APP100',
    apiKey: 'secret',
    hasApiKey: true,
    desktopWayCode: 'ALI_WAP' as const,
    mobileWayCode: 'ALI_WAP' as const,
    updatedAt: '2026-07-10T06:00:00.000Z',
  };
}

function paymentQuery(state: number) {
  return {
    payOrderId: 'P100',
    mchOrderNo: MERCHANT_ORDER_NO,
    mchNo: 'M100',
    appId: 'APP100',
    wayCode: 'ALI_WAP',
    amount: 22800,
    currency: 'CNY',
    state,
  };
}

function result<T>(rows: T[]) {
  return { rows, rowCount: rows.length };
}
