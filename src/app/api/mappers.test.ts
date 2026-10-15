import {
  adminUserSchema,
  adminGenerationTaskCardSchema,
  adminCreditLedgerSchema,
  assetDetailSchema,
  assetCardSchema,
  consumptionSettingSchema,
  endpointContracts,
  invoiceSchema,
  orderSchema,
  promptWizardSettingsSchema,
  tkPromptEngineSettingsSchema,
  publicPlanSchema,
  userCreditLedgerSchema,
  userProfileSchema,
  userTicketSchema,
} from '@lindyson/api-contracts';
import { describe, expect, it } from 'vitest';
import {
  mapAccount,
  mapAdminJobCard,
  mapApiCostDashboard,
  mapAsset,
  mapAssetCard,
  mapConsumptionSettings,
  mapInvoice,
  mapLedger,
  mapOrder,
  mapPlan,
  mapUserLedger,
  mapUser,
  mapUserTicket,
} from './mappers';

const ids = {
  asset: '00000000-0000-4000-8000-000000000001',
  folder: '00000000-0000-4000-8000-000000000002',
  plan: '00000000-0000-4000-8000-000000000003',
  user: '00000000-0000-4000-8000-000000000004',
  ticket: '00000000-0000-4000-8000-000000000005',
  ledger: '00000000-0000-4000-8000-000000000006',
  package: '00000000-0000-4000-8000-000000000007',
  invoice: '00000000-0000-4000-8000-000000000008',
  order: '00000000-0000-4000-8000-000000000009',
};

function asset(patch: Record<string, unknown> = {}) {
  return assetDetailSchema.parse({
    id: ids.asset,
    name: '测试素材',
    type: 'video',
    source: 'ai-video',
    folderId: ids.folder,
    publicUrl: 'https://cdn.example.com/video.mp4',
    thumbnailUrl: 'https://cdn.example.com/video.jpg',
    sizeBytes: 1024,
    durationSeconds: 5,
    width: 720,
    height: 1280,
    generation: null,
    views: 0,
    downloadedAt: null,
    downloadRequestedAt: null,
    createdAt: '2026-07-08T10:00:00.000Z',
    updatedAt: '2026-07-08T10:00:00.000Z',
    ...patch,
  });
}

function plan(patch: Record<string, unknown> = {}) {
  return publicPlanSchema.parse({
    id: ids.plan,
    name: '测试套餐',
    nameEn: 'Test',
    code: 'test',
    kind: 'main',
    billing: 'both',
    description: '测试套餐',
    monthlyPrice: 2900,
    yearlyPrice: 22800,
    credits: 10000,
    assetRetentionDays: 30,
    portraitEntitlements: {
      enabled: false,
      profileLimit: 0,
      activeLimit: 0,
      assetsPerActor: 0,
    },
    storage: '100GB',
    tiktokAccounts: '5',
    features: [],
    recommendation: null,
    iconKey: 'sparkles',
    ctaLabel: '选择套餐',
    status: 'active',
    landingVisible: true,
    ...patch,
  });
}

