import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildVolcengineBillDetailRequestBody,
  buildVolcengineOpenApiRequest,
  fetchAllResourcePackages,
  fetchVolcengineBillDetailPages,
  mapVolcengineBalance,
  mapVolcengineBillDetail,
  mapVolcengineResourcePackage,
  normalizeBillWindow,
  normalizeVolcengineBillDetails,
  recognizeResourcePackageModel,
  volcengineOpenApiRequest,
} from '../src/providers/volcengineBillingProvider.js';

describe('volcengineBillingProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('识别 Seedance 2.5、普通版、Fast 和 Mini 资源包', () => {
    expect(recognizeResourcePackageModel('Doubao-Seedance-2.5-在线推理资源包')).toBe('Seedance 2.5');
    expect(recognizeResourcePackageModel('Doubao_Seedance_2_5_pack_10000ktokens')).toBe('Seedance 2.5');
    expect(recognizeResourcePackageModel('Doubao-Seedance-2.0-在线推理资源包')).toBe('Seedance 2.0');
    expect(recognizeResourcePackageModel('Doubao-Seedance-2.0-Fast 免费在线推理资源包')).toBe('Seedance 2.0 Fast');
    expect(recognizeResourcePackageModel('Doubao-Seedance-2.0-Mini 免费在线推理资源包')).toBe('Seedance 2.0 Mini');
    expect(recognizeResourcePackageModel('Doubao-Seedance-1.5-pro 免费在线推理资源包')).toBeNull();
    expect(recognizeResourcePackageModel('Doubao-Seedance-1.0-lite-t2v 免费在线推理资源包')).toBeNull();
    expect(recognizeResourcePackageModel('Doubao-Seed-2.0-lite 免费在线推理资源包')).toBeNull();
    expect(recognizeResourcePackageModel('Doubao-Seedream4.0 免费在线推理资源包')).toBeNull();
    expect(recognizeResourcePackageModel('其它云产品资源包')).toBeNull();
  });

  it('当前月只声明覆盖到北京时间今天，历史月才覆盖到月末', () => {
    const now = new Date('2026-07-13T08:00:00.000Z');
    expect(normalizeBillWindow({ billPeriod: '2026-07', now })).toMatchObject({
      windowStart: '2026-07-01',
      windowEnd: '2026-07-13',
      isFinal: false,
    });
    expect(normalizeBillWindow({ billPeriod: '2026-06', now })).toMatchObject({
      windowStart: '2026-06-01',
      windowEnd: '2026-06-30',
    });
    expect(() => normalizeBillWindow({ billPeriod: '2026-08', now }))
      .toThrow('不能同步未来账期');
    expect(() => normalizeBillWindow({
      billPeriod: '2026-07', expenseDate: '2026-07-14', now,
    })).toThrow('不能同步未来账单日期');
    expect(() => normalizeBillWindow({ billPeriod: '2026-07', isFinal: true, now }))
      .toThrow('最终账单只能复核已经结束的历史账期');
  });

  it('把火山费用中心资源包字段归一成后台资源包结构', () => {
    expect(mapVolcengineResourcePackage({
      PackageID: 'pkg-seedance-20',
      InstanceNo: 'pkg-seedance-20-fallback',
      ProductName: '字节跳动大模型服务（豆包大模型）',
      ResourcePackageName: 'Doubao-Seedance-2.0-在线推理资源包-1000万 tokens',
      Status: 'Effective',
      TotalQuota: '10000000',
      RemainingQuota: '7321310',
      StartTime: '2026-06-07 21:20:00',
      ExpireTime: '2026-09-04 23:59:59',
    })).toMatchObject({
      packageId: 'pkg-seedance-20',
      provider: 'volcengine-ark',
      recognizedModel: 'Seedance 2.0',
      status: 'Effective',
      totalQuota: 10000000,
      remainingQuota: 7321310,
    });
  });

  it('把 Seedance 2.5 资源包归入独立模型账本', () => {
    expect(mapVolcengineResourcePackage({
      InstanceNo: 'pkg-seedance-25',
      ProductName: '字节跳动大模型服务（豆包大模型）',
      ConfigurationCode: 'Doubao_Seedance_2_5_pack_10000ktokens',
      ConfigurationName: 'Doubao-Seedance-2.5-在线推理资源包-1000万tokens',
      TotalAmount: '10000',
      AvailableAmount: '9000',
      Unit: '千tokens',
      Status: 'Effective',
    })).toMatchObject({
      packageId: 'pkg-seedance-25',
      recognizedModel: 'Seedance 2.5',
      totalQuota: 10000000,
      remainingQuota: 9000000,
    });
  });

  it('兼容费用中心真实返回字段并按千 tokens 折算额度', () => {
    expect(mapVolcengineResourcePackage({
      InstanceNo: 'Ark_bd2000000828555441410',
      ProductName: '字节跳动大模型服务（豆包大模型）',
      ConfigurationCode: 'Doubao_Seedance_2.0_pack_10000ktokens',
      ConfigurationName: 'Doubao-Seedance-2.0-在线推理资源包-1000万tokens',
      TotalAmount: '10000',
      AvailableAmount: '10000',
      Unit: '千tokens',
      EffectiveTime: '2026-06-30T15:14:19Z',
      ExpiryTime: '2026-09-27T15:59:59Z',
      Status: 'Effective',
    })).toMatchObject({
      packageId: 'Ark_bd2000000828555441410',
      recognizedModel: 'Seedance 2.0',
      totalQuota: 10000000,
      remainingQuota: 10000000,
      startsAt: '2026-06-30T15:14:19.000Z',
      expiresAt: '2026-09-27T15:59:59.000Z',
    });
  });

  it('不会把普通豆包 Seed 或 Seedream 资源包映射成 Seedance', () => {
    expect(mapVolcengineResourcePackage({
      InstanceNo: 'seed-lite',
      ProductName: '字节跳动大模型服务（豆包大模型）',
      ConfigurationName: 'Doubao-Seed-2.0-lite免费在线推理资源包',
      TotalAmount: '500000',
      AvailableAmount: '500000',
      Unit: 'token',
    })).toBeNull();

    expect(mapVolcengineResourcePackage({
      InstanceNo: 'seedream',
      ProductName: '豆包图片生成大模型',
      ConfigurationName: 'Doubao-Seedream4.0免费在线推理资源包',
      TotalAmount: '200',
      AvailableAmount: '200',
      Unit: '张',
    })).toBeNull();
  });

  it('拒绝剩余额度大于总额度的异常资源包快照', () => {
    expect(mapVolcengineResourcePackage({
      InstanceNo: 'invalid-quota',
      ProductName: '豆包大模型',
      ConfigurationName: 'Doubao-Seedance-2.0-Mini 在线推理资源包',
      TotalAmount: '100',
      AvailableAmount: '101',
      Unit: 'token',
    })).toBeNull();
  });

  it('生成火山 OpenAPI 签名请求时包含 Action、Version 和授权头', () => {
    const request = buildVolcengineOpenApiRequest({
      action: 'ListResourcePackages',
      body: { ResourceType: 'Package', MaxResults: '20' },
      now: new Date('2026-06-30T00:00:00.000Z'),
    });

    expect(request.url).toContain('Action=ListResourcePackages');
    expect(request.url).toContain('Version=');
    expect(request.method).toBe('POST');
    expect(request.body).toContain('ResourceType');
    expect(request.headers.Authorization).toContain('HMAC-SHA256 Credential=');
    expect(request.headers['X-Date']).toBe('20260630T000000Z');
  });

  it('资源包分页遇到空页时停止，不跟随残留游标进入循环', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ResponseMetadata: { RequestId: 'package-page-1' },
        Result: {
          List: [{ InstanceNo: 'package-1' }],
          NextToken: 'cursor-1',
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ResponseMetadata: { RequestId: 'package-empty-page' },
        Result: {
          List: [],
          NextToken: 'cursor-that-would-cycle',
        },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAllResourcePackages()).resolves.toMatchObject({
      pages: 2,
      requestId: 'package-empty-page',
      items: [{ InstanceNo: 'package-1' }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('把账户余额字段作为精确字符串归一化', () => {
    expect(mapVolcengineBalance({
      ResponseMetadata: { RequestId: 'request-balance-1' },
      Result: {
        AccountID: 210000001,
        ArrearsBalance: '0.000000',
        AvailableBalance: '77.010000',
        CashBalance: '83.010000',
        CreditLimit: '0.010000',
        FreezeAmount: '5.010000',
      },
    })).toEqual({
      provider: 'volcengine-ark',
      accountId: '210000001',
      arrearsBalanceCny: '0.000000',
      availableBalanceCny: '77.010000',
      cashBalanceCny: '83.010000',
      creditLimitCny: '0.010000',
      frozenAmountCny: '5.010000',
      currency: 'CNY',
      requestId: 'request-balance-1',
    });
  });

  it('归一零元资源包抵扣账单并计算官方列表价等价成本', () => {
    expect(mapVolcengineBillDetail({
      BillDetailId: 'detail-seedance-video',
      BillPeriod: '2026-07',
      ExpenseDate: '2026-07-13',
      PayerID: '210000001',
      Product: 'ark_bd',
      ProductZh: '字节跳动大模型服务',
      ConfigName: 'Doubao-Seedance-2.0 720P 含视频输入',
      Price: '0.000028',
      PriceUnit: '元/token',
      Count: '605700',
      Unit: 'token',
      DeductionCount: '605700',
      OriginalBillAmount: '0.000000',
      PayableAmount: '0.000000',
      PaidAmount: '0.000000',
      UnpaidAmount: '0.000000',
      Currency: 'CNY',
      SettlementType: '资源包抵扣',
    })).toMatchObject({
      sourceDetailKey: 'detail-seedance-video',
      recognizedModel: 'Seedance 2.0',
      pricingResolution: '720p',
      pricingInputHasVideo: true,
      billableTokens: '605700',
      listEquivalentCostCny: '16.959600',
      payableAmountCny: '0.000000',
      billLineType: 'usage',
      normalizedUnitPricePerMillion: '28',
      normalizationVersion: 'volcengine-billing-v3',
    });
  });

  it('把资源包新购与用量行分账，只有明确新购语义才识别购置', () => {
    expect(mapVolcengineBillDetail({
      BillDetailId: 'detail-package-purchase',
      BillPeriod: '2026-07',
      ExpenseDate: '2026-07-01',
      Product: 'ark_bd',
      BillCategory: '消费-新购',
      BillingMode: '预付费',
      InstanceNo: 'Ark_bd-package-1',
      ConfigName: 'Doubao-Seedance-2.0-Fast 在线推理资源包',
      Count: '1',
      Unit: '个',
      PayableAmount: '22.000000',
      PaidAmount: '22.000000',
    })).toMatchObject({
      recognizedModel: 'Seedance 2.0 Fast',
      billableTokens: null,
      billLineType: 'package-purchase',
    });

    expect(mapVolcengineBillDetail({
      BillDetailId: 'detail-package-word-only',
      BillPeriod: '2026-07',
      ExpenseDate: '2026-07-01',
      Product: 'ark_bd',
      ConfigName: 'Doubao-Seedance-2.0-Fast 在线推理资源包',
      Count: '1',
      Unit: '个',
    })).toMatchObject({ billLineType: 'usage' });

    expect(mapVolcengineBillDetail({
      BillDetailId: 'detail-package-token-unit',
      BillPeriod: '2026-07',
      ExpenseDate: '2026-07-01',
      Product: 'ark_bd',
      BillCategory: '消费-新购',
      InstanceNo: 'Ark_bd-package-token-unit',
      ConfigName: 'Doubao-Seedance-2.0-Mini 720P 无视频输入资源包',
      Count: '1000000',
      Unit: 'token',
    })).toMatchObject({
      recognizedModel: 'Seedance 2.0 Mini',
      billableTokens: '1000000',
      billLineType: 'package-purchase',
    });
  });

  it('退款和调账优先于用量分类，避免进入正常消耗桶', () => {
    expect(mapVolcengineBillDetail({
      BillDetailId: 'detail-refund',
      BillPeriod: '2026-07',
      ExpenseDate: '2026-07-01',
      Product: 'ark_bd',
      BillCategory: '退款',
      ConfigName: 'Doubao-Seedance-2.0 720P 无视频输入',
      Price: '0.000046',
      PriceUnit: '元/token',
      Count: '100',
      Unit: 'token',
    })).toMatchObject({ billLineType: 'refund' });
  });

  it('使用 completion 用量所在的 Count 归一 Fast 无视频输入成本', () => {
    expect(mapVolcengineBillDetail({
      BillDetailId: 'detail-fast-no-video',
      BillPeriod: '2026-07',
      ExpenseDate: '2026-07-13 00:00:00',
      Product: 'ark_bd',
      ConfigurationCode: 'Doubao_Seedance_2.0_Fast_720P_no_video_input',
      Price: '37',
      PriceUnit: '元/百万tokens',
      Count: '324900',
      Unit: 'tokens',
      PayableAmount: '0',
    })).toMatchObject({
      recognizedModel: 'Seedance 2.0 Fast',
      pricingResolution: '720p',
      pricingInputHasVideo: false,
      billableTokens: '324900',
      listEquivalentCostCny: '12.021300',
    });
  });

  it('还原 2026-07-13 官方 Seedance 用量和列表价等价成本基线', () => {
    const lines = [
      billLine('Seedance 2.0 720P 无视频输入', '0.000046', '3350276'),
      billLine('Seedance 2.0 720P 含视频输入', '0.000028', '605700'),
      billLine('Seedance 2.0 Fast 720P 无视频输入', '0.000037', '1350238'),
      billLine('Seedance 2.0 Mini 720P 无视频输入', '0.000023', '3315756'),
      billLine('Seedance 2.0 Mini 720P 含视频输入', '0.000014', '605700'),
    ].map(mapVolcengineBillDetail);

    const tokens = lines.reduce((sum, line) => sum + BigInt(line!.billableTokens!), 0n);
    const costMicros = lines.reduce(
      (sum, line) => sum + BigInt(line!.listEquivalentCostCny!.replace('.', '')),
      0n,
    );
    expect(tokens).toBe(9_227_670n);
    expect(costMicros).toBe(305_773_290n);
  });

  it('保留非方舟产品账单用于全账户日均，且不猜测 Seedance 计价字段', () => {
    expect(mapVolcengineBillDetail({
      BillDetailId: 'detail-tos-1',
      BillPeriod: '2026-07',
      ExpenseDate: '2026-07-13',
      Product: 'tos',
      ProductZh: '对象存储',
      Count: '1',
      Unit: 'GiB',
      PayableAmount: '2.500000',
    })).toMatchObject({
      product: 'tos',
      payableAmountCny: '2.500000',
      recognizedModel: null,
      billableTokens: null,
      listEquivalentCostCny: null,
      billLineType: 'usage',
    });
  });

  it('消费-使用账单即使缺少 Count/Unit 也保留为全账户用量金额', () => {
    expect(mapVolcengineBillDetail({
      BillDetailId: 'detail-account-usage-without-unit',
      BillPeriod: '2026-07',
      ExpenseDate: '2026-07-13',
      Product: 'tos',
      BillCategory: '消费-使用',
      OriginalBillAmount: '2.500000',
      PayableAmount: '2.000000',
      PaidAmount: '2.000000',
      UnpaidAmount: '0.000000',
    })).toMatchObject({
      billLineType: 'usage',
      recognizedModel: null,
      billableTokens: null,
      payableAmountCny: '2.000000',
    });

    expect(mapVolcengineBillDetail({
      BillDetailId: 'detail-account-consume-use',
      BillPeriod: '2026-07',
      ExpenseDate: '2026-07-13',
      Product: 'cdn',
      BillCategory: 'consume-use',
    })).toMatchObject({ billLineType: 'usage' });
  });

  it('官方 Price 为零时用明确配置命中的受审规则兜底', () => {
    expect(mapVolcengineBillDetail({
      BillDetailId: 'detail-zero-price',
      BillPeriod: '2026-07',
      ExpenseDate: '2026-07-13',
      Product: 'ark_bd',
      ConfigName: 'Seedance 2.0 720P 含视频输入',
      Price: '0.000000',
      PriceUnit: '元/token',
      Count: '100',
      Unit: 'token',
    })).toMatchObject({
      pricingResolution: '720p',
      pricingInputHasVideo: true,
      listEquivalentCostCny: '0.002800',
    });
  });

  it('DeductionCount 按 Unit 归一为 token 后再供报表汇总', () => {
    expect(mapVolcengineBillDetail({
      BillDetailId: 'detail-deduction-unit',
      BillPeriod: '2026-07',
      ExpenseDate: '2026-07-13',
      Product: 'ark_bd',
      ConfigName: 'Seedance 2.0 Mini 720P 含视频输入',
      Price: '0.014',
      PriceUnit: '元/千tokens',
      Count: '605.7',
      DeductionCount: '605.7',
      Unit: '千tokens',
    })).toMatchObject({
      billableTokens: '605700',
      deductionCount: '605700',
      listEquivalentCostCny: '8.479800',
    });
  });

  it('PriceUnit 缺失时不猜价格单位', () => {
    expect(mapVolcengineBillDetail({
      BillDetailId: 'detail-unknown-price-unit',
      BillPeriod: '2026-07',
      ExpenseDate: '2026-07-13',
      Product: 'ark_bd',
      ConfigName: 'Seedance 2.0',
      Price: '0.028',
      Count: '1000',
      Unit: 'token',
    })).toMatchObject({
      billableTokens: '1000',
      pricingResolution: null,
      pricingInputHasVideo: null,
      listEquivalentCostCny: null,
    });
  });

  it('科学计数法价格通过纯字符串移位保持精度', () => {
    expect(mapVolcengineBillDetail({
      BillDetailId: 'detail-scientific-price',
      BillPeriod: '2026-07',
      ExpenseDate: '2026-07-13',
      Product: 'ark_bd',
      ConfigName: 'Seedance 2.0 720P 含视频输入',
      Price: '2.8e-5',
      PriceUnit: '元/token',
      Count: '605700',
      Unit: 'token',
    })).toMatchObject({ listEquivalentCostCny: '16.959600' });
  });

  it('ListBillDetail 拉取全账户、保留零金额行并使用明细周期和 300 条分页', () => {
    expect(buildVolcengineBillDetailRequestBody({
      billPeriod: '2026-07',
      expenseDate: '2026-07-13',
      offset: 300,
    })).toEqual({
      BillPeriod: '2026-07',
      ExpenseDate: '2026-07-13',
      GroupTerm: 0,
      GroupPeriod: 2,
      Limit: 300,
      Offset: 300,
      IgnoreZero: 0,
      NeedRecordNum: 1,
    });
  });

  it('ListBillDetail 会按 Offset 拉完所有分页', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ResponseMetadata: { RequestId: 'page-1' },
        Result: {
          List: Array.from({ length: 300 }, (_, index) => ({
            Product: 'ark_bd', BillDetailId: String(index + 1),
          })),
          Total: 301,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        ResponseMetadata: { RequestId: 'page-2' },
        Result: { List: [{ Product: 'ark_bd', BillDetailId: '301' }], Total: 301 },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchVolcengineBillDetailPages({
      billPeriod: '2026-07',
      expenseDate: '2026-07-13',
      pageDelayMs: 0,
    });

    expect(result.pages).toBe(2);
    expect(result.items).toHaveLength(301);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ Offset: 0, Limit: 300 });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({ Offset: 300, Limit: 300 });
  });

  it('账单响应结构漂移或缺少 Total 时整次失败，不能把旧快照清空', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ Result: { Items: [], Total: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ Result: { List: [] } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVolcengineBillDetailPages({
      billPeriod: '2026-07', pageDelayMs: 0,
    })).rejects.toThrow('Result.List');
    await expect(fetchVolcengineBillDetailPages({
      billPeriod: '2026-07', pageDelayMs: 0,
    })).rejects.toThrow('Result.Total');
  });

  it('账单跨页重复 sourceDetailKey 时整次失败，不能静默覆盖并低估成本', () => {
    const first = billLine('Seedance 2.0 720P 无视频输入', '0.000046', '100');
    expect(() => normalizeVolcengineBillDetails([first, { ...first }]))
      .toThrow('重复 sourceDetailKey');
  });

  it('CNY 核心金额缺失或非法时整批失败', () => {
    const valid = billLine('Seedance 2.0 720P 无视频输入', '0.000046', '100');
    expect(normalizeVolcengineBillDetails([valid])).toHaveLength(1);
    for (const field of ['OriginalBillAmount', 'PayableAmount', 'PaidAmount', 'UnpaidAmount'] as const) {
      expect(() => normalizeVolcengineBillDetails([{ ...valid, [field]: undefined }]))
        .toThrow('CNY 核心金额缺失或非法');
      expect(() => normalizeVolcengineBillDetails([{ ...valid, [field]: 'not-decimal' }]))
        .toThrow('CNY 核心金额缺失或非法');
    }
  });

  it('DeductionCount 按单位保留小数 token，缺失或非法时保持空而不回填', () => {
    const productionLine = {
      ...billLine('Seedance 2.0 720P 无视频输入', '0.000046', '151.078'),
      Unit: '千tokens',
      DeductionCount: '72.664544077',
    };
    expect(normalizeVolcengineBillDetails([productionLine])[0]).toMatchObject({
      billableTokens: '151078',
      deductionCount: '72664.544077',
      normalizationVersion: 'volcengine-billing-v3',
    });
    expect(normalizeVolcengineBillDetails([{
      ...productionLine, DeductionCount: '0',
    }])[0]?.deductionCount).toBe('0');
    for (const deductionCount of [undefined, 'not-decimal', '-1'] as const) {
      expect(normalizeVolcengineBillDetails([{
        ...productionLine, DeductionCount: deductionCount,
      }])[0]).toMatchObject({
        billableTokens: '151078',
        deductionCount: null,
      });
    }
    expect(() => normalizeVolcengineBillDetails([{
      ...productionLine, Count: '151.0789',
    }])).toThrow('Count/Unit');
  });

  it('Seedance 改名候选行保留 Token 并显式标记未归属，不静默丢弃', () => {
    const detail = normalizeVolcengineBillDetails([{
      ...billLine('Seedance Next 720P 无视频输入', '0.000046', '100'),
      BillDetailId: 'detail-seedance-renamed',
    }])[0];
    expect(detail).toMatchObject({
      sourceDetailKey: 'detail-seedance-renamed', seedanceCandidate: true,
      recognizedModel: null, billableTokens: '100', billLineType: 'usage',
      listEquivalentCostCny: null,
    });
  });

  it('供应商返回跨窗口账单行时整次失败', () => {
    expect(() => normalizeVolcengineBillDetails([
      billLine('Seedance 2.0 720P 无视频输入', '0.000046', '100'),
    ], {
      billPeriod: '2026-07',
      expenseDate: '2026-07-14',
      windowStart: '2026-07-14',
      windowEnd: '2026-07-14',
    })).toThrow('超出请求窗口');
  });

  it('429 和 5xx 使用退避重试且最终返回成功响应', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('too many requests', { status: 429 }))
      .mockResolvedValueOnce(new Response('temporary unavailable', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ Result: { ok: true } }));
    const sleeps: number[] = [];
    vi.stubGlobal('fetch', fetchMock);

    await expect(volcengineOpenApiRequest<Record<string, unknown>>('ListBillDetail', {}, {
      maxRetries: 2,
      retryBaseDelayMs: 10,
      sleep: async milliseconds => { sleeps.push(milliseconds); },
    })).resolves.toMatchObject({ Result: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([10, 20]);
  });
});

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function billLine(configName: string, price: string, count: string) {
  return {
    BillDetailId: `detail-${configName}-${count}`,
    BillPeriod: '2026-07',
    ExpenseDate: '2026-07-13',
    Product: 'ark_bd',
    ConfigName: configName,
    Price: price,
    PriceUnit: '元/token',
    Count: count,
    Unit: 'tokens',
    DeductionCount: count,
    OriginalBillAmount: '0.000000',
    PayableAmount: '0.000000',
    PaidAmount: '0.000000',
    UnpaidAmount: '0.000000',
  };
}
