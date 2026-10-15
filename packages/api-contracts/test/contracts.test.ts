import { describe, expect, it } from 'vitest';
import {
  aiStudioVideoDraftSchema,
  assetCardSchema,
  assetDetailSchema,
  consumptionSettingSchema,
  endpointContracts,
  generationCreditSnapshotSchema,
  getEndpointContract,
  paymentLaunchSchema,
  promptWizardAudioModeSchema,
  promptWizardBatchSchema,
  promptWizardConceptSetSchema,
  promptWizardCreativeBriefV6Schema,
  promptWizardEvidenceGraphSchema,
  promptWizardPlanSchema,
  promptWizardPlanV4Schema,
  promptWizardPlanV5Schema,
  promptWizardPlanV6Schema,
  promptWizardProductionBriefSchema,
  promptWizardProductProfileSchema,
  promptWizardRunSchema,
  promptWizardSettingsSchema,
  promptWizardRoutePlanContextV6Schema,
  promptWizardRouteSetV6Schema,
  promptWizardUseDirectionPlanContextSchema,
  promptWizardUseDirectionSetSchema,
  providerOperationalUsageSchema,
  tkPromptEngineSettingsSchema,
  tkPromptGenerationSchema,
  tkPromptHookPatternIdSchema,
  tkPromptProofMethodIdSchema,
  tkPromptStyleSchema,
  tkPromptStrategyBlueprintSchema,
  tkPromptVideoModeSchema,
  userProfileSchema,
  userGenerationTaskSchema,
  userCreditLedgerSchema,
  userTicketSchema,
} from '../src/index.js';
import type { EndpointRequestBody } from '../src/index.js';
import { z } from 'zod';

const ids = {
  user: '11111111-1111-4111-8111-111111111111',
  task: '22222222-2222-4222-8222-222222222222',
  asset: '33333333-3333-4333-8333-333333333333',
};