describe('共享 DTO 展示映射', () => {
  it('保留服务端真实的可空文件夹字段，不再制造空字符串文件夹 ID', () => {
    expect(mapAsset(asset({ folderId: null })).folderId).toBeNull();
  });

  it('映射素材的下载请求时间、旧历史时间与媒体属性', () => {
    const mapped = mapAsset(asset({
      downloadedAt: '2026-07-08T10:30:00.000Z',
      downloadRequestedAt: '2026-07-08T10:31:00.000Z',
      durationSeconds: 15.041667,
    }));

    expect(mapped.downloadedAt).toBe('2026-07-08 18:30');
    expect(mapped.downloadRequestedAt).toBe('2026-07-08 18:31');
    expect(mapped.duration).toBe('15s');
    expect(mapped.durationSeconds).toBe(15.041667);
    expect(mapped.width).toBe(720);
    expect(mapped.height).toBe(1280);
    expect(mapped.mediaExtension).toBe('mp4');
  });

  it('素材卡片把首次下载时间规范映射为下载请求时间', () => {
    const mapped = mapAssetCard(assetCardSchema.parse({
      id: ids.asset,
      name: '参考图.png',
      type: 'image',
      source: 'uploaded-image',
      folderId: ids.folder,
      previewUrl: 'https://cdn.example.com/image.webp',
      sizeBytes: 2048,
      durationSeconds: null,
      width: 2048,
      height: 1024,
      mediaExtension: 'png',
      views: 0,
      firstDownloadAt: '2026-07-08T10:31:00.000Z',
      createdAt: '2026-07-08T10:00:00.000Z',
      updatedAt: '2026-07-08T10:00:00.000Z',
    }));
    expect(mapped).toMatchObject({
      width: 2048,
      height: 1024,
      dimensions: '2048×1024',
      mediaExtension: 'png',
      downloadRequestedAt: '2026-07-08 18:31',
    });
    expect(mapped.downloadedAt).toBeUndefined();
  });

  it('历史视频素材缺少 referenceAssets 时保留 referenceImages 供预览与复用', () => {
    const mapped = mapAsset(asset({
      generation: {
        kind: 'video',
        model: 'Seedance 2.0 Mini',
        prompt: '历史生成任务',
        config: {
          mode: 'general',
          aspectRatio: '9:16',
          resolution: '720p',
          durationSeconds: 15,
          referenceAssets: [],
          referenceImages: [{
            id: ids.asset,
            name: '历史参考图片',
            type: 'image',
            previewUrl: 'https://cdn.example.com/reference-thumbnail.jpg',
            role: 'first_frame',
          }],
        },
      },
    }));

    expect(mapped.generation?.referenceImages).toEqual([
      expect.objectContaining({ id: ids.asset, name: '历史参考图片', role: 'first_frame' }),
    ]);
    expect(mapped.generation?.referenceAssets).toBeUndefined();
  });

  it('图片素材保留 Seedream 配置、标记与参考图供沿用生成', () => {
    const mapped = mapAsset(asset({
      type: 'image',
      source: 'ai-image',
      publicUrl: 'https://cdn.example.com/image.png',
      thumbnailUrl: 'https://cdn.example.com/image-thumb.png',
      durationSeconds: null,
      generation: {
        kind: 'image',
        model: 'Seedream 5.0 Pro',
        prompt: '替换@标记1的主体',
        config: {
          resolution: '2K',
          aspectRatio: '3:2',
          optimizePromptMode: 'fast',
          annotations: [{ token: '@标记1', assetId: ids.asset, type: 'point', x: 500, y: 400 }],
          referenceAssets: [{
            id: ids.asset,
            name: '参考图',
            type: 'image',
            previewUrl: null,
            role: 'reference_image',
          }],
        },
      },
    }));

    expect(mapped.generation).toMatchObject({
      kind: 'image',
      model: 'Seedream 5.0 Pro',
      resolution: '2K',
      ratio: '3:2',
      optimizePromptMode: 'fast',
      annotations: [{ token: '@标记1', assetId: ids.asset, type: 'point', x: 500, y: 400 }],
      referenceAssets: [{ id: ids.asset, type: 'image' }],
    });
  });

  it('套餐图标使用共享枚举并保留加购包规则', () => {
    expect(mapPlan(plan({ iconKey: 'zap' })).iconKey).toBe('zap');
    expect(mapPlan(plan({
      name: '企业基础版 Basic',
      nameEn: 'Enterprise Basic',
      code: 'basic.ent',
      iconKey: 'rocket',
    })).iconKey).toBe('rocket');
    expect(mapPlan(plan({
      kind: 'addon',
      billing: 'one-time',
      assetRetentionDays: 0,
      iconKey: 'rocket',
    })).iconKey).toBeNull();
    expect(mapPlan(plan({ assetRetentionDays: 90 })).assetRetentionDays).toBe(90);
  });

  it('无套餐关联账号显示为无订阅的免费版', () => {
    const account = userProfileSchema.parse({
      id: ids.user,
      email: 'user@example.com',
      userName: '测试用户',
      role: 'user',
      status: 'active',
      planCode: null,
      planName: null,
      portraitEntitlements: {
        enabled: true,
        profileLimit: 1,
        activeLimit: 1,
        assetsPerActor: 1,
      },
      billingCycle: 'monthly',
      mainCredits: 0,
      addonCredits: 0,
      credits: 0,
      totalCredits: 0,
      planResetAt: null,
      planExpiresAt: null,
      registeredAt: '2026-07-01T00:00:00.000Z',
      lastActiveAt: '2026-07-08T10:00:00.000Z',
    });

    expect(mapAccount(account)).toMatchObject({
      planCode: 'free',
      planName: '免费版',
      hasActiveSubscription: false,
      availableCredits: 0,
      resetDate: '-',
      expiresAt: '-',
    });
  });

  it('后台用户列表也将无套餐关联账号显示为免费版', () => {
    const user = adminUserSchema.parse({
      id: ids.user,
      email: 'user@example.com',
      userName: '测试用户',
      role: 'user',
      status: 'active',
      planId: null,
      planCode: null,
      planName: null,
      billingCycle: 'monthly',
      planCycleStartedAt: '2026-07-01',
      mainCredits: 0,
      addonCredits: 0,
      credits: 0,
      totalCredits: 0,
      orderCount: 0,
      ticketCount: 0,
      apiCalls: 0,
      planResetAt: null,
      planExpiresAt: null,
      activeSubscriptionOrderId: null,
      registeredAt: '2026-07-01T00:00:00.000Z',
      lastActiveAt: '2026-07-08T10:00:00.000Z',
    });

    expect(mapUser(user)).toMatchObject({
      planName: '免费版',
      mainCredits: 0,
      addonCredits: 0,
      credits: 0,
      totalCredits: 0,
      planResetAt: null,
    });
  });
});

