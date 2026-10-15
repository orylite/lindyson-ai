import { afterEach,describe,expect,it,vi } from 'vitest';
import {
  getAdminApiCostReconciliationDetail,
  getAdminApiCostAttemptsPage,
  getAdminApiCostTasksPage,
  getAdminApiCostUsersPage,
  getAdminApiUsage,
  getAdminApiUsageOverview,
  getAdminMultimodalCostOperationsPage,
  getAdminMultimodalCostOverview,
  getAdminMultimodalCostUsersPage,
  getAdminOverview,
  getAdminPaymentChannel,
  getAdminProviderBillingDetailsPage,
  getAdminProviderBillingOperationalUsagePage,
  getAdminProviderBillingOverview,
  getAssetCardsPage,
  getDashboardSummary,
  getGenerationJobsPage,
  getConsumptionSettings,
  getOrderHistory,
  getTkPromptGeneration,
  getTkPromptRun,
  resumeTkPromptEngine,
} from './queries';

describe('TK Prompt Engine 1.0 读取端点', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('独立读取run、generation和恢复快照', async () => {
    const run = {
      id: '00000000-0000-4000-8000-000000000201',
      schemaVersion: 1,
      status: 'analyzing',
      imageAssetIds: ['00000000-0000-4000-8000-000000000202'],
      evidenceProfile: null,
      failureReason: null,
      createdAt: '2026-08-17T00:00:00.000Z',
      completedAt: null,
    };
    const generation = {
      id: '00000000-0000-4000-8000-000000000203',
      runId: run.id,
      schemaVersion: 1,
      status: 'queued',
      evidenceReview: {
        productName: '自动喂食器',
        category: '宠物用品',
        rejectedVisibleFactIds: [],
        userConfirmedFacts: [],
        forbiddenClaims: [],
      },
      creativeInput: {
        targetMarket: 'United States',
        targetAudience: 'Pet owners',
        spokenLanguage: '英语',
        verifiedOffer: '',
        appearance: { mode: 'product_closeup' },
        availableScenes: [],
        availableAssets: ['商品参考图片1'],
      },
      videoConfig: {
        model: 'seedance-2.0',
        aspectRatio: '9:16',
        resolution: '720p',
        durationSeconds: 10,
      },
      isFree: true,
      credits: 0,
      creditStatus: 'none',
      strategySet: [],
      options: [],
      failureReason: null,
      createdAt: '2026-08-17T00:00:01.000Z',
      completedAt: null,
    };
    const responses = [{ run }, { generation }, { run, generation }];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(responses.shift()));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getTkPromptRun('run/id')).resolves.toEqual(run);
    await expect(getTkPromptGeneration('generation/id')).resolves.toEqual(generation);
    await expect(resumeTkPromptEngine()).resolves.toEqual({ run, generation });

    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      '/api/ai/tk-prompt-engine/runs/run%2Fid',
      '/api/ai/tk-prompt-engine/generations/generation%2Fid',
      '/api/ai/tk-prompt-engine/resume',
    ]);
  });
});

describe('消费设置滚动兼容查询', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('新客户端显式声明支持 25 秒档位', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse({
      items: [],
      videoModels: [],
      promptWizard: {
        generationCredits: 1,
        available: false,
        engineVersion: 4,
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await getConsumptionSettings();

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/ai/consumption-settings?videoDuration25=1');
  });
});

describe('订单历史查询', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('只发送游标分页参数并解析下一页游标', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      items: [],
      pagination: {
        limit: 10,
        hasPrevious: true,
        hasNext: true,
        previousCursor: 'previous-cursor-token',
        nextCursor: 'next-cursor-token',
        currentPage: 2,
        totalPages: 6,
        totalItems: 51,
        snapshotCursor: 'orders-snapshot-token',
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getOrderHistory({
      cursor: 'current/cursor+',
      position: 'next',
      limit: 10,
      status: 'paid',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/orders?limit=10&cursor=current%2Fcursor%2B&position=next&status=paid');
    expect(result).toEqual({
      items: [],
      pagination: {
        limit: 10,
        position: 'next',
        hasPrevious: true,
        hasNext: true,
        previousCursor: 'previous-cursor-token',
        nextCursor: 'next-cursor-token',
        currentPage: 2,
        totalPages: 6,
        totalItems: 51,
        snapshotCursor: 'orders-snapshot-token',
      },
    });
  });

  it('拒绝非字符串且非 null 的下一页游标', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      items: [],
      pagination: {
        limit: 10,
        hasPrevious: false,
        hasNext: true,
        previousCursor: null,
        nextCursor: 42,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(getOrderHistory({ limit: 10, status: 'all' })).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_API_RESPONSE',
    });
  });
});