describe('共享 API 契约', () => {
  it('素材卡片排序与文件夹删除内容动作使用显式共享契约', () => {
    expect(endpointContracts.assetCards.query.parse({})).toMatchObject({
      sort: 'created-desc',
      position: 'first',
      limit: 24,
    });
    expect(endpointContracts.assetCards.query.parse({ sort: 'created-asc' }).sort)
      .toBe('created-asc');
    expect(endpointContracts.assetCards.query.safeParse({ sort: 'name-asc' }).success).toBe(false);

    expect(endpointContracts.assetFolderDelete.query.parse({})).toEqual({});
    expect(endpointContracts.assetFolderDelete.query.parse({ contentAction: 'move-to-root' }))
      .toEqual({ contentAction: 'move-to-root' });
    expect(endpointContracts.assetFolderDelete.query.safeParse({ contentAction: 'archive' }).success)
      .toBe(false);
    expect(endpointContracts.assetFolderDelete.response.parse({
      ok: true,
      contentAction: 'delete-assets',
      affectedAssetCount: null,
    })).toEqual({
      ok: true,
      contentAction: 'delete-assets',
      affectedAssetCount: null,
    });
    expect(endpointContracts.assetFolderDelete.response.safeParse({
      ok: true,
      contentAction: 'move-to-root',
      affectedAssetCount: -1,
    }).success).toBe(false);
  });

  it('运营调用只为管理员确认缺失原始证据的记录返回审批元数据', () => {
    const base = {
      id: ids.task,
      origin: 'manifest-v1' as const,
      provider: 'volcengine-ark',
      serviceType: 'video' as const,
      model: 'Seedance 2.5',
      operation: 'reference-video-generation',
      operationKey: 'release-1:scenario-1',
      costOwnerUserId: ids.user,
      costOwnerUserName: 'Lindyson Admin',
      costOwnerEmail: 'admin@lindyson.com',
      purpose: 'deployment-canary' as const,
      initiatorType: 'release-automation' as const,
      initiatedByUserId: null,
      sourceRunId: 'release-1',
      sourceItemKey: 'scenario-1',
      providerTaskId: null,
      providerOperationId: null,
      providerRequestId: null,
      status: 'success' as const,
      providerReached: true,
      occurredAt: '2026-08-11T13:33:00.000Z',
      localAccountingDate: '2026-08-11',
      usageEvidence: { billableTokens: 458 },
      evidenceStatus: 'verified' as 'verified' | 'admin-confirmed-missing-original' | null,
      approvalSha256: null as string | null,
      approvedAt: null as string | null,
      evidencePath: '/audit/canary.ndjson',
      evidenceSha256: 'a'.repeat(64),
      manifestVersion: 'lindyson.provider-operational-usage/v1',
      manifestId: 'release-1',
      manifestSha256: 'b'.repeat(64),
      pricingStatus: 'priced' as const,
      priceVersion: 'volcengine-seedance-25-2026-08-11',
      pricingSourceUrl: 'https://www.volcengine.com/docs/82379/1544106',
      unitPriceSnapshot: { cnyPerMillionTokens: 42 },
      estimatedCostCny: '10.000000',
      valuationEvidenceSha256: 'c'.repeat(64),
      valuationRecordedAt: '2026-08-11T14:00:00.000Z',
      officialAttributionCount: 0,
      officialBillDetailId: null,
      officialSourceDetailKey: null,
      officialFinality: null,
      officialAttributedAmountCny: null,
      reconciliationStatus: 'unmatched' as const,
      createdAt: '2026-08-11T14:00:00.000Z',
    };
    expect(providerOperationalUsageSchema.safeParse(base).success).toBe(true);

    const adminConfirmed = {
      ...base,
      evidenceStatus: 'admin-confirmed-missing-original' as const,
      approvalSha256: 'd'.repeat(64),
      approvedAt: '2026-08-12T02:32:09.000Z',
    };
    expect(providerOperationalUsageSchema.parse(adminConfirmed)).toMatchObject({
      approvalSha256: 'd'.repeat(64),
      approvedAt: '2026-08-12T02:32:09.000Z',
    });
    expect(providerOperationalUsageSchema.safeParse({
      ...base,
      approvalSha256: 'd'.repeat(64),
      approvedAt: '2026-08-12T02:32:09.000Z',
    }).success).toBe(false);
    expect(providerOperationalUsageSchema.safeParse({
      ...adminConfirmed,
      approvalSha256: null,
      approvedAt: null,
    }).success).toBe(false);
  });

  it('生成积分流水携带严格的不可变 attempt 快照，非生成旧响应兼容为 null', () => {
    const snapshot = {
      attempt: 0,
      model: 'Seedance 2.5',
      durationSeconds: 15,
      resolution: '720p',
      hasReferenceVideo: false,
      reservedCredits: 122,
      settledCredits: 0,
      refundedCredits: 122,
      taskStatus: 'failed',
      creditStatus: 'refunded',
    };
    expect(generationCreditSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(generationCreditSnapshotSchema.safeParse({ ...snapshot, attempt: -1 }).success).toBe(false);
    expect(generationCreditSnapshotSchema.safeParse({ ...snapshot, currentTaskStatus: 'completed' }).success).toBe(false);

    const ledger = {
      id: ids.asset,
      type: 'refund',
      bucket: 'main',
      settlementStatus: 'refunded',
      amount: 122,
      balance: 500,
      source: '生成任务退回',
      note: '首次执行失败',
      relatedOrderId: null,
      relatedJobId: ids.task,
      relatedAssetId: null,
      createdAt: '2026-08-12T02:00:00.000Z',
    };
    expect(userCreditLedgerSchema.parse({ ...ledger, generationSnapshot: snapshot }).generationSnapshot)
      .toEqual(snapshot);
    expect(userCreditLedgerSchema.parse(ledger).generationSnapshot).toBeNull();
  });

  it('端点 method/path 唯一且可反向查找', () => {
    const signatures = Object.values(endpointContracts).map(item => `${item.method} ${item.path}`);
    expect(new Set(signatures).size).toBe(signatures.length);
    expect(getEndpointContract('post', '/api/auth/login')).toBe(endpointContracts.authLogin);
    expect(getEndpointContract('post', '/api/admin/assets/:id/download'))
      .toBe(endpointContracts.adminAssetDownload);
    expect(getEndpointContract('patch', '/api/admin/users/:id/subscription'))
      .toBe(endpointContracts.adminUserSubscription);
  });

  it('恢复端点只用标记通知旧任务已退役，不返回旧正文', () => {
    const emptySnapshot = {
      run: null,
      conceptSet: null,
      useDirectionSet: null,
      batch: null,
      planRevision: null,
    };

    expect(endpointContracts.promptWizardResume.response.parse(emptySnapshot))
      .toEqual({ ...emptySnapshot, legacyTaskRetired: false });
    expect(endpointContracts.promptWizardResume.response.parse({
      ...emptySnapshot,
      legacyTaskRetired: true,
    }).legacyTaskRetired).toBe(true);
    expect(endpointContracts.promptWizardResume.response.parse({
      run: null,
      batch: null,
    })).toEqual({ ...emptySnapshot, legacyTaskRetired: false });
  });

  it('后台用户套餐调整严格区分付费套餐和无套餐免费版', () => {
    const expected = {
      planId: ids.asset,
      billingCycle: 'monthly' as const,
      planCycleStartedAt: '2026-07-01',
      planResetAt: '2026-08-01',
      planExpiresAt: '2026-08-01',
      activeSubscriptionOrderId: null,
      mainCredits: 100,
    };
    const paid = {
      planId: ids.task,
      billingCycle: 'yearly' as const,
      planResetAt: '2026-08-17',
      planExpiresAt: '2027-07-17',
      note: '人工升级套餐',
      expected,
      expectedPlanCredits: 10_000,
    };
    expect(endpointContracts.adminUserSubscription.body.safeParse(paid).success).toBe(true);
    expect(endpointContracts.adminUserSubscription.body.safeParse({
      ...paid,
      planExpiresAt: '2026-08-01',
    }).success).toBe(false);

    const free = {
      planId: null,
      billingCycle: null,
      planResetAt: null,
      planExpiresAt: null,
      note: '人工切换免费版',
      expected,
      expectedPlanCredits: 0,
    };
    expect(endpointContracts.adminUserSubscription.body.safeParse(free).success).toBe(true);
    expect(endpointContracts.adminUserSubscription.body.safeParse({
      ...free,
      billingCycle: 'monthly',
    }).success).toBe(false);
    expect(endpointContracts.adminUserSubscription.body.safeParse({
      ...free,
      expectedPlanCredits: 1,
    }).success).toBe(false);
  });

  it('滚动部署期间兼容读取 engine 3/4 的提示词设置', () => {
    const baseSettings = {
      generationCredits: 2,
      available: true,
      updatedAt: '2026-08-08T00:00:00.000Z',
    };

    expect(promptWizardSettingsSchema.parse({
      ...baseSettings,
      engineVersion: 3,
    }).engineVersion).toBe(3);
    expect(promptWizardSettingsSchema.parse({
      ...baseSettings,
      engineVersion: 4,
    }).engineVersion).toBe(4);
    expect(promptWizardSettingsSchema.parse(baseSettings).engineVersion).toBe(4);
    expect(promptWizardSettingsSchema.safeParse({
      ...baseSettings,
      engineVersion: 2,
    }).success).toBe(false);

    expect(endpointContracts.generationConsumptionSettings.response.safeParse({
      items: [],
      promptWizard: {
        ...baseSettings,
        engineVersion: 3,
      },
    }).success).toBe(true);
    expect(endpointContracts.generationConsumptionSettings.response.parse({
      items: [],
      promptWizard: baseSettings,
    }).videoModels).toEqual([]);
    expect(endpointContracts.generationConsumptionSettings.response.safeParse({
      items: [],
      promptWizard: baseSettings,
      videoModels: [{
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
      }],
    }).success).toBe(true);
  });

  it('Seedance 2.5 合同支持固定 20/25/30 秒、adaptive 与最多 50 项安全素材引用', () => {
    const references = Array.from({ length: 50 }, (_, index) => ({
      assetId: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
      role: 'reference_image' as const,
    }));
    const request = {
      idempotencyKey: 'seedance-25-generation-100',
      requests: [{
        model: 'Seedance 2.5',
        prompt: '根据首帧生成有声视频',
        config: {
          mode: 'first-last' as const,
          aspectRatio: 'adaptive' as const,
          resolution: '720p' as const,
          durationSeconds: 25 as const,
        },
        references,
      }],
    };

    expect(endpointContracts.generationBatchCreate.body.safeParse(request).success).toBe(true);
    expect(endpointContracts.generationBatchCreate.body.safeParse({
      ...request,
      requests: [{ ...request.requests[0]!, references: [...references, references[0]!] }],
    }).success).toBe(false);
    expect(endpointContracts.generationBatchCreate.body.safeParse({
      ...request,
      requests: [{
        ...request.requests[0]!,
        config: { ...request.requests[0]!.config, durationSeconds: 26 },
      }],
    }).success).toBe(false);
  });

  it('25 秒滚动兼容标记只接受精确字面量 1', () => {
    expect(endpointContracts.generationConsumptionSettings.query?.safeParse({}).success).toBe(true);
    expect(endpointContracts.generationConsumptionSettings.query?.safeParse({ videoDuration25: '1' }).success).toBe(true);
    expect(endpointContracts.generationConsumptionSettings.query?.safeParse({ videoDuration25: 'true' }).success).toBe(false);
    expect(endpointContracts.adminVideoConsumptionAvailabilityUpdate.query?.safeParse({ videoDuration25: '1' }).success).toBe(true);
    expect(endpointContracts.adminVideoConsumptionAvailabilityUpdate.query?.safeParse({ videoDuration25: '0' }).success).toBe(false);
  });

  it('请求对象拒绝未声明的旧字段', () => {
    const result = endpointContracts.paymentCreate.body.safeParse({
      planId: ids.asset,
      billing: 'monthly',
      surface: 'pc',
      idempotencyKey: 'payment-key-100',
      credits: 999,
    });
    expect(result.success).toBe(false);
  });

  it('后台按正式模型原子开放或暂停全部视频积分组合', () => {
    expect(endpointContracts.adminVideoConsumptionAvailabilityUpdate.params?.safeParse({
      model: 'Seedance 2.5',
    }).success).toBe(true);
    expect(endpointContracts.adminVideoConsumptionAvailabilityUpdate.params?.safeParse({
      model: '未知模型',
    }).success).toBe(false);
    expect(endpointContracts.adminVideoConsumptionAvailabilityUpdate.body?.safeParse({
      available: true,
    }).success).toBe(true);
    expect(endpointContracts.adminVideoConsumptionAvailabilityUpdate.body?.safeParse({
      available: true,
      model: 'Seedance 2.5',
    }).success).toBe(false);
  });

  it('真人肖像激活由服务端决定固定授权期限', () => {
    const activation = {
      purpose: '授权用于商业 AI 视频生成',
      commercialUse: true as const,
      portraitNoticeVersion: 'portrait-v1',
      sensitiveInfoNoticeVersion: 'sensitive-v1',
    };

    expect(endpointContracts.realPortraitActivationCreate.body.safeParse(activation).success).toBe(true);
    expect(endpointContracts.realPortraitActivationCreate.body.safeParse({
      ...activation,
      validUntil: '2027-07-30T00:00:00.000Z',
    }).success).toBe(false);
  });

  it('提示词方案生成价格使用统一公开字段并要求客户端确认', () => {
    const settings = {
      generationCredits: 2,
      available: true,
      updatedAt: '2026-07-29T00:00:00.000Z',
    };
    expect(promptWizardSettingsSchema.safeParse(settings).success).toBe(true);
    expect(promptWizardSettingsSchema.parse(settings).engineVersion).toBe(4);
    expect(promptWizardSettingsSchema.parse({ ...settings, engineVersion: 4 }).engineVersion).toBe(4);
    expect(promptWizardSettingsSchema.parse({ ...settings, engineVersion: 3 }).engineVersion).toBe(3);
    expect(promptWizardSettingsSchema.safeParse({ ...settings, engineVersion: 2 }).success).toBe(false);
    expect(promptWizardSettingsSchema.safeParse({
      ...settings,
      generationCredits: undefined,
      refreshCredits: 2,
    }).success).toBe(false);

    const batchRequest: EndpointRequestBody<'promptWizardBatchCreate'> = {
      idempotencyKey: 'prompt-generation-1',
      revision: 3,
      expectedGenerationCredits: 2,
      voiceoverLanguage: '英语',
      videoConfig: {
        model: 'seedance-2.0',
        aspectRatio: '9:16',
        resolution: '720p',
        durationSeconds: 15,
      },
    };
    expect(endpointContracts.promptWizardBatchCreate.body.safeParse(batchRequest).success).toBe(true);
    expect(endpointContracts.promptWizardBatchCreate.body.safeParse({
      ...batchRequest,
      videoConfig: { ...batchRequest.videoConfig, durationSeconds: 25 },
    }).success).toBe(false);
    expect(endpointContracts.promptWizardBatchCreate.body.parse(batchRequest)).not.toHaveProperty('verifiedOffer');
    expect(endpointContracts.promptWizardBatchCreate.body.safeParse({
      ...batchRequest,
      verifiedOffer: '当前售价 $19.99，可领取 10% 优惠券',
    }).success).toBe(true);
    expect(endpointContracts.promptWizardBatchCreate.body.safeParse({
      ...batchRequest,
      verifiedOffer: '促'.repeat(301),
    }).success).toBe(false);
    expect(endpointContracts.promptWizardBatchCreate.body.safeParse({
      ...batchRequest,
      voiceoverLanguage: undefined,
    }).success).toBe(false);
    const soundDesignOnlyRequest: EndpointRequestBody<'promptWizardBatchCreate'> = {
      ...batchRequest,
      voiceoverLanguage: undefined,
      videoConfig: { ...batchRequest.videoConfig, durationSeconds: 5 },
    };
    expect(endpointContracts.promptWizardBatchCreate.body.safeParse(soundDesignOnlyRequest).success).toBe(true);
    expect(endpointContracts.promptWizardBatchCreate.body.safeParse({
      ...soundDesignOnlyRequest,
      voiceoverLanguage: '英语',
    }).success).toBe(false);
    expect(endpointContracts.promptWizardBatchCreate.body.safeParse({
      ...batchRequest,
      videoConfig: { ...batchRequest.videoConfig, durationSeconds: 10 },
      voiceoverLanguage: undefined,
    }).success).toBe(false);
    expect(endpointContracts.promptWizardBatchCreate.body.safeParse({
      ...batchRequest,
      useDirectionSetId: ids.task,
    }).success).toBe(false);
    expect(endpointContracts.promptWizardBatchCreate.body.safeParse({
      ...batchRequest,
      selectedUseDirectionId: ids.task,
    }).success).toBe(false);
    expect(endpointContracts.promptWizardBatchCreate.body.safeParse({
      ...batchRequest,
      selectedScene: {
        id: ids.task,
        title: '旧场景',
        environment: '旧环境',
        mainAction: '旧动作',
      },
    }).success).toBe(false);
    expect(endpointContracts.promptWizardBatchCreate.body.safeParse({
      ...batchRequest,
      customScene: {
        title: '旧自定义场景',
        environment: '旧环境',
        mainAction: '旧动作',
      },
    }).success).toBe(false);
    expect(endpointContracts.promptWizardBatchCreate.body.safeParse({
      ...batchRequest,
      targetLanguage: '英语',
    }).success).toBe(false);
    expect(endpointContracts.promptWizardBatchCreate.body.safeParse({
      ...batchRequest,
      confirmedOffer: '旧优惠字段',
    }).success).toBe(false);
    expect(endpointContracts.promptWizardBatchCreate.body.safeParse({
      ...batchRequest,
      expectedGenerationCredits: undefined,
    }).success).toBe(false);
    expect(endpointContracts.promptWizardBatchCreate.body.safeParse({
      idempotencyKey: 'prompt-generation-legacy',
      revision: 3,
      expectedRefreshCredits: 2,
    }).success).toBe(false);

    expect(endpointContracts.adminPromptWizardSettingsUpdate.body.safeParse({
      generationCredits: 0,
    }).success).toBe(true);
    expect(endpointContracts.adminPromptWizardSettingsUpdate.body.safeParse({
      engineVersion: 4,
    }).success).toBe(false);
    expect(endpointContracts.adminPromptWizardSettingsUpdate.body.safeParse({
      refreshCredits: 0,
    }).success).toBe(false);
  });

  it('V6 声音模式严格区分 5 秒纯声音设计与 10/15 秒口播', () => {
    expect(promptWizardAudioModeSchema.safeParse('sound-design-only').success).toBe(true);
    expect(promptWizardAudioModeSchema.safeParse('voiceover').success).toBe(true);
    expect(promptWizardCreativeBriefV6Schema.parse({
      audioMode: 'sound-design-only',
    })).toEqual({ audioMode: 'sound-design-only', verifiedOffer: '' });
    expect(promptWizardCreativeBriefV6Schema.safeParse({
      audioMode: 'sound-design-only',
      voiceoverLanguage: '英语',
      verifiedOffer: '',
    }).success).toBe(false);
    expect(promptWizardCreativeBriefV6Schema.safeParse({
      audioMode: 'voiceover',
      voiceoverLanguage: '英语',
      verifiedOffer: '',
    }).success).toBe(true);
    expect(promptWizardCreativeBriefV6Schema.safeParse({
      audioMode: 'voiceover',
      verifiedOffer: '',
    }).success).toBe(false);
  });

  it('TK Prompt Engine 1.0 使用独立 1+1+3 合同并拒绝不可执行视频模式', () => {
    const actorAssetId = '66666666-6666-4666-8666-666666666666';
    expect(tkPromptStyleSchema.options).toEqual([
      'drama', 'reversal', 'interview', 'story', 'unboxing',
      'product_pov', 'comparison', 'talking_head', 'pain_point', 'scene',
    ]);
    expect(tkPromptHookPatternIdSchema.options).toEqual([
      'visual_shock', 'suspense_question', 'contrast', 'pain_strike',
      'before_after', 'sound_hook', 'challenge_doubt', 'identity',
      'number_benefit', 'unexpected', 'confession', 'honest_flaw',
      'elimination_haul', 'cost_math', 'comment_reply', 'hype_confirm',
    ]);
    expect(tkPromptStyleSchema.safeParse('short_drama').success).toBe(false);
    expect(tkPromptHookPatternIdSchema.safeParse('visual_interrupt').success).toBe(false);

    const nineImages = Array.from(
      { length: 9 },
      (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    expect(endpointContracts.tkPromptRunCreate.body.safeParse({
      idempotencyKey: 'tk-prompt-run-1',
      imageAssetIds: nineImages,
    }).success).toBe(true);
    expect(endpointContracts.tkPromptRunCreate.body.safeParse({
      idempotencyKey: 'tk-prompt-run-2',
      imageAssetIds: [...nineImages, ids.asset],
    }).success).toBe(false);
    expect(endpointContracts.tkPromptRunCreate.body.safeParse({
      idempotencyKey: 'tk-prompt-run-duplicates',
      imageAssetIds: [ids.asset, ids.asset],
    }).success).toBe(false);

    const strategyBase = {
      labelZh: '最稳',
      objective: 'conversion' as const,
      styleForm: 'product' as const,
      style: 'unboxing' as const,
      hookPatternId: 'sound_hook' as const,
      firstFrameId: 'sound_sync' as const,
      firstFrame: '第一帧直接展示商品关键动作',
      openingAction: '手部立即操作商品结构',
      openingLine: 'Still dealing with this every day?',
      relevanceBeat: '展示目标用户熟悉的真实不便',
      productBridge: '镜头沿动作自然连接到商品结构',
      buyingMotivationId: 'problem_relief' as const,
      buyingMotivation: '减少重复处理日常问题的时间',
      proofMethodId: 'visible_operation' as const,
      proofMethod: '用连续操作证明图片可见结构',
      ctaStrategy: '邀请用户查看商品详情',
      requiredMaterials: ['商品', '双手', '桌面'],
      allowedFactIds: ['visible-001'],
    };
    const strategy = {
      ...strategyBase,
      slot: 'safe' as const,
      videoMode: 'product_closeup' as const,
    };
    expect(tkPromptStrategyBlueprintSchema.safeParse(strategy).success).toBe(true);
    expect(tkPromptVideoModeSchema.safeParse('graphic_montage').success).toBe(false);
    expect(tkPromptProofMethodIdSchema.safeParse('presenter_delivery').success).toBe(true);
    expect(tkPromptProofMethodIdSchema.safeParse('authorized_presenter').success).toBe(false);
    expect(tkPromptStrategyBlueprintSchema.safeParse({
      ...strategy,
      videoMode: 'graphic_montage',
    }).success).toBe(false);
    expect(tkPromptStrategyBlueprintSchema.safeParse({
      ...strategy,
      videoMode: 'live_presenter',
    }).success).toBe(true);
    expect(tkPromptStrategyBlueprintSchema.safeParse({
      ...strategy,
      videoMode: 'live_presenter',
      authorizedActorAssetId: actorAssetId,
    }).success).toBe(false);

    const generationRequest: EndpointRequestBody<'tkPromptGenerationCreate'> = {
      idempotencyKey: 'tk-prompt-generation-1',
      expectedGenerationCredits: 1,
      evidenceReview: {
        productName: '宠物喂食饮水器',
        category: '宠物用品',
        rejectedVisibleFactIds: [],
        userConfirmedFacts: [{
          factId: 'confirmed-001',
          text: '商品可用于日常喂食与饮水',
        }],
        forbiddenClaims: ['不得生成销量或效果数字'],
      },
      creativeInput: {
        targetMarket: 'United States',
        targetAudience: '养猫家庭',
        spokenLanguage: '英语',
        verifiedOffer: '',
        appearance: { mode: 'auto' },
        availableScenes: ['居家台面'],
        availableAssets: ['商品', '双手'],
      },
      videoConfig: {
        model: 'seedance-2.0',
        aspectRatio: '9:16',
        resolution: '720p',
        durationSeconds: 15,
      },
    };
    expect(endpointContracts.tkPromptGenerationCreate.body.safeParse(generationRequest).success).toBe(true);
    expect(endpointContracts.tkPromptGenerationCreate.body.safeParse({
      ...generationRequest,
      creativeInput: { ...generationRequest.creativeInput, publishLanguage: '英语' },
    }).success).toBe(false);
    expect(endpointContracts.tkPromptGenerationCreate.body.safeParse({
      ...generationRequest,
      creativeInput: { ...generationRequest.creativeInput, spokenLanguage: undefined },
    }).success).toBe(false);
    expect(endpointContracts.tkPromptGenerationCreate.body.safeParse({
      ...generationRequest,
      videoConfig: { ...generationRequest.videoConfig, durationSeconds: 5 },
    }).success).toBe(false);
    expect(endpointContracts.tkPromptGenerationCreate.body.safeParse({
      ...generationRequest,
      creativeInput: {
        ...generationRequest.creativeInput,
        spokenLanguage: undefined,
        verifiedOffer: '限时优惠',
      },
      videoConfig: { ...generationRequest.videoConfig, durationSeconds: 5 },
    }).success).toBe(false);
    expect(endpointContracts.tkPromptGenerationCreate.body.safeParse({
      ...generationRequest,
      creativeInput: {
        ...generationRequest.creativeInput,
        spokenLanguage: undefined,
        verifiedOffer: '',
      },
      videoConfig: { ...generationRequest.videoConfig, durationSeconds: 5 },
    }).success).toBe(true);
    expect(endpointContracts.tkPromptGenerationCreate.body.safeParse({
      ...generationRequest,
      creativeInput: {
        ...generationRequest.creativeInput,
        appearance: { mode: 'live_presenter' },
      },
    }).success).toBe(true);
    expect(endpointContracts.tkPromptGenerationCreate.body.safeParse({
      ...generationRequest,
      creativeInput: {
        ...generationRequest.creativeInput,
        appearance: { mode: 'live_presenter', authorizedActorAssetId: actorAssetId },
      },
    }).success).toBe(false);
    expect(endpointContracts.tkPromptGenerationCreate.body.safeParse({
      ...generationRequest,
      creativeInput: {
        ...generationRequest.creativeInput,
        appearance: { mode: 'graphic_montage' },
      },
    }).success).toBe(false);

    const plan = {
      schemaVersion: 1 as const,
      title: '真实问题现场自证',
      whyItFits: '商品结构和操作动作均能由参考图片支持',
      audioMode: 'voiceover' as const,
      executionPrompt: '【0-3s】画面：手部立即操作 @图片1 中的商品。',
      beats: [{
        startSeconds: 0,
        endSeconds: 15,
        environment: '真实居家台面',
        subject: '@图片1 对应商品与一双手',
        action: '完成一次连续、可见的商品操作',
        shotSize: '近景',
        cameraMovement: '轻微推近',
        lighting: '自然室内光',
        editingCue: '动作完成点切换',
        soundDesign: '保留真实操作声音',
        voiceoverTarget: 'See how it works in one simple move.',
        voiceoverZh: '看看一个简单动作是怎样完成的。',
        factIds: ['visible-001'],
      }],
      factsUsed: ['visible-001'],
      assumptions: [],
      requiredMaterials: ['商品', '双手'],
      warnings: [],
    };
    const strategies = [
      strategy,
      {
        ...strategy,
        slot: 'native' as const,
        labelZh: '最原生',
        objective: 'trust' as const,
        styleForm: 'scene' as const,
        style: 'scene' as const,
        videoMode: 'scene_demo' as const,
        hookPatternId: 'identity' as const,
        firstFrameId: 'pov_entry' as const,
        buyingMotivationId: 'identity_fit' as const,
        proofMethodId: 'context_demo' as const,
      },
      {
        ...strategy,
        slot: 'creative' as const,
        labelZh: '最抓眼',
        objective: 'attention' as const,
        style: 'product_pov' as const,
        hookPatternId: 'unexpected' as const,
        firstFrameId: 'structure_reveal' as const,
        buyingMotivationId: 'curiosity' as const,
        proofMethodId: 'structure_closeup' as const,
      },
    ];
    const optionIds = [
      ids.asset,
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ];
    const options = strategies.map((blueprint, index) => ({
      id: optionIds[index]!,
      generationId: ids.task,
      slot: blueprint.slot,
      status: 'completed' as const,
      strategyBlueprint: blueprint,
      plan,
      failureReason: null,
      createdAt: '2026-08-17T00:00:00.000Z',
      completedAt: '2026-08-17T00:00:10.000Z',
    }));
    const generation = {
      id: ids.task,
      runId: ids.user,
      schemaVersion: 1 as const,
      status: 'completed' as const,
      evidenceReview: {
        productName: '宠物喂食器',
        category: '宠物用品',
        rejectedVisibleFactIds: [],
        userConfirmedFacts: [],
        forbiddenClaims: [],
      },
      creativeInput: {
        targetMarket: 'United States',
        targetAudience: 'Pet owners',
        spokenLanguage: '英语' as const,
        verifiedOffer: '',
        appearance: { mode: 'product_closeup' as const },
        availableScenes: ['home'],
        availableAssets: ['商品参考图片1'],
      },
      videoConfig: {
        model: 'seedance-2.0' as const,
        aspectRatio: '9:16' as const,
        resolution: '720p' as const,
        durationSeconds: 10 as const,
      },
      isFree: true,
      credits: 0,
      creditStatus: 'none' as const,
      strategySet: strategies,
      options,
      failureReason: null,
      createdAt: '2026-08-17T00:00:00.000Z',
      completedAt: '2026-08-17T00:00:10.000Z',
    };
    expect(tkPromptGenerationSchema.safeParse(generation).success).toBe(true);
    expect(tkPromptGenerationSchema.safeParse({
      ...generation,
      options: options.slice(0, 2),
    }).success).toBe(false);
    expect(tkPromptGenerationSchema.safeParse({
      ...generation,
      strategySet: strategies.map(item => ({ ...item, slot: 'safe' })),
    }).success).toBe(false);
    expect(tkPromptGenerationSchema.safeParse({
      ...generation,
      options: options.map(item => ({
        ...item,
        plan: { ...item.plan, aiDeclaration: 'AI generated' },
      })),
    }).success).toBe(false);

    const source = {
      runId: ids.user,
      generationId: ids.task,
      optionId: ids.asset,
      schemaVersion: 1 as const,
      editBucket: 'none' as const,
    };
    expect(aiStudioVideoDraftSchema.safeParse({
      prompt: plan.executionPrompt,
      videoConfig: generationRequest.videoConfig,
      referenceImageAssetIds: [ids.asset],
      source,
    }).success).toBe(true);
    const videoRequest = {
      idempotencyKey: 'generation-from-tk-prompt',
      requests: [{
        model: 'Seedance 2.0',
        prompt: plan.executionPrompt,
        config: {
          mode: 'general' as const,
          aspectRatio: '9:16' as const,
          resolution: '720p' as const,
          durationSeconds: 15 as const,
        },
        references: [{ assetId: ids.asset, role: 'reference_image' as const }],
        tkPromptSource: source,
      }],
    };
    expect(endpointContracts.generationBatchCreate.body.safeParse(videoRequest).success).toBe(true);
    expect(endpointContracts.generationBatchCreate.body.safeParse({
      ...videoRequest,
      requests: [{
        ...videoRequest.requests[0]!,
        promptWizardSource: {
          runId: ids.user,
          batchId: ids.asset,
          planId: ids.task,
          engineVersion: 4,
          editBucket: 'none',
        },
      }],
    }).success).toBe(false);

    expect(tkPromptEngineSettingsSchema.safeParse({
      schemaVersion: 1,
      generationCredits: 1,
      available: false,
      updatedAt: '2026-08-17T00:00:00.000Z',
    }).success).toBe(true);
    expect(endpointContracts.adminTkPromptEngineSettingsUpdate.body.safeParse({
      available: true,
    }).success).toBe(true);
    expect(endpointContracts.adminTkPromptEngineSettingsUpdate.body.safeParse({}).success).toBe(false);
  });

  it('V6 运行更新只接受识别结果修正，旧配置字段只允许历史读取', () => {
    const productProfile = promptWizardProductProfileSchema.parse({
      productName: '开放式蓝牙耳机',
      category: '消费电子 > 音频 > 耳机',
      colors: '',
      materials: '',
      structure: '参考图片可见挂耳轮廓与圆形充电仓',
      logo: '',
      usage: '将挂耳结构放到耳廓外侧',
      suggestedAudience: '日常通勤与轻运动人群',
      suggestedScenarios: '通勤、办公与轻运动',
      visibleFacts: ['参考图片可见挂耳轮廓与圆形充电仓'],
      needsConfirmation: [],
      userConfirmedClaims: '',
      consistencyConstraints: '保持挂耳轮廓与圆形充电仓外观一致',
    });
    const updateRequest: EndpointRequestBody<'promptWizardRunUpdate'> = {
      revision: 2,
      productProfile,
    };
    expect(endpointContracts.promptWizardRunUpdate.body.safeParse(updateRequest).success).toBe(true);
    expect(endpointContracts.promptWizardRunUpdate.body.parse(updateRequest))
      .toEqual({ revision: 2, productProfile });
    expect(endpointContracts.promptWizardRunUpdate.body.safeParse({ revision: 2 }).success)
      .toBe(false);
    for (const retiredField of [
      { creativeBrief: { voiceoverLanguage: '英语' } },
      {
        videoConfig: {
          model: 'seedance-2.0',
          aspectRatio: '9:16',
          resolution: '720p',
          durationSeconds: 10,
        },
      },
      {
        productionBrief: {
          primaryPurchaseReason: '展示可见结构',
          appearanceMode: 'hands-only',
          availableScenes: ['整洁办公桌'],
          availableAssets: ['双手'],
        },
      },
    ]) {
      expect(endpointContracts.promptWizardRunUpdate.body.safeParse({
        ...updateRequest,
        ...retiredField,
      }).success).toBe(false);
    }

    const legacyCreativeBrief = {
      targetLanguage: '英语',
      direction: 'ugc' as const,
      marketingGoal: 'conversion' as const,
      creativeIntensity: 'balanced' as const,
      confirmedOffer: '',
    };
    expect(endpointContracts.promptWizardRunUpdate.body.safeParse({
      ...updateRequest,
      creativeBrief: legacyCreativeBrief,
    }).success).toBe(false);
    expect(endpointContracts.promptWizardRunUpdate.body.safeParse({
      ...updateRequest,
      creativeBrief: {
        voiceoverLanguage: '英语',
        direction: 'ugc',
      },
    }).success).toBe(false);
    expect(endpointContracts.promptWizardRunUpdate.body.safeParse({
      ...updateRequest,
      creativeBrief: {
        voiceoverLanguage: '英语',
        marketingGoal: 'conversion',
      },
    }).success).toBe(false);

    const historicalRun = {
      id: ids.user,
      engineVersion: 3 as const,
      status: 'ready' as const,
      revision: 2,
      imageAssetIds: [ids.asset],
      productProfile: null,
      creativeBrief: legacyCreativeBrief,
      videoConfig: null,
      productionBrief: null,
      evidenceGraph: null,
      failureReason: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:05.000Z',
    };
    expect(promptWizardRunSchema.safeParse(historicalRun).success).toBe(true);
    expect(endpointContracts.promptWizardRun.response.safeParse({ run: historicalRun }).success).toBe(true);
  });

  it('3.0 证据图谱、生产简报和异步创意路线保持严格边界', () => {
    const productionBrief = {
      primaryPurchaseReason: '通过可见结构展示日常收纳便利性',
      appearanceMode: 'hands-only' as const,
      availableScenes: ['家中桌面', '通勤包旁'],
      availableAssets: ['双手', '通勤包'],
    };
    expect(promptWizardProductionBriefSchema.safeParse(productionBrief).success).toBe(true);

    const evidenceGraph = {
      version: 1 as const,
      productFamily: 'home-living' as const,
      evidences: [{
        id: 'visibleFact:0',
        type: 'structure' as const,
        text: '参考图片可见产品具有可折叠结构',
        sourceImageAssetIds: [ids.asset],
        visibleRegion: '图片 1 中央产品主体',
        status: 'visible' as const,
        proofActions: ['用手展开并再次折叠产品'],
      }],
      reliableEvidenceIds: ['visibleFact:0'],
      pendingEvidenceIds: [],
      forbiddenAssumptionIds: [],
      directionAssessments: [
        'ugc',
        'problem-solution',
        'unboxing-review',
        'feature-test',
        'pain-comparison',
        'lifestyle',
        'cinematic-brand',
        'asmr-detail',
      ].map(direction => ({
        direction,
        availability: direction === 'unboxing-review' ? 'unavailable' : 'available',
        reason: direction === 'unboxing-review' ? '当前参考素材未显示包装' : '现有证据可支持该方向',
        missingRequirements: direction === 'unboxing-review' ? ['包装素材'] : [],
      })),
    };
    expect(promptWizardEvidenceGraphSchema.safeParse(evidenceGraph).success).toBe(true);
    const run = {
      id: ids.user,
      engineVersion: 3 as const,
      status: 'ready' as const,
      revision: 2,
      imageAssetIds: [ids.asset],
      productProfile: null,
      creativeBrief: null,
      videoConfig: null,
      productionBrief,
      evidenceGraph,
      failureReason: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:05.000Z',
    };
    expect(promptWizardRunSchema.safeParse(run).success).toBe(true);
    expect(promptWizardRunSchema.safeParse({ ...run, engineVersion: 4 }).success).toBe(true);
    expect(promptWizardRunSchema.safeParse({ ...run, engineVersion: 2 }).success).toBe(false);

    const strategy = {
      hookType: '动作悬念',
      narrativeArc: '问题到自证',
      sceneFamily: '家中桌面',
      cameraGrammar: '手部近景',
      pacing: '前快后稳',
      proofMechanism: '折叠动作闭环',
      ctaStyle: '回扣开场问题',
    };
    const conceptIds = Array.from(
      { length: 8 },
      (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    const candidates = conceptIds.map((id, index) => ({
      id,
      role: index < 4 ? 'reliable-conversion' as const : 'creative-breakthrough' as const,
      title: `创意路线 ${index + 1}`,
      firstSecondEvent: '一只手立即展开折叠产品',
      viewerQuestion: '如此小的物件展开后能做什么？',
      purchaseReason: '折叠结构便于日常收纳',
      tension: '随身空间有限但需要随时使用',
      productAction: '完成一次展开与折叠动作',
      visibleResult: '产品恢复紧凑收纳状态',
      evidenceIds: ['visibleFact:0'],
      scene: '家中桌面',
      perspective: '手部第一视角',
      cameraGrammar: '微距推近后固定展示',
      ctaCallback: '回到开场的收纳问题',
      requiredAssets: ['产品', '双手', '桌面'],
      difficulty: 'low' as const,
      risk: 'low' as const,
      direction: 'problem-solution' as const,
      strategy,
      productionLoad: {
        locationCount: 1,
        personCount: 0,
        majorActionCount: 2,
        propCount: 1,
        cameraMoveCount: 1,
        hasMagicTransition: false,
      },
      rank: index + 1,
    }));
    const conceptSet = {
      id: ids.task,
      runId: ids.user,
      status: 'completed' as const,
      runRevision: 2,
      candidates,
      recommendedConceptIds: [conceptIds[0], conceptIds[4]],
      failureReason: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      completedAt: '2026-08-01T00:00:05.000Z',
    };
    expect(promptWizardConceptSetSchema.safeParse(conceptSet).success).toBe(true);
    expect(promptWizardConceptSetSchema.safeParse({
      ...conceptSet,
      candidates: candidates.slice(0, 7),
    }).success).toBe(false);
    expect('promptWizardConceptSetCreate' in endpointContracts).toBe(false);
    expect(endpointContracts.promptWizardConceptSet.response.safeParse({ conceptSet }).success).toBe(true);
  });

  it('提示词向导产品信息保留必填颜色字段兼容旧数据', () => {
    const profile = promptWizardProductProfileSchema.parse({
      productName: '智能降噪耳机 Pro X',
      category: '头戴式耳机',
      colors: '黑色',
      materials: '哑光机身与软皮耳罩',
      structure: '可折叠头梁和椭圆形耳罩',
      logo: '右耳罩外侧可见品牌 Logo',
      usage: '佩戴于耳部使用',
      suggestedAudience: '通勤人群和音乐爱好者',
      suggestedScenarios: '通勤、办公与出行',
      visibleFacts: ['头梁可折叠', '耳罩为椭圆形'],
      needsConfirmation: ['具体材质成分'],
      userConfirmedClaims: '',
      consistencyConstraints: '保持产品结构与可见标识一致',
    });

    expect(profile.colors).toBe('黑色');
    expect(profile.categoryInferredFunctions).toBeUndefined();
    expect(promptWizardProductProfileSchema.safeParse({
      ...profile,
      categoryInferredFunctions: ['用于播放音频', '开放式佩戴可兼顾环境感知'],
    }).success).toBe(true);
    expect(promptWizardProductProfileSchema.safeParse({ ...profile, colors: undefined }).success).toBe(false);
  });

  it('公开方案契约拒绝 V1–V3，同时保留 V4 只读兼容', () => {
    const base = {
      id: ids.task,
      name: '桌面动作悬念',
      hook: '第一秒直接展示可见动作',
      narrative: '从具体困扰进入产品动作自证',
      primaryScene: '家中桌面',
      cameraAndPacing: '手部近景，前快后稳',
      differenceTags: ['动作悬念', '结构自证'],
      strategy: {
        hookType: '动作悬念',
        narrativeArc: '问题到自证',
        sceneFamily: '家中桌面',
        cameraGrammar: '手部近景',
        pacing: '前快后稳',
        proofMechanism: '动作闭环',
        ctaStyle: '回扣问题',
      },
      prompt: '【0-2s】画面：立即展开参考图片中的产品。',
    };

    for (const deliveryVersion of [1, 2, 3]) {
      expect(promptWizardPlanSchema.safeParse({ ...base, deliveryVersion }).success).toBe(false);
    }
  });

  it('使用方向集合只交付 2–3 个完整方向，并以固定问题请求一次补充', () => {
    const sceneOptions = [
      {
        id: '00000000-0000-4000-8000-000000000101',
        title: '观赛倒酒',
        environment: '客厅电视前的观赛桌面',
        mainAction: '手部向奖杯造型杯中倒入饮品并展示泡沫',
      },
      {
        id: '00000000-0000-4000-8000-000000000102',
        title: '聚会碰杯',
        environment: '朋友聚会的餐桌旁',
        mainAction: '手持杯子轻轻碰杯并旋转展示浮雕轮廓',
      },
    ];
    const direction = {
      id: '00000000-0000-4000-8000-000000000201',
      title: '比赛开场倒酒仪式',
      useMoment: '比赛开始前准备饮品时',
      audienceNeed: '球迷希望观赛用品更有仪式感和辨识度',
      purchaseReason: '奖杯造型让普通饮用动作具有明确的视觉记忆点',
      proofAction: '倒入饮品后旋转杯身展示透明浮雕与稳定底座',
      evidenceIds: ['visibleFact:0'],
      sceneOptions,
      recommendedSceneId: sceneOptions[0]!.id,
      appearanceMode: 'hands-only' as const,
      internalDirection: 'lifestyle' as const,
      requiredAssets: ['产品', '双手', '饮品'],
    };
    const completed = {
      id: ids.task,
      runId: ids.user,
      status: 'completed' as const,
      runRevision: 2,
      directions: [
        direction,
        {
          ...direction,
          id: '00000000-0000-4000-8000-000000000202',
          title: '聚会碰杯互动',
          recommendedSceneId: sceneOptions[1]!.id,
        },
      ],
      clarificationQuestion: null,
      failureReason: null,
      createdAt: '2026-08-02T00:00:00.000Z',
      completedAt: '2026-08-02T00:00:10.000Z',
    };
    expect(promptWizardUseDirectionSetSchema.safeParse(completed).success).toBe(true);
    expect(promptWizardUseDirectionSetSchema.safeParse({
      ...completed,
      directions: [direction],
    }).success).toBe(false);
    expect(promptWizardUseDirectionSetSchema.safeParse({
      ...completed,
      directions: [{ ...direction, recommendedSceneId: ids.asset }, completed.directions[1]],
    }).success).toBe(false);

    const needsInput = {
      ...completed,
      status: 'needs-input' as const,
      directions: [],
      clarificationQuestion: '请补充一个您确认真实、希望重点展示的用途或卖点。' as const,
      completedAt: null,
    };
    expect(promptWizardUseDirectionSetSchema.safeParse(needsInput).success).toBe(true);
    expect(promptWizardUseDirectionSetSchema.safeParse({
      ...needsInput,
      clarificationQuestion: '请补充更多信息。',
    }).success).toBe(false);
  });

  it('V5 方案只保存使用方向、场景与 A/B 类型，不接受七轴策略', () => {
    const useDirection = {
      id: '00000000-0000-4000-8000-000000000201',
      title: '比赛开场倒酒仪式',
      useMoment: '比赛开始前准备饮品时',
      audienceNeed: '球迷希望观赛用品更有仪式感和辨识度',
      purchaseReason: '奖杯造型让普通饮用动作具有明确的视觉记忆点',
      proofAction: '倒入饮品后旋转杯身展示透明浮雕与稳定底座',
      evidenceIds: ['visibleFact:0'],
      appearanceMode: 'hands-only' as const,
      internalDirection: 'lifestyle' as const,
      requiredAssets: ['产品', '双手', '饮品'],
    };
    const selectedScene = {
      id: '00000000-0000-4000-8000-000000000101',
      title: '观赛倒酒',
      environment: '客厅电视前的观赛桌面',
      mainAction: '手部向奖杯造型杯中倒入饮品并展示泡沫',
    };
    const shot = {
      location: selectedScene.environment,
      subject: '参考图片中的奖杯造型杯与一双手',
      shotSize: '近景',
      action: selectedScene.mainAction,
      cameraMovement: '轻微推近',
      lightingAndRealism: '自然室内光与真实手机质感',
      voiceover: 'Pour the match-day drink into a trophy-shaped glass.',
      voiceoverZh: '把比赛日饮品倒进奖杯造型杯中。',
      foley: '保留倒入饮品和泡沫形成的声音',
      editingCue: '在杯身轮廓完整出现时切换',
      evidenceRefs: ['visibleFact:0'],
      productionNote: '杯身造型与透明材质必须和参考图片一致',
    };
    const plan = {
      id: ids.task,
      deliveryVersion: 5 as const,
      variant: 'reliable' as const,
      name: '比赛开始前的倒酒仪式',
      hook: '第一秒直接把饮品倒入奖杯造型杯',
      narrative: '用一次倒酒动作展示造型，再自然回扣观赛仪式感',
      primaryScene: selectedScene.title,
      cameraAndPacing: '手部近景，动作清晰，前快后稳',
      differenceTags: ['直接自证', '易于生成'],
      prompt: '【0-2s】画面：手部向@图片1中的奖杯造型杯倒入饮品。',
      useDirection,
      selectedScene,
      shots: [
        { ...shot, startSeconds: 0, endSeconds: 1.5, role: 'hook' as const },
        { ...shot, startSeconds: 1.5, endSeconds: 3.5, role: 'proof-resolution' as const },
        { ...shot, startSeconds: 3.5, endSeconds: 5, role: 'cta' as const },
      ],
      productionWarnings: ['不要改变杯身浮雕造型'],
    };

    expect(promptWizardPlanV5Schema.safeParse(plan).success).toBe(true);
    expect(promptWizardPlanSchema.safeParse(plan).success).toBe(true);
    expect(promptWizardPlanV5Schema.safeParse({
      ...plan,
      strategy: {
        hookType: '动作悬念',
        narrativeArc: '问题到自证',
        sceneFamily: '观赛桌面',
        cameraGrammar: '手部近景',
        pacing: '前快后稳',
        proofMechanism: '倒酒动作',
        ctaStyle: '回扣比赛',
      },
    }).success).toBe(false);
    expect(promptWizardUseDirectionPlanContextSchema.safeParse({
      planIndex: 0,
      variant: 'reliable',
      useDirection,
      selectedScene,
    }).success).toBe(true);

    expect(promptWizardBatchSchema.safeParse({
      id: ids.asset,
      runId: ids.user,
      status: 'completed',
      isFree: true,
      credits: 0,
      creditStatus: 'none',
      plans: [plan, { ...plan, id: ids.user, variant: 'hook' }],
      useDirectionSetId: ids.task,
      selectedUseDirectionId: useDirection.id,
      selectedSceneId: selectedScene.id,
      customScene: null,
      failureReason: null,
      createdAt: '2026-08-02T00:00:00.000Z',
      completedAt: '2026-08-02T00:00:10.000Z',
    }).success).toBe(true);
  });

  it('V6 内部路线和已完成批次严格交付三个商业角色', () => {
    const roles = [
      'proof-conversion',
      'problem-hook',
      'lifestyle-seeding',
    ] as const;
    const scene = {
      id: null,
      title: '通勤桌面快速演示',
      environment: '自然窗光下的整洁办公桌',
      mainAction: '手部拿起参考商品并完成一次清晰的使用动作',
    };
    const claimBasisTags = [{
      labelZh: '图片可见：商品具有可折叠结构',
      basis: 'visible' as const,
      evidenceRefs: ['visibleFact:0'],
    }, {
      labelZh: 'AI 基于品类推测：适合日常随身使用',
      basis: 'category-inferred' as const,
      evidenceRefs: [],
    }];
    const routes = roles.map((role, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 301).padStart(12, '0')}`,
      role,
      titleZh: ['结构动作自证', '收纳痛点钩子', '通勤场景种草'][index]!,
      directionExplanationZh: '以不同的开场事件和镜头语法证明购买理由。',
      audienceZh: '需要兼顾便携与日常使用效率的用户',
      purchaseReasonZh: '可见结构便于完成清晰的一次性演示',
      hookZh: ['第一秒展开结构', '先出现凌乱桌面', '从通勤包取出商品'][index]!,
      proofActionZh: '完整展示一次展开、使用和收起动作',
      recommendedScene: { ...scene, title: `${scene.title} ${index + 1}` },
      appearanceMode: 'hands-only' as const,
      claimBasisTags,
      evidenceRefs: ['visibleFact:0'],
      requiredAssets: ['参考商品', '双手', '桌面'],
    }));
    const routeSet = {
      id: ids.task,
      runId: ids.user,
      status: 'completed' as const,
      runRevision: 3,
      routes,
      failureReason: null,
      createdAt: '2026-08-05T00:00:00.000Z',
      completedAt: '2026-08-05T00:00:02.000Z',
    };
    expect(promptWizardRouteSetV6Schema.safeParse(routeSet).success).toBe(true);
    expect(promptWizardRouteSetV6Schema.safeParse({
      ...routeSet,
      routes: routes.map(route => ({ ...route, role: 'proof-conversion' })),
    }).success).toBe(false);
    expect(promptWizardRouteSetV6Schema.safeParse({
      ...routeSet,
      routes: [routes[1], routes[0], routes[2]],
    }).success).toBe(false);
    for (const planIndex of [0, 1, 2] as const) {
      expect(promptWizardRoutePlanContextV6Schema.safeParse({
        planIndex,
        route: routes[planIndex],
      }).success).toBe(true);
    }
    expect(promptWizardRoutePlanContextV6Schema.safeParse({
      planIndex: 3,
      route: routes[0],
    }).success).toBe(false);

    const shot = {
      location: scene.environment,
      subject: '参考图片中的商品和一双手',
      shotSize: '近景',
      action: scene.mainAction,
      cameraMovement: '轻微推近后稳定跟随',
      lightingAndRealism: '自然窗光与真实手机拍摄质感',
      voiceover: 'See how it fits into a real commute.',
      voiceoverZh: '看看它如何融入真实通勤。',
      foley: '保留拿取和结构操作声',
      editingCue: '在动作完成点切换',
      evidenceRefs: ['visibleFact:0'],
      productionNote: '商品外观与结构必须和参考图片一致',
    };
    const plans = roles.map((role, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 401).padStart(12, '0')}`,
      deliveryVersion: 6 as const,
      audioMode: 'voiceover' as const,
      role,
      name: routes[index]!.titleZh,
      narrative: '从明确开场进入产品动作自证，最后自然回扣购买理由。',
      primaryScene: routes[index]!.recommendedScene.title,
      cameraAndPacing: '开场迅速，证明动作稳定，结尾留出 CTA。',
      differenceTags: ['真实动作', roles[index]],
      prompt: '【0-2s】画面：展示参考图片中的商品。口播：See how it fits into a real commute.',
      directionExplanationZh: routes[index]!.directionExplanationZh,
      audienceZh: routes[index]!.audienceZh,
      purchaseReasonZh: routes[index]!.purchaseReasonZh,
      hookZh: routes[index]!.hookZh,
      claimBasisTags,
      selectedScene: routes[index]!.recommendedScene,
      shots: [
        { ...shot, startSeconds: 0, endSeconds: 2.5, role: 'hook' as const },
        { ...shot, startSeconds: 2.5, endSeconds: 5, role: 'cta' as const },
      ],
      productionWarnings: ['禁止改变商品可见结构'],
    }));
    for (const plan of plans) {
      expect(promptWizardPlanV6Schema.safeParse(plan).success).toBe(true);
      expect(promptWizardPlanSchema.safeParse(plan).success).toBe(true);
      expect(plan.prompt).not.toContain(plan.shots[0]!.voiceoverZh);
    }
    const soundDesignOnlyPlan = {
      ...plans[0]!,
      audioMode: 'sound-design-only' as const,
      prompt: '【0-1.2s】画面：展示参考图片中的商品。\n【1.2-5s】画面：完成一次商品操作。',
      shots: plans[0]!.shots.map(shotItem => ({
        ...shotItem,
        voiceover: '',
        voiceoverZh: '',
      })),
    };
    expect(promptWizardPlanV6Schema.safeParse(soundDesignOnlyPlan).success).toBe(true);
    expect(promptWizardPlanSchema.safeParse(soundDesignOnlyPlan).success).toBe(true);
    expect(promptWizardPlanV6Schema.safeParse({
      ...soundDesignOnlyPlan,
      shots: soundDesignOnlyPlan.shots.map((shotItem, index) => ({
        ...shotItem,
        voiceover: index === 0 ? 'No voiceover is allowed.' : '',
      })),
    }).success).toBe(false);
    expect(promptWizardPlanV6Schema.safeParse({
      ...soundDesignOnlyPlan,
      shots: soundDesignOnlyPlan.shots.map((shotItem, index) => ({
        ...shotItem,
        voiceoverZh: index === 0 ? '纯声音设计不能包含译文。' : '',
      })),
    }).success).toBe(false);

    const batch = {
      id: ids.asset,
      runId: ids.user,
      status: 'completed' as const,
      isFree: true,
      credits: 0,
      creditStatus: 'none' as const,
      plans,
      routeSetId: routeSet.id,
      failureReason: null,
      createdAt: '2026-08-05T00:00:02.000Z',
      completedAt: '2026-08-05T00:00:10.000Z',
    };
    expect(promptWizardBatchSchema.safeParse(batch).success).toBe(true);
    expect(promptWizardBatchSchema.safeParse({ ...batch, plans: plans.slice(0, 2) }).success).toBe(false);
    expect(promptWizardBatchSchema.safeParse({ ...batch, routeSetId: null }).success).toBe(false);
    expect(promptWizardBatchSchema.safeParse({
      ...batch,
      plans: plans.map(plan => ({ ...plan, role: 'proof-conversion' })),
    }).success).toBe(false);
    expect(promptWizardBatchSchema.safeParse({
      ...batch,
      plans: [plans[1], plans[0], plans[2]],
    }).success).toBe(false);
  });

  it('AI Studio 生产草稿不接受翻译字段', () => {
    const draft = {
      prompt: '【0-5s】画面：展示产品。',
      videoConfig: {
        model: 'seedance-2.0',
        aspectRatio: '9:16',
        resolution: '720p',
        durationSeconds: 5,
      },
      referenceImageAssetIds: [ids.asset],
    };

    expect(aiStudioVideoDraftSchema.safeParse(draft).success).toBe(true);
    expect(aiStudioVideoDraftSchema.safeParse({
      ...draft,
      translationSegments: [],
    }).success).toBe(false);
  });

  it('V4 方案、单方案微调、恢复与视频来源契约可组合使用', () => {
    const shot = {
      location: '家中桌面',
      subject: '参考图片中的产品与一双手',
      shotSize: '近景',
      action: '手部展开产品并展示可见结构',
      cameraMovement: '轻微推近',
      lightingAndRealism: '自然窗光与真实手机质感',
      voiceover: 'See how it opens in one move.',
      voiceoverZh: '看它如何一步展开。',
      foley: '保留结构展开的轻微操作声',
      editingCue: '在动作完成点直接切换',
      evidenceRefs: ['visibleFact:0'],
      productionNote: '结构和 Logo 与参考图片保持一致',
    };
    const strategy = {
      hookType: '动作悬念',
      narrativeArc: '问题到自证',
      sceneFamily: '家中桌面',
      cameraGrammar: '手部近景',
      pacing: '前快后稳',
      proofMechanism: '动作闭环',
      ctaStyle: '回扣问题',
    };
    const plan = {
      id: ids.task,
      deliveryVersion: 4 as const,
      name: '一步展开的桌面悬念',
      hook: '第一秒直接展开产品',
      narrative: '从收纳困扰进入结构自证，再回扣开场问题',
      primaryScene: '家中桌面',
      cameraAndPacing: '手部近景，前快后稳',
      differenceTags: ['动作悬念', '结构自证'],
      strategy,
      prompt: '【0-2s】画面：一只手立即展开@图片1中的产品。',
      concept: {
        id: ids.asset,
        role: 'reliable-conversion' as const,
        summary: '用一次展开动作证明产品易于收纳和使用',
        firstSecondEvent: '手部立即展开产品',
        purchaseReason: '折叠结构便于日常收纳',
        evidenceIds: ['visibleFact:0'],
        requiredAssets: ['产品', '双手', '桌面'],
        difficulty: 'low' as const,
        risk: 'low' as const,
      },
      planningReview: {
        targetAudience: '桌面空间有限的日常使用者',
        surfaceNeed: '希望物品容易收纳',
        realPainPoint: '常用物品占据桌面空间',
        nonAdEntry: '从展开动作直接切入',
        proofPoints: ['visibleFact:0'],
        directionFit: '动作可以直接表现问题与解决过程',
      },
      shots: [
        { ...shot, startSeconds: 0, endSeconds: 1.5, role: 'hook' as const },
        { ...shot, startSeconds: 1.5, endSeconds: 3.5, role: 'proof-resolution' as const },
        { ...shot, startSeconds: 3.5, endSeconds: 5, role: 'cta' as const },
      ],
      productionWarnings: ['不要改变产品结构'],
    };
    expect(promptWizardPlanV4Schema.safeParse(plan).success).toBe(true);
    expect(promptWizardPlanSchema.safeParse(plan).success).toBe(true);
    expect(promptWizardPlanV4Schema.safeParse({ ...plan, concept: undefined }).success).toBe(false);

    const revision = {
      id: ids.user,
      batchId: ids.asset,
      sourcePlanId: ids.task,
      conceptId: ids.asset,
      planIndex: 0 as const,
      action: 'stronger-hook' as const,
      status: 'completed' as const,
      isFree: true,
      plan,
      failureReason: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      completedAt: '2026-08-01T00:00:05.000Z',
    };
    expect('promptWizardPlanRefinementCreate' in endpointContracts).toBe(false);
    expect(endpointContracts.promptWizardPlanRevision.response.safeParse({ revision }).success).toBe(true);

    const source = {
      runId: ids.user,
      batchId: ids.asset,
      planId: ids.task,
      planRevisionId: ids.user,
      engineVersion: 3 as const,
      editBucket: 'minor' as const,
    };
    expect(aiStudioVideoDraftSchema.safeParse({
      prompt: plan.prompt,
      videoConfig: {
        model: 'seedance-2.0',
        aspectRatio: '9:16',
        resolution: '720p',
        durationSeconds: 5,
      },
      referenceImageAssetIds: [ids.asset],
      source,
    }).success).toBe(true);
    expect(endpointContracts.generationBatchCreate.body.safeParse({
      idempotencyKey: 'generation-from-prompt-wizard',
      requests: [{
        model: 'seedance-2.0',
        prompt: plan.prompt,
        config: {
          mode: 'general',
          aspectRatio: '9:16',
          resolution: '720p',
          durationSeconds: 5,
        },
        references: [],
        promptWizardSource: source,
      }],
    }).success).toBe(true);
  });

  it('启用真人库的主套餐必须显式设置 1 到 3650 天，关闭时仍允许 0', () => {
    const base = {
      code: 'retention-test',
      name: '保留期测试套餐',
      kind: 'main' as const,
      billing: 'both' as const,
      credits: 1000,
      portraitEntitlements: {
        enabled: true,
        profileLimit: 5,
        activeLimit: 3,
        assetsPerActor: 2,
      },
    };

    expect(endpointContracts.adminPlanCreate.body.safeParse(base).success).toBe(false);
    expect(endpointContracts.adminPlanCreate.body.safeParse({ ...base, assetRetentionDays: 0 }).success).toBe(false);
    expect(endpointContracts.adminPlanCreate.body.safeParse({ ...base, assetRetentionDays: 1 }).success).toBe(true);
    expect(endpointContracts.adminPlanCreate.body.safeParse({ ...base, assetRetentionDays: 3650 }).success).toBe(true);
    expect(endpointContracts.adminPlanCreate.body.safeParse({ ...base, assetRetentionDays: -1 }).success).toBe(false);
    expect(endpointContracts.adminPlanCreate.body.safeParse({ ...base, assetRetentionDays: 1.5 }).success).toBe(false);
    expect(endpointContracts.adminPlanCreate.body.safeParse({ ...base, assetRetentionDays: 3651 }).success).toBe(false);
    expect(endpointContracts.adminPlanCreate.body.safeParse({
      ...base,
      assetRetentionDays: 0,
      portraitEntitlements: {
        enabled: false,
        profileLimit: 0,
        activeLimit: 0,
        assetsPerActor: 0,
      },
    }).success).toBe(true);
  });

  it('主套餐必须明确设置真人人像权益，加购包始终关闭', () => {
    const base = {
      code: 'portrait-test',
      name: '真人人像测试套餐',
      kind: 'main' as const,
      billing: 'both' as const,
      credits: 1000,
    };
    expect(endpointContracts.adminPlanCreate.body.safeParse(base).success).toBe(false);
    expect(endpointContracts.adminPlanCreate.body.safeParse({
      ...base,
      assetRetentionDays: 90,
      portraitEntitlements: {
        enabled: true,
        profileLimit: null,
        activeLimit: 10,
        assetsPerActor: 2,
      },
    }).success).toBe(true);
    expect(endpointContracts.adminPlanCreate.body.safeParse({
      ...base,
      assetRetentionDays: 30,
      portraitEntitlements: {
        enabled: true,
        profileLimit: 2,
        activeLimit: 3,
        assetsPerActor: 2,
      },
    }).success).toBe(false);
    expect(endpointContracts.adminPlanCreate.body.safeParse({
      ...base,
      kind: 'addon',
      billing: 'one-time',
      portraitEntitlements: {
        enabled: true,
        profileLimit: 1,
        activeLimit: 1,
        assetsPerActor: 1,
      },
    }).success).toBe(false);
    expect(endpointContracts.adminPlanCreate.body.safeParse({
      ...base,
      kind: 'addon',
      billing: 'one-time',
    }).success).toBe(true);
  });

  it('后台套餐 PATCH 必须显式提交真人权益与对应保留期，且加购包只能提交全零关闭值', () => {
    const disabledPortraitEntitlements = {
      enabled: false,
      profileLimit: 0,
      activeLimit: 0,
      assetsPerActor: 0,
    };
    expect(endpointContracts.adminPlanUpdate.body.safeParse({ name: '新名称' }).success).toBe(false);
    expect(endpointContracts.adminPlanUpdate.body.safeParse({
      name: '新名称',
      portraitEntitlements: disabledPortraitEntitlements,
    }).success).toBe(true);
    expect(endpointContracts.adminPlanUpdate.body.safeParse({
      portraitEntitlements: {
        enabled: true,
        profileLimit: 5,
        activeLimit: 3,
        assetsPerActor: 2,
      },
    }).success).toBe(false);
    expect(endpointContracts.adminPlanUpdate.body.safeParse({
      assetRetentionDays: 30,
      portraitEntitlements: {
        enabled: true,
        profileLimit: 5,
        activeLimit: 3,
        assetsPerActor: 2,
      },
    }).success).toBe(true);
    expect(endpointContracts.adminPlanUpdate.body.safeParse({
      kind: 'addon',
      portraitEntitlements: disabledPortraitEntitlements,
    }).success).toBe(true);
    expect(endpointContracts.adminPlanUpdate.body.safeParse({
      kind: 'addon',
      portraitEntitlements: {
        enabled: true,
        profileLimit: 1,
        activeLimit: 1,
        assetsPerActor: 1,
      },
    }).success).toBe(false);
    expect(endpointContracts.adminPlanUpdate.body.safeParse({
      kind: 'addon',
      portraitEntitlements: {
        enabled: false,
        profileLimit: 0,
        activeLimit: 1,
        assetsPerActor: 0,
      },
    }).success).toBe(false);
  });

  it('后台公告使用带搜索指纹的精准快照页，不再接受全量 items 响应', () => {
    expect(endpointContracts.adminAnnouncements.query.parse({ position: 'last', limit: 20, search: '维护' })).toEqual({
      position: 'last',
      limit: 20,
      search: '维护',
    });
    const announcement = {
      id: ids.asset,
      title: '维护公告',
      content: '维护内容',
      pinned: false,
      publishedAt: '2026-07-17T00:00:00.000Z',
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-17T00:00:00.000Z',
    };
    expect(endpointContracts.adminAnnouncements.response.safeParse({
      items: [announcement],
      pagination: {
        limit: 20,
        currentPage: 2,
        totalPages: 2,
        totalItems: 21,
        snapshotCursor: 'signed-snapshot',
        hasPrevious: true,
        hasNext: false,
        previousCursor: 'signed-cursor',
        nextCursor: null,
      },
    }).success).toBe(true);
    expect(endpointContracts.adminAnnouncements.response.safeParse({ items: [announcement] }).success).toBe(false);
  });

  it('核心八个后台列表统一接受 snapshotCursor 并返回精准页码', () => {
    const exactPagination = {
      limit: 20,
      currentPage: 1,
      totalPages: 3,
      totalItems: 41,
      snapshotCursor: 'signed-snapshot',
      hasPrevious: false,
      hasNext: true,
      previousCursor: null,
      nextCursor: 'signed-boundary',
    };
    for (const name of [
      'adminAnnouncements',
      'adminUsers',
      'adminOrders',
      'adminInvoices',
      'adminTickets',
      'adminJobs',
      'adminCreditLedger',
      'adminAuditLogs',
    ] as const) {
      const endpoint = endpointContracts[name];
      expect(endpoint.query.parse({ snapshotCursor: 'signed-snapshot' }), name)
        .toMatchObject({ snapshotCursor: 'signed-snapshot' });
      expect(endpoint.response.safeParse({ items: [], pagination: exactPagination }).success, name)
        .toBe(true);
      const { currentPage: _currentPage, totalPages: _totalPages, totalItems: _totalItems,
        snapshotCursor: _snapshotCursor, ...legacyPagination } = exactPagination;
      expect(endpoint.response.safeParse({ items: [], pagination: legacyPagination }).success, name)
        .toBe(false);
    }
  });

  it('全部端点请求对象默认拒绝未知字段', () => {
    for (const [name, endpoint] of Object.entries(endpointContracts)) {
      for (const [location, schema] of [
        ['body', 'body' in endpoint ? endpoint.body : undefined],
        ['query', 'query' in endpoint ? endpoint.query : undefined],
        ['params', 'params' in endpoint ? endpoint.params : undefined],
      ] as const) {
        if (!schema) continue;
        for (const objectSchema of unwrapObjects(schema)) {
          expect(objectSchema._def.unknownKeys, `${name}.${location}`).toBe('strict');
        }
      }
    }
  });

  it('JSON成功响应根对象过滤未声明字段，缩略图响应为二进制', () => {
    for (const [name, endpoint] of Object.entries(endpointContracts)) {
      if (name === 'realPortraitAssetThumbnail') {
        expect(endpoint.response.safeParse(new Uint8Array([1, 2, 3])).success).toBe(true);
        expect(endpoint.response.safeParse({}).success).toBe(false);
        continue;
      }
      for (const objectSchema of unwrapObjects(endpoint.response)) {
        expect(objectSchema._def.unknownKeys, `${name}.response`).toBe('strip');
      }
    }
  });

  it('用户资料对必填字段、枚举、日期和积分边界逐项校验', () => {
    const valid = {
      id: ids.user,
      email: 'USER@example.com',
      userName: '测试用户',
      role: 'user',
      status: 'active',
      planCode: 'free',
      planName: '免费版',
      portraitEntitlements: {
        enabled: true,
        profileLimit: 1,
        activeLimit: 1,
        assetsPerActor: 1,
      },
      billingCycle: 'monthly',
      mainCredits: 100,
      addonCredits: 0,
      credits: 100,
      totalCredits: 100,
      planResetAt: '2026-08-01',
      planExpiresAt: null,
      registeredAt: '2026-07-13T10:00:00.000Z',
      lastActiveAt: '2026-07-13T10:00:00.000Z',
    };

    expect(userProfileSchema.parse(valid).email).toBe('user@example.com');
    expect(userProfileSchema.safeParse(({ ...valid, userName: undefined })).success).toBe(false);
    expect(userProfileSchema.safeParse(({ ...valid, role: 'owner' })).success).toBe(false);
    expect(userProfileSchema.safeParse(({ ...valid, registeredAt: '2026/07/13' })).success).toBe(false);
    expect(userProfileSchema.safeParse(({ ...valid, credits: -1 })).success).toBe(false);
    expect(userProfileSchema.safeParse(({ ...valid, credits: Number.POSITIVE_INFINITY })).success).toBe(false);
  });

  it('分页和生成请求拒绝越界数字、非法枚举及遗留字段', () => {
    expect(endpointContracts.generationTasks.query.safeParse({ limit: 0 }).success).toBe(false);
    expect(endpointContracts.generationTasks.query.safeParse({ limit: 51 }).success).toBe(false);
    for (const endpoint of [
      endpointContracts.generationTasks,
      endpointContracts.accountCreditLedger,
      endpointContracts.orders,
      endpointContracts.supportTickets,
    ]) {
      expect(endpoint.query.parse({})).toMatchObject({ position: 'first', limit: 20 });
      expect(endpoint.response.safeParse({
        items: [],
        pagination: { limit: 20, hasMore: false, nextCursor: null },
      }).success).toBe(false);
    }
    expect(endpointContracts.generationBatchCreate.body.safeParse({
      idempotencyKey: 'generation-key-100',
      requests: [{
        model: 'Seedance 2.0',
        prompt: '生成测试视频',
        config: {
          mode: 'general',
          aspectRatio: '1:1',
          resolution: '720p',
          durationSeconds: 5,
          referenceImages: [],
          referenceAssets: [],
        },
      }],
    }).success).toBe(false);
    expect(endpointContracts.generationBatchCreate.body.safeParse({
      idempotencyKey: 'generation-key-asset-id-100',
      requests: [{
        model: 'Seedance 2.0',
        prompt: '按资产 ID 生成测试视频',
        config: {
          mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5,
        },
        references: [{ assetId: ids.asset, role: 'reference_image' }],
      }],
    }).success).toBe(true);
    expect(endpointContracts.generationBatchCreate.body.safeParse({
      idempotencyKey: 'generation-key-object-100',
      requests: [{
        model: 'Seedance 2.0',
        prompt: '禁止对象 key',
        config: {
          mode: 'general', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5,
        },
        references: [{
          assetId: ids.asset, role: 'reference_image', objectKey: 'users/user/reference.png',
        }],
      }],
    }).success).toBe(false);
    expect(endpointContracts.generationBatchCreate.body.safeParse({
      idempotencyKey: 'generation-key-100',
      requests: [],
    }).success).toBe(false);
  });

  it('视频生成任务不再公开取消接口', () => {
    expect(getEndpointContract('post', '/api/ai/tasks/:id/cancel')).toBeUndefined();
    expect('generationTaskCancel' in endpointContracts).toBe(false);
  });

  it('Seedream 图片批量请求锁定模型、参数、引用与结构化坐标边界', () => {
    const valid = {
      idempotencyKey: 'seedream-batch-key-100',
      requests: [{
        model: 'Seedream 5.0 Pro',
        prompt: '把 @标记1 换成皇冠',
        config: { resolution: '2K', aspectRatio: '3:4', optimizePromptMode: 'fast' },
        references: [{ assetId: ids.asset, role: 'reference_image' }],
        annotations: [{ token: '@标记1', assetId: ids.asset, type: 'bbox', x1: 1, y1: 2, x2: 998, y2: 999 }],
      }],
    };
    expect(endpointContracts.imageGenerationBatchCreate).toMatchObject({
      method: 'POST', path: '/api/ai/image-tasks/batch', successStatus: 200,
    });
    expect(endpointContracts.imageGenerationBatchCreate.body.safeParse(valid).success).toBe(true);
    expect(endpointContracts.imageGenerationBatchCreate.body.safeParse({
      ...valid,
      requests: [{ ...valid.requests[0], model: 'Seedream 5.0 pro' }],
    }).success).toBe(false);
    expect(endpointContracts.imageGenerationBatchCreate.body.safeParse({
      ...valid,
      requests: [{ ...valid.requests[0], references: [{ assetId: ids.asset, role: 'first_frame' }] }],
    }).success).toBe(false);
    expect(endpointContracts.imageGenerationBatchCreate.body.safeParse({
      ...valid,
      requests: [{
        ...valid.requests[0],
        annotations: [{ token: '@标记1', assetId: ids.asset, type: 'bbox', x1: 10, y1: 2, x2: 10, y2: 999 }],
      }],
    }).success).toBe(false);
    expect(endpointContracts.imageGenerationBatchCreate.body.safeParse({
      ...valid,
      requests: [{
        ...valid.requests[0],
        references: [{ ...valid.requests[0]!.references[0]!, objectKey: 'users/u/ref.png' }],
      }],
    }).success).toBe(false);
    for (const untrustedField of ['width', 'height', 'naturalWidth', 'naturalHeight', 'sizeBytes']) {
      expect(endpointContracts.imageGenerationBatchCreate.body.safeParse({
        ...valid,
        requests: [{
          ...valid.requests[0],
          references: [{ ...valid.requests[0]!.references[0]!, [untrustedField]: 2048 }],
        }],
      }).success, `浏览器不能提交 ${untrustedField} 绕过服务端资产校验`).toBe(false);
    }
    expect(endpointContracts.generationTasks.query.parse({ kind: 'image' })).toMatchObject({
      kind: 'image', position: 'first', limit: 20,
    });
  });

  it('后台任务详情只投影安全引用字段并剥离旧对象 key 与 URL', () => {
    const response = endpointContracts.adminJobDetail.response.parse({
      task: {
        id: ids.task,
        userId: ids.user,
        userName: '测试用户',
        email: 'user@example.com',
        kind: 'video',
        model: 'Seedance 2.0 Mini',
        status: 'completed',
        failureCategory: null,
        failureReason: null,
        prompt: '测试历史任务',
        config: {
          mode: 'general',
          aspectRatio: '9:16',
          resolution: '720p',
          durationSeconds: 15,
          referenceAssets: [{
            id: ids.asset,
            name: '历史参考图片',
            type: 'image',
            role: 'first_frame',
            previewUrl: null,
            publicUrl: 'https://cdn.example.com/reference.jpg',
            objectKey: 'users/test/reference.jpg',
            thumbnailUrl: 'https://cdn.example.com/reference-thumbnail.jpg',
            thumbnailKey: 'users/test/reference-thumbnail.jpg',
          }],
        },
        credits: 20,
        reservedCredits: 20,
        settledCredits: 20,
        refundedCredits: 0,
        creditStatus: 'settled',
        mainCreditsUsed: 20,
        addonCreditsUsed: 0,
        assetId: null,
        retryCount: 0,
        attempt: 0,
        processingStage: null,
        createdAt: '2026-07-11T10:00:00.000Z',
        startedAt: '2026-07-11T10:00:01.000Z',
        completedAt: '2026-07-11T10:01:00.000Z',
        providerTaskId: 'provider-task-1',
        settlementError: null,
        assetName: null,
        assetSource: null,
        ledgerIds: [],
        heartbeatAt: null,
        leaseExpiresAt: null,
      },
    });

    expect(response.task.config.referenceAssets).toEqual([{
      id: ids.asset,
      name: '历史参考图片',
      type: 'image',
      role: 'first_frame',
      previewUrl: null,
    }]);
    expect(JSON.stringify(response.task.config)).not.toMatch(/objectKey|thumbnailKey|publicUrl|thumbnailUrl/);
  });

  it('支付启动地址拒绝危险协议、凭据和不安全 PC 地址', () => {
    expect(paymentLaunchSchema.safeParse({ surface: 'mobile', type: 'url', url: 'javascript:alert(1)' }).success).toBe(false);
    expect(paymentLaunchSchema.safeParse({ surface: 'mobile', type: 'url', url: 'https://user:secret@example.com/pay' }).success).toBe(false);
    expect(paymentLaunchSchema.safeParse({ surface: 'pc', type: 'qr', codeUrl: 'http://example.com/pay' }).success).toBe(false);
    expect(paymentLaunchSchema.safeParse({ surface: 'pc', type: 'qr', codeUrl: 'https://example.com/pay' }).success).toBe(true);
  });

  it('消耗配置要求完整 DTO、合法日期和有限非负整数', () => {
    const valid = {
      id: ids.task,
      kind: 'video',
      model: 'Seedance 2.0',
      modelLabel: 'Seedance 2.0',
      durationSeconds: 5,
      resolution: '720p',
      credits: 20,
      referenceVideoCredits: 32,
      available: true,
      updatedAt: '2026-07-13T10:00:00.000Z',
    };
    expect(consumptionSettingSchema.safeParse(valid).success).toBe(true);
    expect(consumptionSettingSchema.safeParse(({ ...valid, updatedAt: undefined })).success).toBe(false);
    expect(consumptionSettingSchema.safeParse(({ ...valid, updatedAt: '昨天' })).success).toBe(false);
    expect(consumptionSettingSchema.safeParse(({ ...valid, credits: 1.5 })).success).toBe(false);
    expect(consumptionSettingSchema.safeParse(({ ...valid, referenceVideoCredits: -1 })).success).toBe(false);
    expect(consumptionSettingSchema.safeParse(({ ...valid, referenceVideoCredits: null })).success).toBe(false);
    expect(consumptionSettingSchema.safeParse(({
      ...valid,
      kind: 'image',
      durationSeconds: null,
      resolution: '',
      referenceVideoCredits: null,
    })).success).toBe(true);
    expect(consumptionSettingSchema.safeParse(({ ...valid, kind: 'image' })).success).toBe(false);
  });

  it('用户工单响应剥离后台内部字段', () => {
    const parsed = userTicketSchema.parse({
      id: ids.task,
      userId: ids.user,
      title: '需要帮助',
      userName: '测试用户',
      email: 'user@example.com',
      priority: 'medium',
      status: 'open',
      assignee: '',
      createdAt: '2026-07-13T10:00:00.000Z',
      updatedAt: '2026-07-13T10:00:00.000Z',
      slaHours: 24,
      lastMessage: '问题描述',
      unreadCount: 0,
      messageCount: 1,
      lastMessageAuthor: 'user',
      lastMessageAt: '2026-07-13T10:00:00.000Z',
      internalNote: '不得发给用户',
    });
    expect(parsed).not.toHaveProperty('internalNote');
  });

  it('用户任务响应剥离后台身份字段', () => {
    const parsed = userGenerationTaskSchema.parse({
      id: ids.task,
      userId: ids.user,
      userName: '测试用户',
      email: 'user@example.com',
      kind: 'video',
      model: 'seedance-2.0',
      status: 'queued',
      failureCategory: null,
      failureReason: null,
      prompt: '测试视频',
      config: {
        referenceImages: [{
          id: ids.asset,
          name: '历史参考图片',
          objectKey: 'users/user/private.png',
        }],
        referenceAssets: [{
          id: ids.asset,
          name: '安全参考图片',
          type: 'image',
          role: 'reference_image',
          previewUrl: null,
          objectKey: 'users/user/private.png',
          thumbnailKey: 'users/user/private-thumb.jpg',
        }],
      },
      credits: 10,
      reservedCredits: 10,
      settledCredits: 0,
      refundedCredits: 0,
      creditStatus: 'held',
      mainCreditsUsed: 10,
      addonCreditsUsed: 0,
      assetId: null,
      retryCount: 0,
      attempt: 0,
      processingStage: null,
      createdAt: '2026-07-13T10:00:00.000Z',
      startedAt: null,
      completedAt: null,
    });
    expect(parsed).not.toHaveProperty('userId');
    expect(parsed).not.toHaveProperty('email');
    expect(parsed.config).not.toHaveProperty('referenceImages');
    expect(JSON.stringify(parsed.config)).not.toMatch(/objectKey|thumbnailKey|users\/user\//);
  });

  it('素材卡片和详情响应会剥离所有对象 key', () => {
    const common = {
      id: ids.asset,
      name: '安全素材.mp4',
      type: 'video',
      source: 'ai-video',
      folderId: null,
      sizeBytes: 1024,
      durationSeconds: 5,
      width: 1280,
      height: 720,
      views: 0,
      createdAt: '2026-07-13T10:00:00.000Z',
      updatedAt: '2026-07-13T10:00:00.000Z',
    };
    const card = assetCardSchema.parse({
      ...common,
      previewUrl: 'https://cdn.example.com/thumb.jpg',
      mediaExtension: 'mp4',
      firstDownloadAt: null,
      objectKey: 'users/user/video.mp4',
      generation: { prompt: '不得进入卡片' },
    });
    const detail = assetDetailSchema.parse({
      ...common,
      publicUrl: 'https://cdn.example.com/video.mp4',
      thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
      downloadedAt: null,
      downloadRequestedAt: null,
      objectKey: 'users/user/video.mp4',
      thumbnailKey: 'users/user/thumb.jpg',
      generation: {
        kind: 'video', model: 'Seedance 2.0', prompt: '安全详情',
        config: {
          referenceAssets: [{
            id: ids.asset,
            name: '参考视频',
            type: 'video',
            role: 'reference_video',
            previewUrl: 'https://cdn.example.com/reference-thumb.jpg',
            objectKey: 'users/user/reference.mp4',
            thumbnailKey: 'users/user/reference-thumb.jpg',
          }],
        },
      },
    });

    expect(JSON.stringify(card)).not.toMatch(/objectKey|generation/);
    expect(JSON.stringify(detail)).not.toMatch(/objectKey|thumbnailKey/);
  });

  it('成本看盘自定义范围要求成对且有序，并区分轻量经营与高级审计端点', () => {
    expect(endpointContracts.adminApiUsage.query.parse({
      range: 'custom', from: '2026-07-01', to: '2026-07-13',
    })).toMatchObject({ range: 'custom', from: '2026-07-01', to: '2026-07-13' });
    expect(endpointContracts.adminApiUsage.query.safeParse({
      range: 'custom', from: '2026-07-01',
    }).success).toBe(false);
    expect(endpointContracts.adminApiUsage.query.safeParse({
      range: 'custom', from: '2026-07-13', to: '2026-07-01',
    }).success).toBe(false);
    expect(endpointContracts.adminApiUsage.query.safeParse({
      range: 'month', month: '2026-07', from: '2026-07-01', to: '2026-07-13',
    }).success).toBe(false);
    expect(endpointContracts.adminApiUsageAttempts).toMatchObject({
      method: 'GET', path: '/api/admin/api-usage/attempts', successStatus: 200,
    });
    expect(endpointContracts.adminApiUsageOverview).toMatchObject({
      method: 'GET', path: '/api/admin/api-usage/overview', successStatus: 200,
    });
    expect(endpointContracts.adminApiUsageTasks.query.parse({})).toMatchObject({
      position: 'first', limit: 20,
    });
    expect(endpointContracts.adminApiUsageTasks.query.parse({ costState: 'unfinalized' }))
      .toMatchObject({ costState: 'unfinalized' });
    expect(endpointContracts.adminApiUsageTasks.query.safeParse({ costState: 'unknown' }).success)
      .toBe(false);
    expect(endpointContracts.adminApiUsageTasks.query.safeParse({ limit: 51 }).success).toBe(false);
    const emptyCostPage = {
      items: [],
      pagination: {
        limit: 20, hasPrevious: false, hasNext: false,
        previousCursor: null, nextCursor: null,
        currentPage: 0, totalPages: 0, totalItems: 0,
        snapshotCursor: 'signed-snapshot',
      },
      asOf: '2026-07-13T06:00:00.000Z',
      selection: {
        range: 'month', month: '2026-07', date: null,
        rangeStart: '2026-07-01', rangeEnd: '2026-07-13',
        timezone: 'Asia/Shanghai', grain: 'day',
      },
    };
    expect(endpointContracts.adminApiUsageTasks.response.safeParse(emptyCostPage).success).toBe(true);
    expect(endpointContracts.adminApiUsageTasks.response.safeParse({
      ...emptyCostPage,
      pagination: { limit: 20, hasMore: false, nextCursor: null },
    }).success).toBe(false);

    const overviewShape = unwrapObject(endpointContracts.adminApiUsageOverview.response).shape;
    expect(Object.keys(overviewShape).sort()).toEqual([
      'account', 'asOf', 'models', 'operations', 'selection', 'sync',
    ]);
    expect(overviewShape).not.toHaveProperty('books');
    expect(overviewShape).not.toHaveProperty('coverage');
    expect(overviewShape).not.toHaveProperty('packages');
    expect(overviewShape).not.toHaveProperty('pricingRules');

    expect(endpointContracts.adminApiUsageMultimodalOverview).toMatchObject({
      method: 'GET', path: '/api/admin/api-usage/multimodal/overview', successStatus: 200,
    });
    expect(endpointContracts.adminApiUsageMultimodalUsers.query.parse({})).toMatchObject({
      position: 'first', limit: 20,
    });
    expect(endpointContracts.adminApiUsageMultimodalOperations.query.parse({
      operationType: 'analysis', status: 'ready', search: 'user@example.com',
    })).toMatchObject({ operationType: 'analysis', status: 'ready', position: 'first', limit: 20 });
    expect(endpointContracts.adminApiUsageMultimodalOperations.query.safeParse({
      operationType: 'video',
    }).success).toBe(false);
    expect(endpointContracts.adminApiUsageMultimodalOperations.query.safeParse({
      range: 'custom', from: '2026-07-01', limit: 20,
    }).success).toBe(false);
    expect(endpointContracts.adminApiUsageMultimodalUsers.query.safeParse({ limit: 51 }).success).toBe(false);
    const legacyMultimodalOverview = endpointContracts.adminApiUsageMultimodalOverview.response.parse({
      asOf: '2026-07-13T06:00:00.000Z',
      selection: emptyCostPage.selection,
      account: {
        provider: 'volcengine-ark', currency: 'CNY', availableBalanceCny: null,
        cashBalanceCny: null, frozenAmountCny: null, arrearsBalanceCny: null,
        creditLimitCny: null, syncedAt: '-', status: 'never-synced',
      },
      summary: {
        analysisCount: 1, batchCount: 1, userCount: 1,
        settledCredits: 1, refundedCredits: 0, incompleteOperationCount: 1,
        historicalEvidenceOperationCount: 1,
        operationalCallCount: 0, operationalUnpricedCallCount: 0,
        businessEstimatedCostCny: '0.001920', operationalEstimatedCostCny: '0.000000',
        knownAccountCostCny: '0.001920',
        knownInputTokens: 1200, knownCachedInputTokens: 200, knownOutputTokens: 300,
        knownCostCny: '0.001920', providerRequestCount: 2,
        reconciledZeroRequestCount: 1, unknownUsageRequestCount: 0, unpricedRequestCount: 0,
        estimateCompleteness: 'partial',
      },
      models: [{
        id: 'doubao-seed-2-0-lite-260428', provider: 'volcengine-ark',
        model: 'Doubao Seed 2.0 Lite', analysisCount: 1, batchCount: 1, userCount: 1,
        settledCredits: 1, refundedCredits: 0, incompleteOperationCount: 1,
        historicalEvidenceOperationCount: 1,
        operationalCallCount: 0, operationalUnpricedCallCount: 0,
        businessEstimatedCostCny: '0.001920', operationalEstimatedCostCny: '0.000000',
        knownAccountCostCny: '0.001920',
        pricingSources: [{
          priceVersion: 'volcengine-list-2026-07-23',
          sourceUrl: 'https://docs.volcengine.com/docs/82379/1544106?lang=zh',
        }],
        knownInputTokens: 1200, knownCachedInputTokens: 200, knownOutputTokens: 300,
        knownCostCny: '0.001920', providerRequestCount: 2,
        reconciledZeroRequestCount: 1, unknownUsageRequestCount: 0, unpricedRequestCount: 0,
        estimateCompleteness: 'partial',
      }],
    });
    expect(legacyMultimodalOverview.summary.historicalPricedOperationCount).toBe(0);
    expect(legacyMultimodalOverview.models[0]?.historicalPricedOperationCount).toBe(0);

    expect(endpointContracts.adminApiUsageMultimodalOverview.response.safeParse({
      asOf: '2026-07-13T06:00:00.000Z',
      selection: emptyCostPage.selection,
      account: {
        provider: 'volcengine-ark', currency: 'CNY', availableBalanceCny: null,
        cashBalanceCny: null, frozenAmountCny: null, arrearsBalanceCny: null,
        creditLimitCny: null, syncedAt: '-', status: 'never-synced',
      },
      summary: {
        analysisCount: 0, batchCount: 0, userCount: 0,
        settledCredits: 0, refundedCredits: 0, incompleteOperationCount: 0,
        historicalEvidenceOperationCount: 0,
        operationalCallCount: 0, operationalUnpricedCallCount: 0,
        businessEstimatedCostCny: '0.000000', operationalEstimatedCostCny: '0.000000',
        knownAccountCostCny: '0.000000',
        knownInputTokens: 0, knownCachedInputTokens: 0, knownOutputTokens: 0,
        knownCostCny: '0.000000', providerRequestCount: 0,
        reconciledZeroRequestCount: 0, unknownUsageRequestCount: 0, unpricedRequestCount: 0,
        estimateCompleteness: 'complete',
      },
      models: [{
        id: 'doubao-seed-2-0-lite-260428', provider: 'volcengine-ark',
        model: 'Doubao Seed 2.0 Lite', analysisCount: 0, batchCount: 0, userCount: 0,
        settledCredits: 0, refundedCredits: 0, incompleteOperationCount: 0,
        historicalEvidenceOperationCount: 0,
        operationalCallCount: 0, operationalUnpricedCallCount: 0,
        businessEstimatedCostCny: '0.000000', operationalEstimatedCostCny: '0.000000',
        knownAccountCostCny: '0.000000',
        pricingSources: [{ priceVersion: 'bad-source', sourceUrl: 'javascript:alert(1)' }],
        knownInputTokens: 0, knownCachedInputTokens: 0, knownOutputTokens: 0,
        knownCostCny: '0.000000', providerRequestCount: 0,
        reconciledZeroRequestCount: 0, unknownUsageRequestCount: 0, unpricedRequestCount: 0,
        estimateCompleteness: 'complete',
      }],
    }).success).toBe(false);

    const reconciledOperation = {
      id: ids.task,
      operationType: 'analysis', runId: ids.task, batchId: null,
      userId: ids.user, userName: '测试用户', email: 'user@example.com',
      provider: 'volcengine-ark', model: 'doubao-seed-2-0-lite-260428',
      status: 'failed', isFree: null, settledCredits: 0, refundedCredits: 0,
      incompleteRequestCount: 0, usageEvidence: 'ledger-reconciled', failureReason: 'ModelNotOpen',
      createdAt: '2026-07-13T03:00:00.000Z', completedAt: '2026-07-13T03:00:01.000Z',
      knownInputTokens: 0, knownCachedInputTokens: 0, knownOutputTokens: 0,
      knownCostCny: '0.000000', providerRequestCount: 1,
      reconciledZeroRequestCount: 1, unknownUsageRequestCount: 0, unpricedRequestCount: 0,
      estimateCompleteness: 'complete',
    };
    const legacyOperationPage = endpointContracts.adminApiUsageMultimodalOperations.response.parse({
      ...emptyCostPage,
      items: [reconciledOperation],
    });
    expect(legacyOperationPage.items[0]).toMatchObject({
      priceVersion: null,
      pricingSourceUrl: null,
    });

    const legacyUserPage = endpointContracts.adminApiUsageMultimodalUsers.response.parse({
      ...emptyCostPage,
      items: [{
        id: ids.user, userId: ids.user, name: '测试用户', email: 'user@example.com',
        models: ['doubao-seed-2-0-lite-260428'], analysisCount: 1, batchCount: 0,
        settledCredits: 0, refundedCredits: 0, incompleteOperationCount: 0,
        historicalEvidenceOperationCount: 0, lastActivityAt: '2026-07-13T03:00:00.000Z',
        operationalCallCount: 0, operationalUnpricedCallCount: 0,
        businessEstimatedCostCny: '0.000000', operationalEstimatedCostCny: '0.000000',
        knownAccountCostCny: '0.000000',
        knownInputTokens: 0, knownCachedInputTokens: 0, knownOutputTokens: 0,
        knownCostCny: '0.000000', providerRequestCount: 1,
        reconciledZeroRequestCount: 1, unknownUsageRequestCount: 0, unpricedRequestCount: 0,
        estimateCompleteness: 'complete',
      }],
    });
    expect(legacyUserPage.items[0]?.historicalPricedOperationCount).toBe(0);
  });

  it('图片成本端点保持独立证据语义，缺证据金额必须为 null', () => {
    expect(endpointContracts.adminApiUsageImageOverview).toMatchObject({
      method: 'GET', path: '/api/admin/api-usage/image/overview', successStatus: 200,
    });
    expect(endpointContracts.adminApiUsageImageTasks.query.parse({
      evidenceStatus: 'missing-evidence', status: 'failed', search: 'x-tt-logid',
    })).toMatchObject({
      evidenceStatus: 'missing-evidence', status: 'failed', position: 'first', limit: 20,
    });
    expect(endpointContracts.adminApiUsageImageOverview.query.safeParse({ range: 'all' }).success).toBe(false);
    expect(endpointContracts.adminApiUsageImageTasks.query.safeParse({ evidenceStatus: 'unknown' }).success).toBe(false);

    const response = {
      asOf: '2026-07-13T06:00:00.000Z',
      selection: {
        range: 'month', month: '2026-07', date: null,
        rangeStart: '2026-07-01', rangeEnd: '2026-07-13',
        timezone: 'Asia/Shanghai', grain: 'day',
      },
      summary: {
        taskCount: 1, userCount: 1, completedTaskCount: 0, failedTaskCount: 1, canceledTaskCount: 0,
        settledCredits: 0, heldCredits: 0, refundedCredits: 14,
        referenceImageCount: 0, outputPixels: 0, knownCostTaskCount: 0,
        missingEvidenceTaskCount: 1, knownCostCny: null,
        operationalCallCount: 0, operationalUnpricedCallCount: 0,
        businessEstimatedCostCny: '0.000000', operationalEstimatedCostCny: '0.000000',
        knownAccountCostCny: '0.000000', estimateCompleteness: 'unavailable',
      },
      pricing: {
        model: 'Seedream 5.0 Pro', modelId: 'doubao-seedream-5-0-pro-260628', currency: 'CNY',
        firstReferenceImageIncluded: 1, additionalReferenceUnitPriceCny: '0.020000',
        outputPixelThreshold: 2_360_000, smallOutputPriceCny: '0.300000', largeOutputPriceCny: '0.600000',
        priceVersion: 'volcengine-seedream-5.0-pro-list-2026-07-27',
        pricingSourceUrl: 'https://docs.volcengine.com/docs/82379/1544106?lang=zh',
        disclaimer: '官网公开列表价估算，不等于实际扣款。',
      },
    };
    expect(endpointContracts.adminApiUsageImageOverview.response.safeParse(response).success).toBe(true);
    expect(endpointContracts.adminApiUsageImageOverview.response.safeParse({
      ...response,
      summary: { ...response.summary, knownCostCny: '0.000000' },
    }).success).toBe(false);
  });
});

function unwrapObjects(schema: z.ZodTypeAny): z.AnyZodObject[] {
  let current = schema;
  while (current instanceof z.ZodEffects || current instanceof z.ZodDefault || current instanceof z.ZodOptional) {
    current = current instanceof z.ZodEffects ? current.innerType() : current._def.innerType;
  }
  if (current instanceof z.ZodObject) return [current];
  if (current instanceof z.ZodDiscriminatedUnion) {
    return current.options.flatMap((option: z.ZodTypeAny) => unwrapObjects(option));
  }
  throw new Error(`契约根节点不是对象或判别联合：${current.constructor.name}`);
}

function unwrapObject(schema: z.ZodTypeAny): z.AnyZodObject {
  const objects = unwrapObjects(schema);
  if (objects.length !== 1) throw new Error(`契约根节点包含 ${objects.length} 个对象分支`);
  return objects[0]!;
}