describe('用户与后台 DTO 隔离', () => {
  it('后台订单映射保留用户 ID', () => {
    const order = orderSchema.parse({
      id: ids.asset,
      userId: ids.user,
      userName: '测试用户',
      email: 'user@example.com',
      planId: ids.plan,
      kind: 'main',
      planName: '测试套餐',
      amount: 2900,
      billing: 'monthly',
      status: 'paid',
      invoiceStatus: 'unissued',
      invoiceRequestStatus: null,
      creditStatus: 'settled',
      creditAmount: 100,
      creditBucket: 'main',
      paymentMethod: 'alipay',
      paymentMethodLabel: '支付宝',
      paymentWayLabel: '支付宝',
      paymentProvider: 'example-pay',
      paymentWayCode: null,
      paymentSurface: null,
      merchantOrderNo: 'merchant-order-1',
      paymentOrderNo: 'payment-order-1',
      paymentError: null,
      paymentAttemptStatus: 'paid',
      paymentAttemptId: null,
      paymentAttemptError: null,
      paymentRetryAfterMs: null,
      paymentExpiresAt: null,
      refundStatus: 'none',
      merchantRefundNo: null,
      refundOrderNo: null,
      refundError: null,
      refundAttemptStatus: null,
      refundAttemptId: null,
      refundManualReviewReason: null,
      refundRetryAfterMs: null,
      createdAt: '2026-07-08T10:00:00.000Z',
      paidAt: '2026-07-08T10:01:00.000Z',
      failedAt: null,
      refundedAt: null,
    });

    expect(mapOrder(order).userId).toBe(ids.user);
  });

  it('后台积分流水映射保留用户 ID', () => {
    const entry = adminCreditLedgerSchema.parse({
      id: ids.ledger,
      userId: ids.user,
      createdAt: '2026-07-08T10:00:00.000Z',
      type: 'spend',
      bucket: 'main',
      settlementStatus: 'settled',
      amount: -10,
      balance: 90,
      source: '视频生成',
      operator: 'system',
      note: '测试',
      relatedOrderId: null,
      relatedJobId: null,
      relatedAssetId: null,
      generationSnapshot: null,
      userName: '测试用户',
      email: 'user@example.com',
    });

    expect(mapLedger(entry).userId).toBe(ids.user);
  });

  it('发票映射保留用户 ID，供后台用户详情校验归属', () => {
    const invoice = invoiceSchema.parse({
      id: ids.invoice,
      orderId: ids.order,
      userId: ids.user,
      userName: '测试用户',
      email: 'user@example.com',
      planName: '测试套餐',
      amount: 2900,
      invoiceTitle: '测试公司',
      taxId: '91441900MA00000000',
      receiveEmail: 'finance@example.com',
      status: 'unissued',
      note: '测试发票',
      requestedAt: '2026-07-08T10:00:00.000Z',
      issuedAt: null,
    });

    expect(mapInvoice(invoice).userId).toBe(ids.user);
  });

  it('用户工单 Schema 过滤后台内部备注', () => {
    const ticket = userTicketSchema.parse({
      id: ids.ticket,
      userId: ids.user,
      title: '测试工单',
      userName: '测试用户',
      email: 'user@example.com',
      priority: 'medium',
      status: 'open',
      assignee: 'unassigned',
      createdAt: '2026-07-08T10:00:00.000Z',
      updatedAt: '2026-07-08T10:30:00.000Z',
      slaHours: 24,
      lastMessage: '请协助处理',
      unreadCount: 0,
      messageCount: 1,
      lastMessageAuthor: 'user',
      lastMessageAt: '2026-07-08T10:30:00.000Z',
      internalNote: '不得暴露',
    });

    expect(mapUserTicket(ticket)).not.toHaveProperty('internalNote');
  });

  it('用户积分流水 Schema 不把后台身份字段交给 mapper', () => {
    const entry = userCreditLedgerSchema.parse({
      id: ids.ledger,
      createdAt: '2026-07-08T10:00:00.000Z',
      type: 'spend',
      bucket: 'main',
      settlementStatus: 'settled',
      amount: -10,
      balance: 90,
      source: '视频生成',
      operator: 'system',
      note: '测试',
      relatedOrderId: null,
      relatedJobId: null,
      relatedAssetId: null,
      generationSnapshot: null,
      userName: '后台字段',
      email: 'private@example.com',
    });

    expect(mapUserLedger(entry)).not.toHaveProperty('userName');
    expect(mapUserLedger(entry)).not.toHaveProperty('email');
  });
});