describe('资源游标查询', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('资产列表发送分页参数并保留服务端分页元数据', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      items: [],
      pagination: {
        limit: 50,
        position: 'next',
        hasPrevious: true,
        hasNext: true,
        previousCursor: 'asset-previous',
        nextCursor: 'asset-next',
        currentPage: 2,
        totalPages: 4,
        totalItems: 173,
        snapshotCursor: 'assets-snapshot-token',
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getAssetCardsPage({
      position: 'next',
      cursor: 'asset-current',
      limit: 50,
      source: 'ai-video',
      sort: 'created-asc',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/assets/cards?source=ai-video&sort=created-asc&position=next&cursor=asset-current&limit=50');
    expect(result.pagination).toEqual({
      limit: 50,
      position: 'next',
      hasPrevious: true,
      hasNext: true,
      previousCursor: 'asset-previous',
      nextCursor: 'asset-next',
      currentPage: 2,
      totalPages: 4,
      totalItems: 173,
      snapshotCursor: 'assets-snapshot-token',
    });
  });

  it('图片队列把 kind=image 与独立游标分页一起发送', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      items: [],
      pagination: {
        limit: 7,
        position: 'next',
        hasPrevious: true,
        hasNext: false,
        previousCursor: 'previous-image-page',
        nextCursor: null,
        currentPage: 3,
        totalPages: 3,
        totalItems: 18,
        snapshotCursor: 'image-snapshot-token',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await getGenerationJobsPage({ kind: 'image', position: 'next', cursor: 'image-page', limit: 7 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/ai/tasks?kind=image&position=next&cursor=image-page&limit=7');
  });
});

describe('聚合与后台响应契约', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('逐字段解析 Dashboard、后台总览、支付通道和同步状态', async () => {
    const responses = [
      {
        summary: { totalGenerations: 3, videoGenerations: 3, imageGenerations: 0 },
        trend: [{ day: '2026-07-11', videos: 3, images: 0 }],
        modelUsage: [{ model: 'seedance-1.5-pro', count: 3 }],
        recentProjects: [],
        timezone: 'Asia/Shanghai',
      },
      { summary: validAdminOverview(), apiCostHealth: validApiCostHealth() },
      { channel: validPaymentChannel() },
      validApiCostDashboard(),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(responses.shift())));

    await expect(getDashboardSummary()).resolves.toMatchObject({ timezone: 'Asia/Shanghai' });
    await expect(getAdminOverview()).resolves.toMatchObject({ totalUsers: 1 });
    await expect(getAdminPaymentChannel()).resolves.toMatchObject({ desktopWayCode: 'ALI_WAP' });
    await expect(getAdminApiUsage()).resolves.toMatchObject({
      sync: { status: 'normal' },
      summary: { localEstimateCompleteness: 'complete', localUnavailableUsageAttempts: 0 },
    });
  });

  it('API 成本看盘只发送有效的日期模式和模型参数', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(validApiCostDashboard()));
    vi.stubGlobal('fetch', fetchMock);

    await getAdminApiUsage({ range: 'date', date: '2026-07-13', model: 'Seedance 2.0 Fast' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/api-usage?range=date&date=2026-07-13&model=Seedance+2.0+Fast');
  });

  it('主看盘使用轻量 overview 端点并把取消信号传给 fetch', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const request = getAdminApiUsageOverview({
      range: 'month',
      month: '2026-07',
      model: 'Seedance 2.0 Mini',
    }, controller.signal);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/admin/api-usage/overview?range=month&month=2026-07&model=Seedance+2.0+Mini',
    );
    const forwardedSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(forwardedSignal).not.toBe(controller.signal);
    expect(forwardedSignal?.aborted).toBe(true);
  });

  it('多模态成本按需使用独立汇总、用户和操作端点并保留筛选', async () => {
    const overview = validMultimodalCostOverview();
    const pageResponse = {
      items: [],
      pagination: {
        limit: 20,
        hasPrevious: false,
        hasNext: false,
        previousCursor: null,
        nextCursor: null,
        currentPage: 0,
        totalPages: 0,
        totalItems: 0,
        snapshotCursor: 'multimodal-users-snapshot',
      },
      asOf: overview.asOf,
      selection: overview.selection,
    };
    const legacyOperationPageResponse = {
      ...pageResponse,
      pagination: {
        ...pageResponse.pagination,
        hasPrevious: true,
        previousCursor: 'previous-operation-page',
        currentPage: 2,
        totalPages: 2,
        totalItems: 21,
        snapshotCursor: 'multimodal-operations-snapshot',
      },
      items: [{
        id: '11111111-1111-4111-8111-111111111111',
        operationType: 'analysis',
        runId: '11111111-1111-4111-8111-111111111111',
        batchId: null,
        userId: '22222222-2222-4222-8222-222222222222',
        userName: 'Lindyson Admin',
        email: 'admin@lindyson.com',
        provider: 'volcengine-ark',
        model: 'Doubao Seed 2.0 Lite',
        status: 'ready',
        isFree: null,
        settledCredits: 0,
        refundedCredits: 0,
        incompleteRequestCount: 0,
        usageEvidence: 'historical',
        failureReason: null,
        createdAt: '2026-07-24T03:25:07.406Z',
        completedAt: '2026-07-24T03:25:26.019Z',
        knownInputTokens: 4602,
        knownCachedInputTokens: null,
        knownOutputTokens: 528,
        knownCostCny: null,
        providerRequestCount: 0,
        reconciledZeroRequestCount: 0,
        unknownUsageRequestCount: 0,
        unpricedRequestCount: 0,
        estimateCompleteness: 'unavailable',
      }],
    };
    const responses = [overview, pageResponse, legacyOperationPageResponse];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(responses.shift()));
    vi.stubGlobal('fetch', fetchMock);

    const normalizedOverview = await getAdminMultimodalCostOverview({ range: 'month', month: '2026-07' });
    await getAdminMultimodalCostUsersPage({
      range: 'month', month: '2026-07', asOf: overview.asOf, position: 'first', limit: 20,
    });
    const normalizedOperations = await getAdminMultimodalCostOperationsPage({
      range: 'month', month: '2026-07', asOf: overview.asOf, position: 'next', cursor: 'next/cursor+', limit: 20,
      operationType: 'plan-batch', status: 'completed', search: 'admin@lindyson.ai',
    });

    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      '/api/admin/api-usage/multimodal/overview?range=month&month=2026-07',
      `/api/admin/api-usage/multimodal/users?range=month&month=2026-07&asOf=${encodeURIComponent(overview.asOf)}&position=first&limit=20`,
      `/api/admin/api-usage/multimodal/operations?range=month&month=2026-07&asOf=${encodeURIComponent(overview.asOf)}&operationType=plan-batch&status=completed&search=admin%40lindyson.ai&position=next&cursor=next%2Fcursor%2B&limit=20`,
    ]);
    expect(normalizedOverview.summary.historicalPricedOperationCount).toBe(0);
    expect(normalizedOverview.models[0]?.historicalPricedOperationCount).toBe(0);
    expect(normalizedOperations.items[0]).toMatchObject({
      priceVersion: null,
      pricingSourceUrl: null,
    });
    expect(normalizedOperations.pagination).toMatchObject({
      currentPage: 2, totalPages: 2, totalItems: 21,
      snapshotCursor: 'multimodal-operations-snapshot',
    });
  });

  it('对账桶详情使用统一数据截点并解析三方证据链', async () => {
    const bucketId = '11111111-1111-4111-8111-111111111111';
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({
      bucket: validReconciliationBucket(bucketId),
      evidence: [{
        id: 'adjustment:case-1',
        side: 'adjustment',
        usageRecordId: null,
        billDetailRevisionId: null,
        taskId: '22222222-2222-4222-8222-222222222222',
        providerTaskId: null,
        sourceDetailKey: 'Detail7657484265949745423',
        allocatedTokens: 108900,
        allocatedCostCny: '2.504700',
        cause: 'archive-or-hash-failure',
        confidence: 'high',
        evidence: { version: '2026-07-13-v1' },
      }, {
        id: '33333333-3333-4333-8333-333333333333',
        side: 'zero-cost-candidate',
        usageRecordId: '44444444-4444-4444-8444-444444444444',
        billDetailRevisionId: null,
        taskId: '22222222-2222-4222-8222-222222222222',
        providerTaskId: null,
        sourceDetailKey: null,
        allocatedTokens: 0,
        allocatedCostCny: '0.000000',
        cause: 'provider-rejected-before-billing',
        confidence: 'high',
        evidence: { caseStatus: 'open', auditScope: 'account-billing-bucket' },
      }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getAdminApiCostReconciliationDetail(bucketId, '2026-07-13T06:00:00.000Z');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/admin/api-usage/reconciliation/${bucketId}?asOf=2026-07-13T06%3A00%3A00.000Z`);
    expect(result.evidence[0]).toMatchObject({ side: 'adjustment', allocatedTokens: 108900 });
    expect(result.evidence[1]).toMatchObject({ side: 'zero-cost-candidate', allocatedTokens: 0 });
  });

  it('任务、用户和供应商尝试分页保留统一数据截点与筛选参数', async () => {
    const dashboard = validApiCostDashboard();
    const response = {
      items: [],
      pagination: {
        limit: 20, hasPrevious: true, hasNext: false,
        previousCursor: 'previous-cursor-token', nextCursor: null,
        currentPage: 2, totalPages: 2, totalItems: 21,
        snapshotCursor: 'video-cost-snapshot',
      },
      asOf: dashboard.asOf,
      selection: dashboard.selection,
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(response));
    vi.stubGlobal('fetch', fetchMock);

    const filters = {
      range: 'month' as const,
      month: '2026-07',
      asOf: dashboard.asOf,
      position: 'next' as const,
      cursor: 'opaque/cursor+2',
      limit: 20,
      costState: 'unfinalized' as const,
    };
    const tasks = await getAdminApiCostTasksPage(filters);
    const users = await getAdminApiCostUsersPage(filters);
    const attempts = await getAdminApiCostAttemptsPage({
      ...filters,
      inputClass: 'with-video',
      usageEvidenceOrigin: 'provider-reported',
    });

    expect(tasks).toMatchObject({ asOf: dashboard.asOf, selection: dashboard.selection });
    expect(users).toMatchObject({ asOf: dashboard.asOf, selection: dashboard.selection });
    expect(attempts).toMatchObject({ asOf: dashboard.asOf, selection: dashboard.selection });
    expect(tasks.pagination).toMatchObject({
      currentPage: 2, totalPages: 2, totalItems: 21, snapshotCursor: 'video-cost-snapshot',
    });
    expect(users.pagination).toMatchObject({
      currentPage: 2, totalPages: 2, totalItems: 21, snapshotCursor: 'video-cost-snapshot',
    });
    expect(attempts.pagination).toMatchObject({
      currentPage: 2, totalPages: 2, totalItems: 21, snapshotCursor: 'video-cost-snapshot',
    });
    const taskUrl = new URL(String(fetchMock.mock.calls[0]?.[0]), 'https://lindyson.test');
    expect(taskUrl.searchParams.get('asOf')).toBe(dashboard.asOf);
    expect(taskUrl.searchParams.get('cursor')).toBe('opaque/cursor+2');
    expect(taskUrl.searchParams.get('position')).toBe('next');
    expect(taskUrl.searchParams.get('limit')).toBe('20');
    expect(taskUrl.searchParams.get('costState')).toBe('unfinalized');
    const userUrl = new URL(String(fetchMock.mock.calls[1]?.[0]), 'https://lindyson.test');
    expect(userUrl.searchParams.has('costState')).toBe(false);
    const attemptUrl = new URL(String(fetchMock.mock.calls[2]?.[0]), 'https://lindyson.test');
    expect(attemptUrl.pathname).toBe('/api/admin/api-usage/attempts');
    expect(attemptUrl.searchParams.get('inputClass')).toBe('with-video');
    expect(attemptUrl.searchParams.get('usageEvidenceOrigin')).toBe('provider-reported');
  });

  it.each([
    {
      name: 'Dashboard 数量类型错误',
      request: getDashboardSummary,
      payload: {
        summary: { totalGenerations: '3', videoGenerations: 3, imageGenerations: 0 },
        trend: [],
        modelUsage: [],
        timezone: 'Asia/Shanghai',
      },
    },
    {
      name: '支付通道 wayCode 越界',
      request: getAdminPaymentChannel,
      payload: { channel: { ...validPaymentChannel(), desktopWayCode: 'ALI_PC' } },
    },
    {
      name: '后台总览日期无效',
      request: getAdminOverview,
      payload: { summary: { ...validAdminOverview(), dayStart: 'not-a-date' } },
    },
    {
      name: 'API 同步状态越界',
      request: getAdminApiUsage,
      payload: {
        ...validApiCostDashboard(),
        sync: { ...validApiCostDashboard().sync, status: 'unknown' },
      },
    },
  ])('拒绝$name', async ({ request, payload }) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(payload)));
    await expect(request()).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_API_RESPONSE',
    });
  });
});

describe('全产品官方账单查询', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('汇总、逐行账单和运营调用共享业务筛选，分页端点保留同一 asOf', async () => {
    const selection = {
      range: 'month', month: '2026-08', date: null, rangeStart: '2026-08-01', rangeEnd: '2026-08-12',
      timezone: 'Asia/Shanghai', grain: 'day',
    };
    const asOf = '2026-08-12T06:00:00.000Z';
    const overview = {
      asOf,
      selection,
      summary: {
        lineCount: 3, productCount: 1, finalLineCount: 2, provisionalLineCount: 1,
        originalBillAmountCny: '15.000000', preferentialBillAmountCny: '13.000000',
        discountBillAmountCny: '2.000000', couponAmountCny: '1.000000',
        payableAmountCny: '12.000000', paidAmountCny: '10.000000', unpaidAmountCny: '2.000000',
      },
      products: [{
        product: 'ark', productName: '火山方舟', serviceType: 'video', lineCount: 3,
        finalLineCount: 2, provisionalLineCount: 1,
        originalBillAmountCny: '15.000000', preferentialBillAmountCny: '13.000000',
        discountBillAmountCny: '2.000000', couponAmountCny: '1.000000',
        payableAmountCny: '12.000000',
        paidAmountCny: '10.000000', unpaidAmountCny: '2.000000',
      }],
      byServiceType: [{
        serviceType: 'video', lineCount: 3,
        originalBillAmountCny: '15.000000', preferentialBillAmountCny: '13.000000',
        discountBillAmountCny: '2.000000', couponAmountCny: '1.000000',
        payableAmountCny: '12.000000',
        paidAmountCny: '10.000000', unpaidAmountCny: '2.000000',
      }],
      byAttribution: [{
        attributionStatus: 'admin-operational', lineCount: 3,
        originalBillAmountCny: '15.000000', preferentialBillAmountCny: '13.000000',
        discountBillAmountCny: '2.000000', couponAmountCny: '1.000000',
        payableAmountCny: '12.000000',
        paidAmountCny: '10.000000', unpaidAmountCny: '2.000000',
      }],
    };
    const emptyPage = {
      items: [],
      pagination: {
        limit: 20, hasPrevious: true, hasNext: false,
        previousCursor: 'previous-page', nextCursor: null,
        currentPage: 2, totalPages: 2, totalItems: 21,
        snapshotCursor: 'provider-billing-snapshot',
      },
      asOf,
      selection,
    };
    const responses = [overview, emptyPage, emptyPage];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(responses.shift()));
    vi.stubGlobal('fetch', fetchMock);

    const filters = {
      range: 'month' as const,
      month: '2026-08',
      product: 'ark',
      serviceType: 'video' as const,
      model: 'Seedance 2.5',
      finality: 'final' as const,
      attributionStatus: 'admin-operational' as const,
      search: 'landing',
    };
    await getAdminProviderBillingOverview(filters);
    const details = await getAdminProviderBillingDetailsPage({
      ...filters, asOf, position: 'next', cursor: 'bill/cursor+', limit: 20,
    });
    const operational = await getAdminProviderBillingOperationalUsagePage({
      ...filters, asOf, position: 'next', cursor: 'operation/cursor+', limit: 20,
    });

    const overviewUrl = new URL(String(fetchMock.mock.calls[0]?.[0]), 'https://lindyson.test');
    expect(overviewUrl.pathname).toBe('/api/admin/provider-billing/overview');
    expect(overviewUrl.searchParams.get('product')).toBe('ark');
    expect(overviewUrl.searchParams.get('serviceType')).toBe('video');
    expect(overviewUrl.searchParams.get('model')).toBe('Seedance 2.5');
    expect(overviewUrl.searchParams.get('finality')).toBe('final');
    expect(overviewUrl.searchParams.get('attributionStatus')).toBe('admin-operational');

    const detailsUrl = new URL(String(fetchMock.mock.calls[1]?.[0]), 'https://lindyson.test');
    expect(detailsUrl.pathname).toBe('/api/admin/provider-billing/details');
    expect(detailsUrl.searchParams.get('asOf')).toBe(asOf);
    expect(detailsUrl.searchParams.get('cursor')).toBe('bill/cursor+');
    expect(detailsUrl.searchParams.get('position')).toBe('next');

    const operationalUrl = new URL(String(fetchMock.mock.calls[2]?.[0]), 'https://lindyson.test');
    expect(operationalUrl.pathname).toBe('/api/admin/provider-billing/operational-usage');
    expect(operationalUrl.searchParams.get('asOf')).toBe(asOf);
    expect(operationalUrl.searchParams.get('cursor')).toBe('operation/cursor+');
    expect(details.pagination).toMatchObject({
      currentPage: 2, totalPages: 2, totalItems: 21,
      snapshotCursor: 'provider-billing-snapshot',
    });
    expect(operational.pagination).toMatchObject({
      currentPage: 2, totalPages: 2, totalItems: 21,
      snapshotCursor: 'provider-billing-snapshot',
    });
  });
});

function validAdminOverview() {
  return {
    totalUsers: 1,
    todayNewUsers: 0,
    monthNewUsers: 1,
    totalRevenue: 100,
    todayRevenue: 0,
    monthRevenue: 100,
    sevenDayRevenue: 100,
    totalJobs: 3,
    todayJobs: 1,
    activeJobs: 0,
    openTickets: 0,
    pendingInvoices: 0,
    sevenDayPaymentFailures: 0,
    inactiveUsers: 0,
    failedJobs: 0,
    sevenDayApiRequests: 3,
    sevenDayApiSuccesses: 3,
    sevenDayApiSuccessRate: 100,
    revenueTrend: [{ day: '2026-07-11', revenue: 100, orders: 1 }],
    modelUsage: [{ model: 'seedance-1.5-pro', billableTokens: 1000 }],
    trafficSources: {
      today: { visitors: 12, newVisitors: 9, registrations: 1, items: [{ source: 'xiaohongshu', visitors: 8, newVisitors: 6, registrations: 1, paidUsers: 0, revenue: 0 }] },
      sevenDays: { visitors: 40, newVisitors: 30, registrations: 3, items: [] },
      month: { visitors: 90, newVisitors: 70, registrations: 5, items: [] },
    },
    timezone: 'Asia/Shanghai',
    dayStart: '2026-07-11T00:00:00+08:00',
    monthStart: '2026-07-01T00:00:00+08:00',
  };
}

function validApiCostHealth() {
  return {
    syncStatus: 'normal',
    lastSyncedAt: '2026-07-13T06:00:00.000Z',
    matchState: 'raw-matched',
    residualTokens: 0,
    residualCostCny: '0.000000',
  };
}

function validPaymentChannel() {
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

function validApiCostDashboard() {
  return {
    asOf: '2026-07-13T06:00:00.000Z',
    selection: {
      range: 'month', month: '2026-07', date: null, rangeStart: '2026-07-01', rangeEnd: '2026-07-13',
      timezone: 'Asia/Shanghai', grain: 'day',
    },
    coverage: {
      local: { start: '2026-07-01', end: '2026-07-13', status: 'complete', reason: null },
      official: { start: '2026-07-01', end: '2026-07-13', status: 'complete', reason: null },
      comparable: { start: '2026-07-01', end: '2026-07-13', status: 'complete', reason: null },
      excludedPeriods: [],
    },
    currentState: {
      capturedAt: '2026-07-13T06:00:00.000Z', balanceSnapshotAt: '2026-07-13T06:00:00.000Z',
      packageSnapshotAt: '2026-07-13T06:00:00.000Z', historicalFilterAppliedToAccount: false,
      historicalFilterAppliedToPackages: false, historicalFilterAppliedToPricing: false,
    },
    combinedStatus: { billState: 'provisional', matchState: 'adjusted-matched', coverageState: 'complete', label: '出账中 · 经调整后对齐' },
    books: {
      usage: {
        rawLocalTokens: 8042794, inferredAdjustmentTokens: 1184876, adjustedLocalTokens: 9227670,
        officialTokens: 9227670, rawTokenDelta: 1184876, explainedTokenDelta: 1184876,
        timingShiftTokens: 0, residualTokens: 0, rawCoveragePercent: 87.16, adjustedCoveragePercent: 100,
      },
      valuation: {
        localEstimateCompleteness: 'complete',
        officialEstimateCompleteness: 'complete',
        rawLocalCostCny: '272.807868', inferredAdjustmentCostCny: '32.965422', adjustedLocalCostCny: '305.773290',
        officialListEquivalentCostCny: '305.773290', rawCostDeltaCny: '32.965422', explainedCostDeltaCny: '32.965422',
        timingShiftCostCny: '0.000000', rateVarianceCny: null, roundingVarianceCny: null, residualCostCny: '0.000000',
      },
      settlement: {
        rangeStart: '2026-07-01', rangeEnd: '2026-07-13', timezone: 'Asia/Shanghai',
        coverageStatus: 'complete', coverageReason: null,
        usageOriginalAmountCny: '305.773290', usagePayableAmountCny: '0.000000', usagePaidAmountCny: '0.000000', usageUnpaidAmountCny: '0.000000',
        packagePurchaseAmountCny: '394.000000', packagePurchasePaidAmountCny: '394.000000', packagePurchaseUnpaidAmountCny: '0.000000',
        paygPayableAmountCny: '0.000000', listPriceOffsetValueCny: '305.773290', listPriceOffsetStatus: 'priced',
        refundAmountCny: '0.000000', billingAdjustmentAmountCny: '0.000000', netOfficialPayableCny: '0.000000', openingPrepaidAssetCny: null,
        acquisitionCostCny: null, openingCatchUpCny: null, amortizedCostCny: null, expiryLossCny: null, adjustmentCny: null, endingPrepaidAssetCny: null,
        allocationStatus: 'unavailable', timeAttributionStatus: 'unavailable', timeAttributionReason: '尚无成本事件',
      },
    },
    account: {
      provider: 'volcengine-ark', currency: 'CNY', availableBalanceCny: '0.000000', cashBalanceCny: '0.000000',
      frozenAmountCny: '0.000000', arrearsBalanceCny: '0.000000', creditLimitCny: '0.000000',
      syncedAt: '2026-07-13T06:00:00.000Z', status: 'fresh',
    },
    sync: {
      status: 'normal', stale: false, lastSyncedAt: '2026-07-13T06:00:00.000Z',
      items: [
        { kind: 'balance', status: 'fresh', lastAttemptAt: '2026-07-13T06:00:00.000Z', lastSuccessAt: '2026-07-13T06:00:00.000Z', dataThrough: '2026-07-13', reason: null },
        { kind: 'bill', status: 'fresh', lastAttemptAt: '2026-07-13T06:00:00.000Z', lastSuccessAt: '2026-07-13T06:00:00.000Z', dataThrough: '2026-07-13', reason: null },
        { kind: 'packages', status: 'fresh', lastAttemptAt: '2026-07-13T06:00:00.000Z', lastSuccessAt: '2026-07-13T06:00:00.000Z', dataThrough: '2026-07-13', reason: null },
      ],
    },
    summary: {
      rangeStart: '2026-07-01', rangeEnd: '2026-07-13', timezone: 'Asia/Shanghai', billStatus: 'provisional',
      localBillableTokens: 8042794, localEstimatedCostCny: '272.807868', localEstimateCompleteness: 'complete',
      localUnpricedAttempts: 0, localUnpricedTokens: 0, localUnavailableUsageAttempts: 0,
      officialBillableTokens: 9227670, officialUnpricedRows: 0, officialUnpricedTokens: 0,
      officialListEquivalentCostCny: '305.773290',
      officialOriginalBillAmountCny: '0.000000', officialPayableAmountCny: '0.000000',
      officialPaidAmountCny: '0.000000', officialUnpaidAmountCny: '0.000000', officialDiscountAmountCny: '305.773290',
      resourcePackageDeductedTokens: 9227670,
      todayEstimatedCostCny: '0.000000', todayEstimateCompleteness: 'complete', todayUnpricedAttempts: 0,
      todayUnavailableUsageAttempts: 0,
      monthEstimatedCostCny: '272.807868', monthEstimateCompleteness: 'complete', monthUnpricedAttempts: 0,
      monthUnavailableUsageAttempts: 0,
      tokenDelta: 1184876, costDeltaCny: '32.965422', localCostUnderstatementPercent: 10.781,
      allAccountOfficialDailyAverageCny: '0.000000', seedanceOfficialDailyAverageCny: '0.000000',
      seedanceListDailyAverageCny: '23.520000', noPackageProjectedDailyCostCny: '23.520000', noPackageRunwayDays: 0,
      noPackageProjectionCoveredDays: 7, noPackageProjectionUnpricedRows: 0,
      noPackageProjectionUnpricedTokens: 0, noPackageProjectionStatus: 'complete',
    },
    operations: {
      taskCount: 2, userCount: 1, settledCredits: 200, heldCredits: 0, refundedCredits: 0,
      estimatedCostCny: '305.773290', estimateCompleteness: 'complete', incompleteTaskCount: 0,
      officialEquivalentCostCny: '305.773290', differenceCny: '0.000000',
      officialPayableCny: '0.000000', reconciliationStatus: 'matched',
      models: [{
        id: 'Seedance 2.0', model: 'Seedance 2.0',
        priceVersions: ['volcengine-seedance-2026-07-10'], taskCount: 2,
        operationalCallCount: 0,
        settledCredits: 200, heldCredits: 0, refundedCredits: 0,
        estimatedCostCny: '305.773290', businessEstimatedCostCny: '305.773290',
        operationalEstimatedCostCny: '0.000000', knownAccountCostCny: '305.773290',
        operationalUnpricedCallCount: 0, estimateCompleteness: 'complete',
        incompleteTaskCount: 0, averageTaskCostCny: '152.886645',
      }],
    },
    models: [], daily: [], pricingRules: [], packages: [],
  };
}

function validMultimodalCostOverview() {
  const dashboard = validApiCostDashboard();
  return {
    asOf: dashboard.asOf,
    selection: dashboard.selection,
    account: dashboard.account,
    summary: {
      analysisCount: 2,
      batchCount: 1,
      userCount: 1,
      settledCredits: 20,
      refundedCredits: 0,
      incompleteOperationCount: 0,
      historicalEvidenceOperationCount: 0,
      historicalPricedOperationCount: 0,
      operationalCallCount: 0,
      operationalUnpricedCallCount: 0,
      businessEstimatedCostCny: '0.025400',
      operationalEstimatedCostCny: '0.000000',
      knownAccountCostCny: '0.025400',
      knownInputTokens: 12_400,
      knownCachedInputTokens: 2_100,
      knownOutputTokens: 3_200,
      knownCostCny: '0.025400',
      providerRequestCount: 5,
      reconciledZeroRequestCount: 0,
      unknownUsageRequestCount: 0,
      unpricedRequestCount: 0,
      estimateCompleteness: 'complete',
    },
    models: [{
      id: 'volcengine-ark:doubao-seed-2-0-lite-260428',
      provider: 'volcengine-ark',
      model: 'doubao-seed-2-0-lite-260428',
      analysisCount: 2,
      batchCount: 1,
      userCount: 1,
      settledCredits: 20,
      refundedCredits: 0,
      incompleteOperationCount: 0,
      historicalEvidenceOperationCount: 0,
      historicalPricedOperationCount: 0,
      operationalCallCount: 0,
      operationalUnpricedCallCount: 0,
      businessEstimatedCostCny: '0.025400',
      operationalEstimatedCostCny: '0.000000',
      knownAccountCostCny: '0.025400',
      pricingSources: [{
        priceVersion: 'volcengine-list-2026-07-23',
        sourceUrl: 'https://docs.volcengine.com/docs/82379/1544106?lang=zh',
      }],
      knownInputTokens: 12_400,
      knownCachedInputTokens: 2_100,
      knownOutputTokens: 3_200,
      knownCostCny: '0.025400',
      providerRequestCount: 5,
      reconciledZeroRequestCount: 0,
      unknownUsageRequestCount: 0,
      unpricedRequestCount: 0,
      estimateCompleteness: 'complete',
    }],
  };
}

function validReconciliationBucket(id: string) {
  return {
    id,
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    expenseDate: '2026-07-01',
    billLineType: 'usage',
    model: 'Seedance 2.0 Mini',
    resolutionBand: '480p-720p',
    inputClass: 'without-video',
    unitPriceCnyPerMillion: '23.000000',
    currency: 'CNY',
    rawLocalTokens: 0,
    inferredAdjustmentTokens: 108900,
    adjustedLocalTokens: 108900,
    officialTokens: 108900,
    timingShiftTokens: 0,
    residualTokens: 0,
    rawLocalCostCny: '0.000000',
    inferredAdjustmentCostCny: '2.504700',
    adjustedLocalCostCny: '2.504700',
    officialListEquivalentCostCny: '2.504700',
    timingShiftCostCny: '0.000000',
    rateVarianceCny: null,
    roundingVarianceCny: null,
    residualCostCny: '0.000000',
    matchState: 'adjusted-matched',
    attributionConfidence: 'high',
  };
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