describe('其他资源 DTO 映射', () => {
  it('将提示词向导配置映射为每次整批生成积分', () => {
    const promptWizard = promptWizardSettingsSchema.parse({
      generationCredits: 3,
      available: true,
      updatedAt: '2026-07-29T00:00:00.000Z',
    });

    expect(mapConsumptionSettings([], promptWizard).promptWizard).toEqual({
      generationCredits: 3,
      available: true,
      engineVersion: 4,
      updatedAt: '2026-07-29T00:00:00.000Z',
    });
  });

  it('滚动部署时保留 engine 3 设置，不伪装成 V6', () => {
    const promptWizard = promptWizardSettingsSchema.parse({
      generationCredits: 3,
      available: true,
      engineVersion: 3,
      updatedAt: '2026-08-08T00:00:00.000Z',
    });

    expect(mapConsumptionSettings([], promptWizard).promptWizard).toEqual({
      generationCredits: 3,
      available: true,
      engineVersion: 3,
      updatedAt: '2026-08-08T00:00:00.000Z',
    });
  });

  it('独立映射TK Prompt Engine开关，缺省时保持关闭', () => {
    const tkPromptEngine = tkPromptEngineSettingsSchema.parse({
      schemaVersion: 1,
      generationCredits: 4,
      available: true,
      updatedAt: '2026-08-17T00:00:00.000Z',
    });

    expect(mapConsumptionSettings([], undefined, undefined, tkPromptEngine).tkPromptEngine).toEqual({
      schemaVersion: 1,
      generationCredits: 4,
      available: true,
      updatedAt: '2026-08-17T00:00:00.000Z',
    });
    expect(mapConsumptionSettings([]).tkPromptEngine).toEqual({
      schemaVersion: 1,
      generationCredits: 1,
      available: false,
      updatedAt: '',
    });
  });

  it('后端缺少 Seedream 配置或仍只有旧 GPT 占位时，1K/2K 都保持关闭', () => {
    expect(mapConsumptionSettings([]).image).toEqual([
      expect.objectContaining({ modelLabel: 'Seedream 5.0 Pro', resolution: '1K', credits: 0, available: false }),
      expect.objectContaining({ modelLabel: 'Seedream 5.0 Pro', resolution: '2K', credits: 0, available: false }),
    ]);
    expect(mapConsumptionSettings([{
      id: 'legacy-gpt-image', kind: 'image', model: 'GPT Image 2.0', modelLabel: 'GPT Image 2.0',
      durationSeconds: 0, resolution: '', credits: 28, referenceVideoCredits: null,
      available: false, updatedAt: '2026-07-01T00:00:00.000Z',
    }]).image.every(item => !item.available && item.credits === 0)).toBe(true);
  });

  it('按 Seedream 1K/2K 配置映射图片积分', () => {
    const rows = (['1K', '2K'] as const).map((resolution, index) => ({
      id: `seedream-${resolution}`,
      kind: 'image' as const,
      model: 'Seedream 5.0 Pro',
      modelLabel: 'Seedream 5.0 Pro',
      durationSeconds: 0,
      resolution,
      credits: index === 0 ? 14 : 28,
      referenceVideoCredits: null,
      available: true,
      updatedAt: '2026-07-27T00:00:00.000Z',
    }));

    expect(mapConsumptionSettings(rows).image).toEqual([
      expect.objectContaining({ id: 'seedream-1K', resolution: '1K', credits: 14, available: true }),
      expect.objectContaining({ id: 'seedream-2K', resolution: '2K', credits: 28, available: true }),
    ]);
  });

  it('视频消耗配置保留无参考与含参考两个积分档', () => {
    const setting = consumptionSettingSchema.parse({
      id: ids.plan,
      kind: 'video',
      model: 'Seedance 2.0',
      modelLabel: 'Seedance 2.0',
      durationSeconds: 15,
      resolution: '720p',
      credits: 80,
      referenceVideoCredits: 95,
      available: true,
      updatedAt: '2026-07-15T10:00:00.000Z',
    });

    expect(mapConsumptionSettings([setting]).video[0]).toMatchObject({
      credits: 80,
      referenceVideoCredits: 95,
    });
  });

  it('映射 Seedance 2.5 的 25 秒积分档与模型能力元数据', () => {
    const setting = consumptionSettingSchema.parse({
      id: ids.plan,
      kind: 'video',
      model: 'Seedance 2.5',
      modelLabel: 'Seedance 2.5',
      durationSeconds: 25,
      resolution: '720p',
      credits: 179,
      referenceVideoCredits: 108,
      available: true,
      updatedAt: '2026-08-12T00:00:00.000Z',
    });
    const videoModels = [{
      id: 'seedance-2.5',
      label: 'Seedance 2.5',
      available: true,
      recommended: true,
      resolutions: ['480p', '720p'],
      durationSeconds: [5, 10, 15, 20, 25, 30],
      modes: ['general', 'first-last'],
      aspectRatios: { general: ['9:16', '16:9'], firstLast: ['adaptive'] },
      references: {
        maxTotal: 50,
        maxImages: 30,
        maxVideos: 10,
        maxAudios: 10,
        maxVideoDurationSeconds: 30,
        maxAudioDurationSeconds: 30,
        allowAudioOnly: true,
      },
      supportsPromptWizard: false,
      supportsRealPortrait: false,
      outputFormat: 'mp4',
      generateAudio: true,
    }];

    const result = mapConsumptionSettings([setting], undefined, videoModels);
    expect(result.video[0]).toMatchObject({
      model: 'seedance-2.5', duration: '25', resolution: '720p', credits: 179, referenceVideoCredits: 108,
    });
    expect(result.videoModels?.[0]).toMatchObject({
      id: 'seedance-2.5',
      recommended: true,
      durationSeconds: [5, 10, 15, 20, 25, 30],
      aspectRatios: { firstLast: ['adaptive'] },
      references: { maxTotal: 50, allowAudioOnly: true },
    });
  });

  it('API 成本 DTO 保留六位金额并只转换资源包配置的展示形式', () => {
    const dashboard = mapApiCostDashboard(endpointContracts.adminApiUsage.response.parse(validApiCostResponse()));
    expect(dashboard).toMatchObject({
      account: { availableBalanceCny: '0.000000' },
      summary: {
        localEstimatedCostCny: '272.807868',
        localEstimateCompleteness: 'complete',
        localUnavailableUsageAttempts: 0,
        todayEstimateCompleteness: 'complete',
        monthEstimateCompleteness: 'complete',
        officialListEquivalentCostCny: '305.773290',
      },
      packages: [{ id: ids.package, config: '{"model":"Seedance 2.0"}' }],
    });
  });

  it('API 成本 DTO 保留未计算预测和汇总方差的 null', () => {
    const base = validApiCostResponse();
    const response = {
      ...base,
      summary: {
        ...base.summary,
        localBillableTokens: null,
        localEstimatedCostCny: null,
        localEstimateCompleteness: 'unavailable' as const,
        localUnpricedAttempts: null,
        localUnpricedTokens: null,
        localUnavailableUsageAttempts: null,
        officialBillableTokens: null,
        officialUnpricedRows: null,
        officialUnpricedTokens: null,
        officialListEquivalentCostCny: null,
        tokenDelta: null,
        costDeltaCny: null,
        localCostUnderstatementPercent: null,
        todayEstimatedCostCny: null,
        todayEstimateCompleteness: 'unavailable' as const,
        todayUnpricedAttempts: null,
        todayUnavailableUsageAttempts: null,
        monthEstimatedCostCny: null,
        monthEstimateCompleteness: 'unavailable' as const,
        monthUnpricedAttempts: null,
        monthUnavailableUsageAttempts: null,
        allAccountOfficialDailyAverageCny: null,
        seedanceOfficialDailyAverageCny: null,
        seedanceListDailyAverageCny: null,
        noPackageProjectedDailyCostCny: null,
        noPackageRunwayDays: null,
        noPackageProjectionCoveredDays: 0,
        noPackageProjectionStatus: 'unavailable' as const,
      },
      books: {
        ...base.books,
        usage: {
          rawLocalTokens: null,
          inferredAdjustmentTokens: null,
          adjustedLocalTokens: null,
          officialTokens: null,
          rawTokenDelta: null,
          explainedTokenDelta: null,
          timingShiftTokens: null,
          residualTokens: null,
          rawCoveragePercent: null,
          adjustedCoveragePercent: null,
        },
        valuation: {
          ...base.books.valuation,
          localEstimateCompleteness: 'unavailable' as const,
          officialEstimateCompleteness: 'unavailable' as const,
          rawLocalCostCny: null,
          inferredAdjustmentCostCny: null,
          adjustedLocalCostCny: null,
          officialListEquivalentCostCny: null,
          rawCostDeltaCny: null,
          explainedCostDeltaCny: null,
          timingShiftCostCny: null,
          rateVarianceCny: null,
          roundingVarianceCny: null,
          residualCostCny: null,
        },
      },
      account: {
        ...base.account,
        availableBalanceCny: null,
        cashBalanceCny: null,
        frozenAmountCny: null,
        arrearsBalanceCny: null,
        creditLimitCny: null,
      },
    };

    const dashboard = mapApiCostDashboard(endpointContracts.adminApiUsage.response.parse(response));

    expect(dashboard.summary).toMatchObject({
      localBillableTokens: null,
      localEstimatedCostCny: null,
      localEstimateCompleteness: 'unavailable',
      localUnpricedAttempts: null,
      localUnpricedTokens: null,
      localUnavailableUsageAttempts: null,
      officialBillableTokens: null,
      tokenDelta: null,
      todayEstimatedCostCny: null,
      todayEstimateCompleteness: 'unavailable',
      monthEstimatedCostCny: null,
      monthEstimateCompleteness: 'unavailable',
      noPackageProjectedDailyCostCny: null,
      noPackageProjectionStatus: 'unavailable',
    });
    expect(dashboard.account).toMatchObject({ availableBalanceCny: null, cashBalanceCny: null });
    expect(dashboard.books.usage).toMatchObject({ rawLocalTokens: null, officialTokens: null, residualTokens: null });
    expect(dashboard.books.valuation).toMatchObject({
      rawLocalCostCny: null,
      officialListEquivalentCostCny: null,
      rateVarianceCny: null,
      roundingVarianceCny: null,
      residualCostCny: null,
    });
  });
});

function validApiCostResponse() {
  const syncItem = (kind: 'balance' | 'bill' | 'packages') => ({
    kind, status: 'fresh' as const, lastAttemptAt: '2026-07-13T06:00:00.000Z',
    lastSuccessAt: '2026-07-13T06:00:00.000Z', dataThrough: '2026-07-13', reason: null,
  });
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
    books: validApiCostBooks(),
    account: {
      provider: 'volcengine-ark', currency: 'CNY', availableBalanceCny: '0.000000', cashBalanceCny: '0.000000',
      frozenAmountCny: '0.000000', arrearsBalanceCny: '0.000000', creditLimitCny: '0.000000',
      syncedAt: '2026-07-13T06:00:00.000Z', status: 'fresh',
    },
    sync: {
      status: 'normal', stale: false, lastSyncedAt: '2026-07-13T06:00:00.000Z',
      items: [syncItem('balance'), syncItem('bill'), syncItem('packages')],
    },
    summary: {
      rangeStart: '2026-07-01', rangeEnd: '2026-07-13', timezone: 'Asia/Shanghai', billStatus: 'provisional',
      localBillableTokens: 8_042_794, localEstimatedCostCny: '272.807868', localEstimateCompleteness: 'complete',
      localUnpricedAttempts: 0, localUnpricedTokens: 0, localUnavailableUsageAttempts: 0,
      officialBillableTokens: 9_227_670, officialUnpricedRows: 0, officialUnpricedTokens: 0,
      officialListEquivalentCostCny: '305.773290', officialOriginalBillAmountCny: '0.000000',
      officialPayableAmountCny: '0.000000', officialPaidAmountCny: '0.000000', officialUnpaidAmountCny: '0.000000',
      officialDiscountAmountCny: '305.773290', resourcePackageDeductedTokens: 9_227_670,
      todayEstimatedCostCny: '0.000000', todayEstimateCompleteness: 'complete', todayUnpricedAttempts: 0,
      todayUnavailableUsageAttempts: 0, monthEstimatedCostCny: '272.807868', monthEstimateCompleteness: 'complete',
      monthUnpricedAttempts: 0, monthUnavailableUsageAttempts: 0, tokenDelta: 1_184_876,
      costDeltaCny: '32.965422', localCostUnderstatementPercent: 10.781,
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
        operationalCallCount: 0, operationalUnpricedCallCount: 0,
        settledCredits: 200, heldCredits: 0, refundedCredits: 0,
        estimatedCostCny: '305.773290', businessEstimatedCostCny: '305.773290',
        operationalEstimatedCostCny: '0.000000', knownAccountCostCny: '305.773290',
        estimateCompleteness: 'complete',
        incompleteTaskCount: 0, averageTaskCostCny: '152.886645',
      }],
    },
    models: [], daily: [], pricingRules: [],
    packages: [{
      id: ids.package, packageId: 'provider-package-1', product: '视频资源包', config: { model: 'Seedance 2.0' },
      recognizedModel: 'Seedance 2.0', status: 'active', totalQuota: 10000, remainingQuota: 7000,
      startsAt: '2026-07-01T00:00:00.000Z', expiresAt: '2026-08-01T00:00:00.000Z',
    }],
  };
}

function validApiCostBooks() {
  return {
    usage: {
      rawLocalTokens: 8_042_794, inferredAdjustmentTokens: 1_184_876, adjustedLocalTokens: 9_227_670,
      officialTokens: 9_227_670, rawTokenDelta: 1_184_876, explainedTokenDelta: 1_184_876,
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
      usageOriginalAmountCny: '305.773290', usagePayableAmountCny: '0.000000', usagePaidAmountCny: '0.000000',
      usageUnpaidAmountCny: '0.000000', packagePurchaseAmountCny: '394.000000', packagePurchasePaidAmountCny: '394.000000',
      packagePurchaseUnpaidAmountCny: '0.000000', paygPayableAmountCny: '0.000000', listPriceOffsetValueCny: '305.773290',
      listPriceOffsetStatus: 'priced', refundAmountCny: '0.000000', billingAdjustmentAmountCny: '0.000000', netOfficialPayableCny: '0.000000',
      openingPrepaidAssetCny: null, acquisitionCostCny: null, openingCatchUpCny: null, amortizedCostCny: null, expiryLossCny: null,
      adjustmentCny: null, endingPrepaidAssetCny: null, allocationStatus: 'unavailable',
      timeAttributionStatus: 'unavailable', timeAttributionReason: '尚无成本事件',
    },
  };
}


describe('后台任务列表处理阶段映射', () => {
  it('经过列表契约校验后保留提交未知阶段，供状态和操作判定使用', () => {
    const card = adminGenerationTaskCardSchema.parse({
      id: ids.asset, userId: ids.user, userName: '测试用户', email: 'test@example.com',
      kind: 'video', model: 'Seedance 2.5', status: 'processing', processingStage: 'submission-unknown',
      failureCategory: null, creditStatus: 'held', assetId: null, assetName: null, assetSource: null,
      retryCount: 0, providerRunId: null, providerRunStatus: 'submission-unknown',
      createdAt: '2026-09-30T08:58:00.000Z',
    });
    expect(mapAdminJobCard(card).processingStage).toBe('submission-unknown');
  });
});
