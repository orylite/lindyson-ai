import { z } from 'zod';
import type {
  PromptWizardClaimBasisTag,
  PromptWizardConceptPreview,
  PromptWizardCreativeBrief,
  PromptWizardEvidenceGraph,
  PromptWizardPlanV6,
  PromptWizardPlanV5,
  PromptWizardProductProfile,
  PromptWizardUseDirectionPlanContext,
  PromptWizardRoutePlanContextV6,
  PromptWizardVideoConfig,
} from '@lindyson/api-contracts';
import { promptWizardPlanSchema } from '@lindyson/api-contracts';
import { promptWizardShotRoles } from './promptWizardDirectionBlueprint.js';
import { PROMPT_WIZARD_PLAN_COUNT } from './promptWizardPlanCount.js';
import type { PromptWizardStrategy } from './promptWizardStrategy.js';
import type { PromptWizardConceptAssignment } from './promptWizardConceptContext.js';
import {
  assertPromptWizardShotExecutionBudget,
  assertPromptWizardVoiceoverDuration,
  getPromptWizardV6ExecutionBudget,
} from './promptWizardExecutionBudget.js';
import {
  assertPromptWizardConversionCta,
  assertPromptWizardMotionDensity,
  assertPromptWizardSoundDesignOnlyVisualClosure,
  assertPromptWizardVoiceoverCoverage,
} from './promptWizardConversionQuality.js';
import { isPromptWizardObservableAction } from './promptWizardEvidenceGraph.js';

const draftPlanningReviewSchema = z.object({
  targetAudience: z.string().trim().min(1).max(240),
  surfaceNeed: z.string().trim().min(1).max(240),
  realPainPoint: z.string().trim().min(1).max(300),
  nonAdEntry: z.string().trim().min(1).max(300),
  proofPoints: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
  directionFit: z.string().trim().min(1).max(300),
}).strict();

export const promptWizardShotRoleSchema = z.enum([
  'hook',
  'proof',
  'proof-resolution',
  'resolution',
  'cta',
]);

const draftSegmentSchema = z.object({
  role: promptWizardShotRoleSchema,
  location: z.string().trim().min(1).max(180),
  subject: z.string().trim().min(1).max(180),
  shotSize: z.string().trim().min(1).max(80),
  action: z.string().trim().min(1).max(300),
  cameraMovement: z.string().trim().min(1).max(180),
  lightingAndRealism: z.string().trim().min(1).max(220),
  voiceover: z.string().trim().max(300),
  voiceoverZh: z.string().trim().max(300),
  foley: z.string().trim().min(1).max(180),
  editingCue: z.string().trim().min(1).max(180),
  evidenceRefs: z.array(z.string().trim().min(1).max(80)).max(6),
  productionNote: z.string().trim().max(240),
}).strict();

export const promptWizardPlanDraftSchema = z.object({
  name: z.string().trim().min(1).max(80),
  hook: z.string().trim().min(1).max(300),
  narrative: z.string().trim().min(1).max(500),
  primaryScene: z.string().trim().min(1).max(300),
  cameraAndPacing: z.string().trim().min(1).max(500),
  differenceTags: z.array(z.string().trim().min(1).max(40)).min(2).max(6),
  planningReview: draftPlanningReviewSchema,
  segments: z.array(draftSegmentSchema).min(2).max(4),
  productionWarnings: z.array(z.string().trim().min(1).max(240)).max(8),
}).strict();

export const promptWizardPlanDraftBatchSchema = z.object({
  // V4/V5 历史任务返回两案；V6 返回三个固定商业角色。
  plans: z.array(promptWizardPlanDraftSchema).min(PROMPT_WIZARD_PLAN_COUNT).max(3),
}).strict();

export type PromptWizardPlanDraft = z.infer<typeof promptWizardPlanDraftSchema>;

const DIRECTION_LABELS: Record<PromptWizardCreativeBrief['direction'], string> = {
  ugc: '真实 UGC',
  'problem-solution': '场景问题解决',
  'unboxing-review': '开箱测评',
  'feature-test': '功能实测',
  'pain-comparison': '痛点对比',
  lifestyle: '生活方式',
  'cinematic-brand': '电影感品牌片',
  'asmr-detail': 'ASMR 细节展示',
};

const MARKETING_GOAL_LABELS: Record<PromptWizardCreativeBrief['marketingGoal'], string> = {
  conversion: '促进转化',
  consideration: '建立考虑',
  awareness: '提升认知',
};

const SHOT_ROLE_LABELS: Record<z.infer<typeof promptWizardShotRoleSchema>, string> = {
  hook: '开场钩子',
  proof: '产品自证',
  'proof-resolution': '自证与化解',
  resolution: '场景化解',
  cta: '自然行动提示',
};

export const LEGACY_PROMPT_WIZARD_PROHIBITION = '【禁止事项】不得编造价格、折扣、认证、性能数字、竞品结论或用户评价；不得出现首尾帧指令。';
export const PROMPT_WIZARD_SOUND_DESIGN_ONLY_INSTRUCTION = '无对白、无人声、无旁白；仅使用音乐、环境声和真实商品操作拟音。';

export const PROMPT_WIZARD_AUDIO_LANGUAGE_ENGLISH_NAMES = {
  英语: 'English',
  西班牙语: 'Spanish',
  葡萄牙语: 'Portuguese',
  法语: 'French',
  印尼语: 'Indonesian',
  意大利语: 'Italian',
  日语: 'Japanese',
  马来语: 'Malay',
  泰语: 'Thai',
  越南语: 'Vietnamese',
  普通话: 'Mandarin Chinese',
  德语: 'German',
  荷兰语: 'Dutch',
  波兰语: 'Polish',
} as const;

/**
 * Seedance 当前没有独立的口播语言参数，只能从整段执行提示词推断音频语言。
 * V6 的导演说明刻意保留为简体中文，因此在提示词最前方同时使用中英文锁定
 * 唯一可朗读内容，并明确把其余中文隔离为无声制作说明。
 */
export function promptWizardAudioLanguageLock(targetLanguage: string) {
  const normalizedLanguage = targetLanguage.normalize('NFKC').trim();
  const englishLanguage = (
    PROMPT_WIZARD_AUDIO_LANGUAGE_ENGLISH_NAMES as Readonly<Record<string, string>>
  )[normalizedLanguage] ?? normalizedLanguage;
  return [
    `所有人声、旁白和对白仅限${normalizedLanguage}；逐字朗读每段“旁白（${normalizedLanguage}）”后的原文，不得翻译、改写或补充。其余中文是无声制作说明，不得朗读。禁止字幕、标题、文字浮层、对话气泡和虚构 UI；仅保留参考商品原有品牌、型号、Logo 与可见印花。`,
    `AUDIO LANGUAGE LOCK: All spoken audio, narration, and dialogue must be ${englishLanguage} only. Recite only the exact text after each "旁白（${normalizedLanguage}）" label; never translate, paraphrase, or add speech. All other Chinese text is silent production direction and must never be spoken. No subtitles, captions, titles, text overlays, speech bubbles, or fictional UI; preserve only brand, model, logo, and printed text already visible on the reference product.`,
  ].join('\n');
}

const PROMPT_WIZARD_FIXED_LATIN_TOKENS = new Set([
  'ugc',
  'asmr',
  'pov',
  'ai',
  'tiktok',
  'seedance',
  'logo',
  'cta',
  'foley',
  'grwm',
]);

export function promptWizardTimeline(durationSeconds: 5 | 10 | 15) {
  if (durationSeconds === 5) return [[0, 1.2], [1.2, 3.5], [3.5, 5]] as const;
  if (durationSeconds === 10) return [[0, 2], [2, 5], [5, 8], [8, 10]] as const;
  return [[0, 3], [3, 7], [7, 12], [12, 15]] as const;
}

/** V6 新任务的动作密度预算；与 V5 历史队列的四镜头时间轴隔离。 */
export function promptWizardTimelineV6(durationSeconds: 5 | 10 | 15) {
  if (durationSeconds === 5) return [[0, 1.2], [1.2, 5]] as const;
  if (durationSeconds === 10) return [[0, 2], [2, 7], [7, 10]] as const;
  return [[0, 3], [3, 7], [7, 12], [12, 15]] as const;
}

export function promptWizardBeatRoles(durationSeconds: 5 | 10 | 15) {
  return promptWizardShotRoles(durationSeconds);
}

export function promptWizardBeatRolesV6(durationSeconds: 5 | 10 | 15) {
  if (durationSeconds === 5) {
    return ['hook', 'proof-resolution'] as const;
  }
  if (durationSeconds === 10) {
    return ['hook', 'proof-resolution', 'cta'] as const;
  }
  return ['hook', 'proof', 'resolution', 'cta'] as const;
}

export function buildPromptWizardFactCatalog(profile: PromptWizardProductProfile) {
  const profileFacts = [
    ['productName', profile.productName],
    ['category', profile.category],
    ['materials', profile.materials],
    ['structure', profile.structure],
    ['logo', profile.logo],
    ['usage', profile.usage],
  ] as const;
  const catalog = [
    ...profileFacts
      .filter(([, text]) => text && !isPromptWizardFactUncertain(text))
      .map(([key, text]) => ({ id: `profile:${key}`, text })),
    ...profile.visibleFacts
      .map((text, index) => ({ id: `visible:${index + 1}`, text }))
      .filter(item => !isPromptWizardFactUncertain(item.text)),
    ...splitConfirmedClaims(profile.userConfirmedClaims)
      .map((text, index) => ({ id: `confirmed:${index + 1}`, text })),
  ].filter((item): item is { id: string; text: string } => Boolean(
    item
    && item.text.trim()
    && !isPromptWizardFactMetaInstruction(item.text),
  ));

  return catalog;
}

function isPromptWizardFactUncertain(value: string) {
  return /(?:待确认|(?:需|需要)[^，。；\n]{0,16}确认|无法[^，。；\n]{0,16}(?:确认|判断|确定)|无可[^，。；\n]{0,16}(?:确认|判断|确定)|不能[^，。；\n]{0,16}(?:确认|判断|确定)|不确定|可能(?:是|为)?|疑似|推测|尚不明确)/u.test(value);
}

function isPromptWizardFactMetaInstruction(value: string) {
  return /(?:仅(?:使用|依据|引用)用户已确认|只(?:使用|依据|引用)已确认|不(?:要|得|应|可)?(?:使用|写入|编造|添加)[^，。；\n]{0,24}(?:价格|优惠|折扣|认证|性能|功效|数字|评价|竞品)|仅以[^，。；\n]{0,24}(?:事实|图片|参考素材)为准)/u.test(value);
}

export function renderPromptWizardPlan(input: {
  id: string;
  draft: PromptWizardPlanDraft;
  strategy: PromptWizardStrategy;
  /** 3.0 扩写必须绑定已选创意路线与权威证据图谱。 */
  conceptAssignment: PromptWizardConceptAssignment;
  conceptPreview: PromptWizardConceptPreview;
  evidenceGraph: PromptWizardEvidenceGraph;
  profile: PromptWizardProductProfile;
  brief: PromptWizardCreativeBrief;
  config: PromptWizardVideoConfig;
  imageCount: number;
}) {
  const timeline = promptWizardTimeline(input.config.durationSeconds);
  const expectedRoles = promptWizardBeatRoles(input.config.durationSeconds);
  if (input.draft.segments.length !== timeline.length) {
    throw promptError(
      `方案镜头数量应为 ${timeline.length}，实际为 ${input.draft.segments.length}`,
      'PROMPT_WIZARD_TIMELINE_INVALID',
      { fieldPaths: ['segments'] },
    );
  }

  assertPromptWizardTranslations(input.draft, input.brief.targetLanguage);
  assertPromptWizardBeatRoles(input.draft, expectedRoles);
  assertPromptWizardEvidence(input.draft, input.profile, input.evidenceGraph);
  assertPromptWizardShotExecutionBudget({
    shots: input.draft.segments,
    config: input.config,
  });
  input.draft.segments.forEach((segment, index) => {
    const [startSeconds, endSeconds] = timeline[index]!;
    assertPromptWizardVoiceoverDuration({
      voiceover: segment.voiceover,
      targetLanguage: input.brief.targetLanguage,
      durationSeconds: endSeconds - startSeconds,
      fieldPath: `segments[${index}].voiceover`,
    });
  });

  const draftLeaves = promptWizardStringLeaves(input.draft);
  const draftText = draftLeaves.map(({ value }) => value).join('\n');
  assertPromptWizardNoFirstLastSemantics(draftLeaves);
  assertImageReferences(draftLeaves, input.imageCount);
  assertNoUnconfirmedCommercialClaims(draftLeaves, input.profile.userConfirmedClaims);
  assertNoUnsupportedRiskClaims(draftLeaves);
  assertPromptWizardContentLanguage(input.draft, input.profile);

  const segmentBlocks = timeline.map(([start, end], index) => {
    const segment = input.draft.segments[index]!;
    const referencePrefix = index === 0 && !/@图片\d+/.test(draftText)
      ? '产品外观严格参考 @图片1。'
      : '';
    const visual = `${referencePrefix}${composePromptWizardVisual(segment)}`;
    const lines = [
      `【${formatSecond(start)}-${formatSecond(end)}s｜${SHOT_ROLE_LABELS[segment.role]}】`,
      `画面：${visual}`,
      `镜头与剪辑：${segment.editingCue}`,
      `声音：${segment.foley}`,
    ];
    if (segment.voiceover) lines.push(`旁白（${input.brief.targetLanguage}）：${segment.voiceover}`);
    return lines.join('\n');
  });

  const constraintBlock = buildPromptWizardConstraintBlock(input.profile, input.imageCount);
  const constraintBlockWithoutConfirmedClaims = buildPromptWizardConstraintBlock(
    input.profile,
    input.imageCount,
    false,
  );
  const prompt = [
    `【创作方向】${DIRECTION_LABELS[input.brief.direction]}｜${MARKETING_GOAL_LABELS[input.brief.marketingGoal]}`,
    ...segmentBlocks,
    '【产品一致性硬约束】',
    constraintBlock,
  ].join('\n\n');

  // 最终生产稿是权威交付内容。再次校验确定性渲染后新增的策略和一致性文本，
  // 但不扫描用户确认字段本身；该字段只作为其余内容的精确白名单。
  const promptWithoutConfirmedClaims = [
    `【创作方向】${DIRECTION_LABELS[input.brief.direction]}｜${MARKETING_GOAL_LABELS[input.brief.marketingGoal]}`,
    ...segmentBlocks,
    '【产品一致性硬约束】',
    constraintBlockWithoutConfirmedClaims,
  ].join('\n\n');

  const finalPromptLeaf = [{ fieldPath: 'prompt', value: prompt }];
  assertImageReferences(finalPromptLeaf, input.imageCount);
  assertPromptWizardNoFirstLastSemantics(finalPromptLeaf);
  assertNoUnsupportedRiskClaims(finalPromptLeaf);
  assertNoUnconfirmedCommercialClaims(
    [{ fieldPath: 'prompt', value: promptWithoutConfirmedClaims }],
    input.profile.userConfirmedClaims,
  );
  if (prompt.length > 3_800) {
    throw promptError(
      `最终提示词长度 ${prompt.length} 超过 3800 字符`,
      'PROMPT_WIZARD_PROMPT_TOO_LONG',
      {
        // 新数据在保存产品档案时已限制一致性块为 1600 字符；超过该边界说明
        // 历史产品档案本身已经无法通过修改 Draft 修复，必须终态失败。
        fieldPaths: constraintBlock.length > 1_600 ? ['prompt'] : ['segments'],
      },
    );
  }

  const planBase = {
    id: input.id,
    name: input.draft.name,
    hook: input.draft.hook,
    narrative: input.draft.narrative,
    primaryScene: input.draft.primaryScene,
    cameraAndPacing: input.draft.cameraAndPacing,
    differenceTags: input.draft.differenceTags,
    strategy: input.strategy,
    prompt,
    planningReview: input.draft.planningReview,
    shots: timeline.map(([startSeconds, endSeconds], index) => ({
      startSeconds,
      endSeconds,
      ...input.draft.segments[index]!,
    })),
    productionWarnings: input.draft.productionWarnings,
  };
  return promptWizardPlanSchema.parse({
    ...planBase,
    deliveryVersion: 4,
    concept: {
      id: input.conceptPreview.id,
      role: input.conceptPreview.role,
      summary: input.conceptPreview.viewerQuestion,
      firstSecondEvent: input.conceptPreview.firstSecondEvent,
      purchaseReason: input.conceptPreview.purchaseReason,
      evidenceIds: input.conceptPreview.evidenceIds,
      requiredAssets: input.conceptPreview.requiredAssets,
      difficulty: input.conceptPreview.difficulty,
      risk: input.conceptPreview.risk,
    },
  });
}

/**
 * 简化版 3.0 的确定性编译器。方向、场景和购买理由已经在规划阶段锁定；
 * 扩写模型只负责把同一证据链写成“易落地 / 强钩子”两种可执行分镜。
 */
export function renderPromptWizardUseDirectionPlan(input: {
  id: string;
  draft: PromptWizardPlanDraft;
  planContext: PromptWizardUseDirectionPlanContext;
  evidenceGraph: PromptWizardEvidenceGraph;
  profile: PromptWizardProductProfile;
  targetLanguage?: string;
  confirmedOffer?: string;
  config: PromptWizardVideoConfig;
  imageCount: number;
  /** 仅供 V6 内部适配层使用；V5 缺省继续按历史四镜头时间轴编译。 */
  timelineVersion?: 5 | 6;
}): PromptWizardPlanV5 {
  const soundDesignOnly = input.timelineVersion === 6
    && input.config.durationSeconds === 5;
  const targetLanguage = input.targetLanguage?.normalize('NFKC').trim() ?? '';
  if (!soundDesignOnly && !targetLanguage) {
    throw promptError(
      '10/15 秒方案必须提供目标口播语言',
      'PROMPT_WIZARD_TARGET_LANGUAGE_REQUIRED',
      { fieldPaths: ['targetLanguage'] },
    );
  }
  const timeline = input.timelineVersion === 6
    ? promptWizardTimelineV6(input.config.durationSeconds)
    : promptWizardTimeline(input.config.durationSeconds);
  const expectedRoles = input.timelineVersion === 6
    ? promptWizardBeatRolesV6(input.config.durationSeconds)
    : promptWizardBeatRoles(input.config.durationSeconds);
  if (input.draft.segments.length !== timeline.length) {
    throw promptError(
      `方案镜头数量应为 ${timeline.length}，实际为 ${input.draft.segments.length}`,
      'PROMPT_WIZARD_TIMELINE_INVALID',
      { fieldPaths: ['segments'] },
    );
  }

  if (soundDesignOnly) {
    assertPromptWizardSoundDesignOnlyVisualClosure({ shots: input.draft.segments });
  } else {
    assertPromptWizardTranslations(input.draft, targetLanguage);
  }
  assertPromptWizardBeatRoles(input.draft, expectedRoles);
  assertPromptWizardEvidence(input.draft, input.profile, input.evidenceGraph);
  assertPromptWizardUseDirectionDraftBoundary(
    input.draft,
    input.planContext,
    input.evidenceGraph,
  );
  assertPromptWizardShotExecutionBudget({
    shots: input.draft.segments,
    config: input.config,
    ...(input.timelineVersion === 6 ? { deliveryVersion: 6 as const } : {}),
  });
  const timedShots = timeline.map(([startSeconds, endSeconds], index) => ({
    startSeconds,
    endSeconds,
    ...input.draft.segments[index]!,
  }));
  assertPromptWizardMotionDensity({
    shots: input.draft.segments,
    durationSeconds: input.config.durationSeconds,
  });
  if (!soundDesignOnly) {
    assertPromptWizardVoiceoverCoverage({
      shots: timedShots,
      targetLanguage,
      durationSeconds: input.config.durationSeconds,
      profile: input.profile,
      v6SemanticOnly: input.timelineVersion === 6,
    });
    assertPromptWizardConversionCta({
      shots: input.draft.segments,
      targetLanguage,
    });
    assertPromptWizardConfirmedOfferPlacement(input.draft, input.confirmedOffer ?? '');
  }

  const draftLeaves = promptWizardStringLeaves(input.draft);
  const draftText = draftLeaves.map(({ value }) => value).join('\n');
  assertPromptWizardNoFirstLastSemantics(draftLeaves);
  assertImageReferences(draftLeaves, input.imageCount);
  assertNoUnconfirmedCommercialClaims(draftLeaves, input.profile.userConfirmedClaims);
  assertNoUnsupportedRiskClaims(draftLeaves);
  assertPromptWizardContentLanguage(input.draft, input.profile);

  const segmentBlocks = timeline.map(([start, end], index) => {
    const segment = input.draft.segments[index]!;
    const referencePrefix = index === 0 && !/@图片\d+/.test(draftText)
      ? '产品外观严格参考 @图片1。'
      : '';
    const lines = [
      `【${formatSecond(start)}-${formatSecond(end)}s｜${SHOT_ROLE_LABELS[segment.role]}】`,
      `画面：${referencePrefix}${composePromptWizardVisual(segment)}`,
      `镜头与剪辑：${segment.editingCue}`,
      `声音：${segment.foley}`,
    ];
    if (!soundDesignOnly && segment.voiceover) {
      lines.push(`旁白（${targetLanguage}）：${segment.voiceover}`);
    }
    return lines.join('\n');
  });
  const constraintProfile = omitPromptWizardConfirmedOffer(
    input.profile,
    input.confirmedOffer ?? '',
  );
  const constraintBlock = buildPromptWizardConstraintBlock(constraintProfile, input.imageCount);
  const constraintBlockWithoutConfirmedClaims = buildPromptWizardConstraintBlock(
    constraintProfile,
    input.imageCount,
    false,
  );
  const promptHeader = `【使用方向】${input.planContext.useDirection.title}｜${input.planContext.selectedScene.title}`;
  const audioLanguageConstraint = input.timelineVersion === 6 && !soundDesignOnly
    ? ['【音频语言硬约束 / AUDIO LANGUAGE LOCK】', promptWizardAudioLanguageLock(targetLanguage)]
    : [];
  const prompt = [
    ...audioLanguageConstraint,
    promptHeader,
    ...segmentBlocks,
    ...(soundDesignOnly ? [
      '【声音硬约束】',
      PROMPT_WIZARD_SOUND_DESIGN_ONLY_INSTRUCTION,
    ] : []),
    '【产品一致性硬约束】',
    constraintBlock,
  ].join('\n\n');
  const promptWithoutConfirmedClaims = [
    ...audioLanguageConstraint,
    promptHeader,
    ...segmentBlocks,
    ...(soundDesignOnly ? [
      '【声音硬约束】',
      PROMPT_WIZARD_SOUND_DESIGN_ONLY_INSTRUCTION,
    ] : []),
    '【产品一致性硬约束】',
    constraintBlockWithoutConfirmedClaims,
  ].join('\n\n');
  const finalPromptLeaf = [{ fieldPath: 'prompt', value: prompt }];
  assertImageReferences(finalPromptLeaf, input.imageCount);
  assertPromptWizardNoFirstLastSemantics(finalPromptLeaf);
  assertNoUnsupportedRiskClaims(finalPromptLeaf);
  assertNoUnconfirmedCommercialClaims(
    [{ fieldPath: 'prompt', value: promptWithoutConfirmedClaims }],
    input.profile.userConfirmedClaims,
  );
  if (prompt.length > 3_800) {
    throw promptError(
      `最终提示词长度 ${prompt.length} 超过 3800 字符`,
      'PROMPT_WIZARD_PROMPT_TOO_LONG',
      { fieldPaths: constraintBlock.length > 1_600 ? ['prompt'] : ['segments'] },
    );
  }

  const plan = {
    id: input.id,
    deliveryVersion: 5,
    variant: input.planContext.variant,
    useDirection: input.planContext.useDirection,
    selectedScene: input.planContext.selectedScene,
    name: input.draft.name,
    hook: input.draft.hook,
    narrative: input.draft.narrative,
    primaryScene: input.draft.primaryScene,
    cameraAndPacing: input.draft.cameraAndPacing,
    differenceTags: input.draft.differenceTags,
    prompt,
    shots: timeline.map(([startSeconds, endSeconds], index) => ({
      startSeconds,
      endSeconds,
      ...input.draft.segments[index]!,
    })),
    productionWarnings: input.draft.productionWarnings,
  };
  // 5 秒 V6 只有两个镜头，无法通过仅为历史读取保留的 V5 三镜头 Schema；
  // 外层 renderPromptWizardRoutePlanV6 会立即按 V6 Schema 完整解析。
  return soundDesignOnly
    ? plan as PromptWizardPlanV5
    : promptWizardPlanSchema.parse(plan) as PromptWizardPlanV5;
}

/**
 * V6 编译器沿用成熟的证据、时长、口播与安全门禁，但交付结构改为三个
 * 固定商业角色。中文译文仅保留在 shots，绝不进入执行 prompt。
 */
export function renderPromptWizardRoutePlanV6(input: {
  id: string;
  draft: PromptWizardPlanDraft;
  planContext: PromptWizardRoutePlanContextV6;
  evidenceGraph: PromptWizardEvidenceGraph;
  profile: PromptWizardProductProfile;
  targetLanguage?: string;
  verifiedOffer?: string;
  config: PromptWizardVideoConfig;
  imageCount: number;
}): PromptWizardPlanV6 {
  const soundDesignOnly = input.config.durationSeconds === 5;
  const route = input.planContext.route;
  const legacyContext = {
    planIndex: Math.min(1, input.planContext.planIndex) as 0 | 1,
    variant: route.role === 'problem-hook' ? 'hook' as const : 'reliable' as const,
    useDirection: {
      id: route.id,
      title: route.titleZh,
      useMoment: route.recommendedScene.title,
      audienceNeed: route.audienceZh,
      purchaseReason: route.purchaseReasonZh,
      proofAction: route.proofActionZh,
      evidenceIds: route.evidenceRefs,
      appearanceMode: route.appearanceMode,
      internalDirection: route.role === 'problem-hook'
        ? 'problem-solution' as const
        : route.role === 'lifestyle-seeding' ? 'ugc' as const : 'feature-test' as const,
      requiredAssets: route.requiredAssets,
    },
    selectedScene: route.recommendedScene,
  } satisfies PromptWizardUseDirectionPlanContext;
  const compiled = renderPromptWizardUseDirectionPlan({
    id: input.id,
    draft: input.draft,
    planContext: legacyContext,
    evidenceGraph: input.evidenceGraph,
    profile: input.profile,
    ...(!soundDesignOnly ? { targetLanguage: input.targetLanguage } : {}),
    confirmedOffer: input.verifiedOffer ?? '',
    config: input.config,
    imageCount: input.imageCount,
    timelineVersion: 6,
  });
  const prompt = compiled.prompt.replace(
    /^【使用方向】[^\n]+/mu,
    promptWizardRoutePromptHeader(route),
  );
  assertPromptWizardExecutionPromptIsolation({
    prompt,
    ...(!soundDesignOnly ? { targetLanguage: input.targetLanguage } : {}),
    shots: compiled.shots,
  });
  return promptWizardPlanSchema.parse({
    id: input.id,
    deliveryVersion: 6,
    audioMode: soundDesignOnly ? 'sound-design-only' : 'voiceover',
    role: route.role,
    directionExplanationZh: route.directionExplanationZh,
    audienceZh: route.audienceZh,
    purchaseReasonZh: route.purchaseReasonZh,
    hookZh: route.hookZh,
    claimBasisTags: soundDesignOnly
      ? route.claimBasisTags
      : promptWizardRouteClaimBasisTags({
          route,
          evidenceGraph: input.evidenceGraph,
          verifiedOffer: input.verifiedOffer ?? '',
        }),
    selectedScene: route.recommendedScene,
    name: input.draft.name,
    narrative: input.draft.narrative,
    primaryScene: input.draft.primaryScene,
    cameraAndPacing: input.draft.cameraAndPacing,
    differenceTags: input.draft.differenceTags,
    prompt,
    shots: compiled.shots,
    productionWarnings: compiled.productionWarnings,
  }) as PromptWizardPlanV6;
}

const PROMPT_WIZARD_TRANSLATION_BLOCK_MARKER = /(?:\bvoiceoverZh\b|【\s*(?:中文口播翻译|中文口播译文|口播中文翻译|对应中文译文|简体中文译文)\s*】|(?:中文口播翻译|中文口播译文|口播中文翻译|对应中文译文|简体中文译文)\s*[:：])/iu;

/**
 * 执行提示词的隔离边界按“字段来源与输出结构”校验，而不是要求中文文本
 * 彼此不相交。镜头动作、CTA 与短译文可能合法出现相同字面内容；这种碰撞
 * 不代表 voiceoverZh 被写入提示词。真正的硬边界是：提示词不得出现译文字段
 * 或译文区块，且每一条旁白行必须逐条等于所选语言的 voiceover 原文。
 */
export function assertPromptWizardExecutionPromptIsolation(input: {
  prompt: string;
  targetLanguage?: string;
  shots: readonly Pick<PromptWizardPlanDraft['segments'][number], 'voiceover' | 'voiceoverZh'>[];
}) {
  const fail = () => {
    throw promptError(
      '执行提示词口播结构无效或包含中文口播译文区块',
      'PROMPT_WIZARD_TRANSLATION_LEAK',
      { fieldPaths: ['prompt'] },
    );
  };
  if (PROMPT_WIZARD_TRANSLATION_BLOCK_MARKER.test(input.prompt)) fail();

  const actualVoiceoverLines = input.prompt
    .split(/\r\n?|\n/u)
    .map(line => line.trim())
    .filter(line => /^旁白（[^）]+）：/u.test(line));
  const expectedVoiceoverLines = input.shots
    .map(shot => shot.voiceover.trim())
    .filter(Boolean)
    .map(voiceover => `旁白（${input.targetLanguage ?? ''}）：${voiceover}`);
  if (!input.targetLanguage && (
    actualVoiceoverLines.length > 0
    || expectedVoiceoverLines.length > 0
    || input.shots.some(shot => shot.voiceoverZh.trim())
  )) fail();
  if (
    actualVoiceoverLines.length !== expectedVoiceoverLines.length
    || actualVoiceoverLines.some((line, index) => line !== expectedVoiceoverLines[index])
  ) fail();
}

/** 执行提示词只携带面向创作的动态标题，不泄露内部机器角色枚举。 */
export function promptWizardRoutePromptHeader(
  route: Pick<PromptWizardRoutePlanContextV6['route'], 'titleZh'>,
) {
  return `【商业路线】${route.titleZh}`;
}

/**
 * 路线在用户选择参数前已经预生成，因此当时还不存在“真实优惠信息”。
 * 批次编译时把本次已确认优惠追加为用户确认事实，使卡片展示与实际进入
 * 口播/执行提示词的商业信息拥有同一证据引用；空优惠不产生占位标签。
 */
export function promptWizardRouteClaimBasisTags(input: {
  route: PromptWizardRoutePlanContextV6['route'];
  evidenceGraph: PromptWizardEvidenceGraph;
  verifiedOffer: string;
}): PromptWizardClaimBasisTag[] {
  const verifiedOffer = input.verifiedOffer.normalize('NFKC').trim();
  if (!verifiedOffer) return input.route.claimBasisTags;
  const evidence = input.evidenceGraph.evidences.find(candidate => (
    candidate.status === 'user-confirmed'
    && candidate.text.normalize('NFKC').trim() === verifiedOffer
  ));
  if (!evidence || !input.evidenceGraph.reliableEvidenceIds.includes(evidence.id)) {
    throw promptError(
      '真实优惠信息缺少用户确认的证据引用',
      'PROMPT_WIZARD_EVIDENCE_UNAVAILABLE',
      { fieldPaths: ['verifiedOffer'] },
    );
  }
  return [
    ...input.route.claimBasisTags,
    {
      labelZh: verifiedOffer,
      basis: 'user-confirmed',
      evidenceRefs: [evidence.id],
    },
  ];
}

export function omitPromptWizardConfirmedOffer(
  profile: PromptWizardProductProfile,
  confirmedOffer: string,
): PromptWizardProductProfile {
  const normalizedOfferLines = confirmedOffer
    .normalize('NFKC')
    .trim()
    .split(/\r\n?|\n/u)
    .map(line => line.trim());
  if (normalizedOfferLines.length === 1 && !normalizedOfferLines[0]) return profile;
  const claimLines = profile.userConfirmedClaims.split(/\r\n?|\n/u);
  const normalizedClaimLines = claimLines.map(line => line.normalize('NFKC').trim());
  const retainedLines: string[] = [];
  for (let index = 0; index < claimLines.length;) {
    const matchesOfferBlock = normalizedOfferLines.every((line, offset) => (
      normalizedClaimLines[index + offset] === line
    ));
    if (matchesOfferBlock) {
      index += normalizedOfferLines.length;
      continue;
    }
    retainedLines.push(claimLines[index]!);
    index += 1;
  }
  return {
    ...profile,
    userConfirmedClaims: retainedLines.join('\n').trim(),
  };
}

function assertPromptWizardConfirmedOfferPlacement(
  draft: PromptWizardPlanDraft,
  confirmedOffer: string,
) {
  const offer = confirmedOffer.normalize('NFKC').trim();
  if (!offer) return;
  const markers = [
    ...offer.match(/(?:[$¥￥€£]\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:%|折|元|美元|人民币|欧元|英镑))/gu) ?? [],
    ...offer.match(/(?:优惠券|优惠|折扣|满减|售价|价格|赠品|赠送|包邮|买一送一|coupon|discount|free shipping|current price|sale price|gift)/giu) ?? [],
  ].map(marker => marker.replace(/\s+/gu, '').toLowerCase());
  if (markers.length === 0) return;
  const hitIndexes = draft.segments.flatMap((segment, index) => {
    const text = `${segment.voiceover}\n${segment.voiceoverZh}`
      .normalize('NFKC')
      .replace(/\s+/gu, '')
      .toLowerCase();
    return markers.some(marker => text.includes(marker)) ? [index] : [];
  });
  const uniqueIndexes = [...new Set(hitIndexes)];
  const lastIndex = draft.segments.length - 1;
  if (uniqueIndexes.length <= 1 && (uniqueIndexes.length === 0 || uniqueIndexes[0] === lastIndex)) return;
  throw promptError(
    '本次真实促销信息只能保持原意使用一次，并应放在末段口播。',
    'PROMPT_WIZARD_UNCONFIRMED_CLAIM',
    { fieldPaths: uniqueIndexes.flatMap(index => [
      `segments[${index}].voiceover`,
      `segments[${index}].voiceoverZh`,
    ]) },
  );
}

export interface PromptWizardFirstShotStabilization {
  draft: PromptWizardPlanDraft;
  reasons: ('observable-action' | 'product-anchor')[];
}

/**
 * V5 的使用方向和场景已经通过可执行动作门禁。模型扩写偶尔会把首镜
 * 写成纯镜头描述，或遗漏明确的产品锚点。这里只用已验证的所选场景动作和
 * 当前参考图做确定性收口，不新增事实、卖点、场景或人物。
 */
export function stabilizePromptWizardUseDirectionFirstShot(input: {
  draft: PromptWizardPlanDraft;
  context: PromptWizardUseDirectionPlanContext;
  evidenceGraph: PromptWizardEvidenceGraph;
}): PromptWizardFirstShotStabilization {
  const first = input.draft.segments[0];
  if (!first) return { draft: input.draft, reasons: [] };

  const reasons: PromptWizardFirstShotStabilization['reasons'] = [];
  let action = first.action;
  if (!isPromptWizardObservableAction(action)) {
    const selectedMainAction = input.context.selectedScene.mainAction.trim();
    const boundedMainAction = selectedMainAction.length <= 300
      ? selectedMainAction
      : fitPromptWizardDraftAction(selectedMainAction);
    action = isPromptWizardObservableAction(boundedMainAction)
      ? boundedMainAction
      : fitPromptWizardDraftAction(`手部操作产品并动态呈现${boundedMainAction}`);
    reasons.push('observable-action');
  }
  const candidateFirst = { ...first, action };
  if (!promptWizardFirstShotHasProductAnchor(
    candidateFirst,
    input.context,
    input.evidenceGraph,
  )) {
    reasons.push('product-anchor');
  }
  if (reasons.length === 0) return { draft: input.draft, reasons };

  const subject = reasons.includes('product-anchor')
    ? truncatePromptWizardUtf16(`@图片1中的产品，${first.subject}`, 180)
    : first.subject;
  return {
    draft: {
      ...input.draft,
      segments: input.draft.segments.map((segment, index) => index === 0
        ? { ...segment, subject, action }
        : segment),
    },
    reasons,
  };
}

/**
 * V5 的使用方向已给出经过验证的场景主动作和产品自证动作。模型扩写可能在
 * 各镜头继续增加拿取、翻转或放置等动作，使真实执行计划超出视频模型预算。
 * 这里按镜头职责确定性收口：开场只执行场景主动作，自证镜头只执行自证
 * 动作，化解镜头只观察自证完成后的证据结果；CTA 保持原样，不改写用户可见
 * 的收束表达，也不新增产品事实。
 */
export function stabilizePromptWizardUseDirectionMajorActions(input: {
  draft: PromptWizardPlanDraft;
  context: PromptWizardUseDirectionPlanContext;
  maxActionFamilies?: number;
}): PromptWizardPlanDraft {
  const maxActionFamilies = input.maxActionFamilies ?? Number.POSITIVE_INFINITY;
  const lockedAction = maxActionFamilies <= 1
    ? promptWizardSingleFamilyAction(input.context.useDirection.proofAction)
    : null;
  const mainAction = fitPromptWizardDraftAction(
    lockedAction ?? (maxActionFamilies <= 2
      ? promptWizardSingleFamilyAction(input.context.selectedScene.mainAction)
      : input.context.selectedScene.mainAction),
  );
  const proofAction = fitPromptWizardDraftAction(
    lockedAction ?? (maxActionFamilies <= 2
      ? promptWizardSingleFamilyAction(input.context.useDirection.proofAction)
      : input.context.useDirection.proofAction),
  );
  const resolutionAction = '产品保持自证动作完成后的真实状态，镜头只观察证据结果。';
  let changed = false;
  const segments = input.draft.segments.map((segment) => {
    const action = segment.role === 'hook'
      ? mainAction
      : segment.role === 'proof' || segment.role === 'proof-resolution'
        ? proofAction
        : segment.role === 'resolution'
          ? resolutionAction
          : segment.action;
    if (action === segment.action) return segment;
    changed = true;
    return { ...segment, action };
  });
  return changed ? { ...input.draft, segments } : input.draft;
}

/**
 * V6 路线、场景、证据和执行预算都已由服务端确定。Provider 只负责创意
 * 文案与口播，不应因为把这些结构字段抄错而再次消耗内容修复调用。这里在
 * 每次 Provider 返回后统一收口服务端拥有的字段，并继续交给完整编译门禁。
 *
 * 此函数会把 proofPoints、evidenceRefs、场景、镜头角色和主要动作再次收口为
 * 服务端路线与可靠证据。Wire V2 的名称、叙事摘要、节奏摘要、差异标签、
 * planningReview、生产警告和 productionNote 已在 Provider 展开/合并边界锁定，
 * 这里不重复生成；hook、六个创意镜头字段与口播继续接受完整领域门禁。镜头
 * 数量不符时也不增删，避免静默丢失内容或用固定模板掩盖动态密度问题。
 */
export function normalizePromptWizardRouteDraftV6(input: {
  draft: PromptWizardPlanDraft;
  planContext: PromptWizardRoutePlanContextV6;
  evidenceGraph: PromptWizardEvidenceGraph;
  profile: PromptWizardProductProfile;
  config: PromptWizardVideoConfig;
}): PromptWizardPlanDraft {
  const primaryImageReferencePattern = /@图片1(?!\d)/gu;
  const hasPrimaryImageReference = (value: string) => /@图片1(?!\d)/u.test(value);
  const deduplicatePrimaryImageReferences = (value: string) => {
    let retained = false;
    return value.replace(primaryImageReferencePattern, () => {
      if (!retained) {
        retained = true;
        return '@图片1';
      }
      return '该商品';
    });
  };
  const route = input.planContext.route;
  const expectedRoles = promptWizardBeatRolesV6(input.config.durationSeconds);
  const hasExpectedSegmentCount = input.draft.segments.length === expectedRoles.length;
  const soundDesignOnly = input.config.durationSeconds === 5;
  const reliableEvidenceIds = new Set(input.evidenceGraph.reliableEvidenceIds);
  const routeEvidence = route.evidenceRefs.map(id => (
    input.evidenceGraph.evidences.find(evidence => (
      evidence.id === id
      && reliableEvidenceIds.has(id)
      && (evidence.status === 'visible' || evidence.status === 'user-confirmed')
    )) ?? null
  ));
  const hasCompleteRouteEvidence = routeEvidence.length > 0
    && routeEvidence.length <= 6
    && routeEvidence.every((evidence): evidence is NonNullable<typeof evidence> => (
      evidence !== null
      && evidence.id.length <= 80
      && evidence.text.length <= 300
    ));
  const legacyContext = {
    planIndex: Math.min(1, input.planContext.planIndex) as 0 | 1,
    variant: route.role === 'problem-hook' ? 'hook' as const : 'reliable' as const,
    useDirection: {
      id: route.id,
      title: route.titleZh,
      useMoment: route.recommendedScene.title,
      audienceNeed: route.audienceZh,
      purchaseReason: route.purchaseReasonZh,
      proofAction: route.proofActionZh,
      evidenceIds: route.evidenceRefs,
      appearanceMode: route.appearanceMode,
      internalDirection: route.role === 'problem-hook'
        ? 'problem-solution' as const
        : route.role === 'lifestyle-seeding' ? 'ugc' as const : 'feature-test' as const,
      requiredAssets: route.requiredAssets,
    },
    selectedScene: route.recommendedScene,
  } satisfies PromptWizardUseDirectionPlanContext;
  const routeEnvironment = truncatePromptWizardUtf16(
    route.recommendedScene.environment,
    180,
  );
  const productNameWithoutImageMarkup = input.profile.productName
    .replace(primaryImageReferencePattern, '')
    .trim() || '商品';
  const specificProductAnchor = `@图片1中的${productNameWithoutImageMarkup}`;
  // 商品名过长时使用中性引用，避免把名称截断成另一个不完整商品名。
  const productAnchor = specificProductAnchor.length <= 80
    ? specificProductAnchor
    : '@图片1中的商品';
  const subjectWithProductAnchor = (subject: string) => {
    const deduplicatedSubject = deduplicatePrimaryImageReferences(subject);
    if (hasPrimaryImageReference(deduplicatedSubject)) return deduplicatedSubject;
    const remainingLength = Math.max(1, 180 - productAnchor.length - 1);
    const boundedSubject = truncatePromptWizardUtf16(
      deduplicatedSubject,
      remainingLength,
    );
    return `${productAnchor}，${boundedSubject}`;
  };
  const structuredDraft: PromptWizardPlanDraft = {
    ...input.draft,
    primaryScene: `${route.recommendedScene.title}｜${routeEnvironment}`,
    planningReview: {
      ...input.draft.planningReview,
      ...(hasCompleteRouteEvidence ? {
        proofPoints: routeEvidence.map(evidence => evidence.text),
      } : {}),
    },
    segments: input.draft.segments.map((segment, segmentIndex) => ({
      ...segment,
      ...(hasExpectedSegmentCount ? { role: expectedRoles[segmentIndex]! } : {}),
      location: routeEnvironment,
      ...(segmentIndex === 0 || (soundDesignOnly && segmentIndex === input.draft.segments.length - 1)
        ? {
            subject: soundDesignOnly && segmentIndex === input.draft.segments.length - 1
              ? truncatePromptWizardUtf16(
                  `清晰可见的${subjectWithProductAnchor(segment.subject)}`,
                  180,
                )
              : subjectWithProductAnchor(segment.subject),
          }
        : {}),
      ...(hasCompleteRouteEvidence ? { evidenceRefs: [...route.evidenceRefs] } : {}),
    })),
  };
  const actionNormalized = hasExpectedSegmentCount
    ? stabilizePromptWizardUseDirectionMajorActions({
        draft: structuredDraft,
        context: legacyContext,
        maxActionFamilies: getPromptWizardV6ExecutionBudget(input.config).maxMajorActionCount,
      })
    : structuredDraft;
  return stabilizePromptWizardUseDirectionFirstShot({
    draft: actionNormalized,
    context: legacyContext,
    evidenceGraph: input.evidenceGraph,
  }).draft;
}

interface PromptWizardActionOccurrence {
  index: number;
  end: number;
  label: string;
}

const PROMPT_WIZARD_ACTION_OCCURRENCES: ReadonlyArray<readonly [RegExp, string]> = [
  [/拿起|取出|抽出|拾起|取用/gu, '取用'],
  [/放下|放入|装入|收进|归位/gu, '放置收纳'],
  [/打开|开启|揭开|掀开|拉开|撕开/gu, '打开'],
  [/关闭|合上|扣合|封口/gu, '关闭'],
  [/按压|按下|触按|点击|压入|压下/gu, '按压'],
  [/旋转|拧动|转动/gu, '旋转'],
  [/折叠|折起/gu, '折叠'],
  [/展开|摊开|铺开/gu, '展开'],
  [/穿上|套上|佩戴|戴上|套头/gu, '穿戴'],
  [/脱下|摘下|取下/gu, '取下'],
  [/倒入|倾倒|注入/gu, '倾倒'],
  [/喷洒|喷出|喷在|喷涂/gu, '喷洒'],
  [/涂抹|擦拭|清洁|刷洗/gu, '涂抹清洁'],
  [/连接|插入|接入|配对/gu, '连接'],
  [/启动|开机|点亮|通电/gu, '启动'],
  [/翻转|转身|翻面/gu, '翻转'],
  [/挤出|挤压/gu, '挤压'],
  [/移动|推入|拉出|滑动/gu, '移动'],
];

const PROMPT_WIZARD_GENERIC_SETUP_ACTIONS = new Set([
  '取用',
  '放置收纳',
  '取下',
]);

/**
 * Mini 5 秒在两轮模型修复后仍可能把正确使用流程完整抄进每个镜头，例如
 * “取下保护盖并按压泵头取用乳液”。这不是新的产品事实，但会让一个 5 秒
 * 镜头承担三类动作。最终安全收口只保留流程中第一个非准备型核心动作，
 * 并保留动作对象；不把多动作原文藏入引号或制作备注，从而保证交付给
 * Seedance 的生产稿也真正只有一个动作族。
 */
export function promptWizardSingleFamilyAction(value: string) {
  const normalized = normalizePromptWizardClause(value)
    .replace(/^(?:完整展示正确使用动作|用连续动作和真实操作声展示|近景操作或环绕展示结构|自然光近景配合触碰或弯折展示材质)\s*[：:]\s*/u, '')
    .trim();
  const occurrences = promptWizardActionOccurrences(normalized);
  const finalize = (action: string) => {
    const fitted = fitPromptWizardDraftAction(action);
    // 结构/外观证据偶尔只有“证据保持可见”一类状态描述。Mini 5 秒
    // 收口后仍要满足首镜可拍边界，但不能为此恢复第二个产品动作族。
    // “手部操作产品”提供可观察主体运动，且不会虚构具体功能动作。
    return isPromptWizardObservableAction(fitted)
      ? fitted
      : fitPromptWizardDraftAction(`手部操作产品并动态呈现${fitted}`);
  };
  if (occurrences.length <= 1) return finalize(normalized || value);

  const selected = occurrences.find(item => (
    !PROMPT_WIZARD_GENERIC_SETUP_ACTIONS.has(item.label)
  )) ?? occurrences[0]!;
  const nextDifferent = occurrences.find(item => (
    item.index > selected.index && item.label !== selected.label
  ));
  const rawCore = normalized
    .slice(selected.index, nextDifferent?.index ?? normalized.length)
    .replace(/^(?:并|再|随后|然后|接着|先)\s*/u, '')
    .replace(/(?:并|再|随后|然后|接着|先|后)\s*$/u, '')
    .replace(/[，,；;：:\s]+$/gu, '')
    .trim();
  const core = rawCore || normalized.slice(selected.index, selected.end);
  const evidenceContext = promptWizardActionObjectContext(normalized, occurrences);
  return finalize(
    `手部持续${core}，镜头动态呈现${evidenceContext ? `${evidenceContext}相关的` : ''}所选证据真实结果`,
  );
}

function promptWizardActionObjectContext(
  value: string,
  occurrences: readonly PromptWizardActionOccurrence[],
) {
  let context = value;
  for (const occurrence of [...occurrences].sort((left, right) => right.index - left.index)) {
    context = `${context.slice(0, occurrence.index)}${context.slice(occurrence.end)}`;
  }
  return context
    .replace(/^(?:完整展示正确使用动作|用连续动作和真实操作声展示|近景操作或环绕展示结构|自然光近景配合触碰或弯折展示材质)\s*[：:]\s*/u, '')
    .replace(/(?:并|随后|然后|接着|以及|和)/gu, '、')
    .replace(/(?:先|再|后|于)/gu, '')
    .replace(/[，,；;：:\s、]+$/gu, '')
    .replace(/^[，,；;：:\s、]+/gu, '')
    .replace(/、{2,}/gu, '、')
    .slice(0, 80)
    .trim();
}

function promptWizardActionOccurrences(value: string) {
  const occurrences: PromptWizardActionOccurrence[] = [];
  for (const [pattern, label] of PROMPT_WIZARD_ACTION_OCCURRENCES) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      const index = match.index ?? -1;
      if (index < 0) continue;
      occurrences.push({
        index,
        end: index + match[0].length,
        label,
      });
    }
  }
  return occurrences.sort((left, right) => left.index - right.index || left.end - right.end);
}

export type PromptWizardSafeDiversityDimension =
  | 'openingEvent'
  | 'perspective'
  | 'pacing'
  | 'cta';

/**
 * 两轮模型修复后，只为 V5 强钩子稿构造受控的单维镜头表达候选。
 * 候选不修改方向、购买理由、场景、证据、地点、产品动作或目标语言口播；
 * 服务层必须逐个重渲染，并由权威四维分析器和历史门禁选择首个合格项。
 */
export function buildPromptWizardSafeHookDiversityCandidates(input: {
  draft: PromptWizardPlanDraft;
  dimension: PromptWizardSafeDiversityDimension;
  context: PromptWizardUseDirectionPlanContext;
  config: PromptWizardVideoConfig;
}) {
  const firstIndex = 0;
  const lastIndex = input.draft.segments.length - 1;
  if (lastIndex < 0) return [];

  if (input.dimension === 'perspective') {
    const candidates = [
      {
        subject: '@图片1中的产品证据局部',
        shotSize: '产品微距特写',
        cameraMovement: '微距镜头持续推近产品证据局部并保持清晰可见',
      },
      ...(input.context.useDirection.appearanceMode !== 'product-only' ? [{
        subject: '@图片1中的产品与操作手部',
        shotSize: '第一视角产品近景',
        cameraMovement: '第一视角沿所选动作落点观察产品证据',
      }] : []),
      {
        subject: '@图片1中的产品证据区域',
        shotSize: '产品近景',
        cameraMovement: '手持镜头沿产品证据区域横移追踪并保持构图稳定',
      },
      ...(input.config.model === 'seedance-2.0' && input.config.durationSeconds >= 10 ? [{
        subject: '@图片1中的产品证据区域',
        shotSize: '产品近景',
        cameraMovement: '镜头环绕产品证据区域完成一次观察',
      }] : []),
    ];
    return candidates.map(candidate => ({
      ...input.draft,
      segments: input.draft.segments.map((segment, index) => index === firstIndex
        ? { ...segment, ...candidate }
        : segment),
    }));
  }

  if (input.dimension === 'pacing') {
    const pacingCandidates = [
      {
        cameraAndPacing: '开场快切进入产品证据，随后按镜头职责利落衔接',
        editingCue: '当前镜头以快速剪辑完成职责后利落衔接下一段',
      },
      {
        cameraAndPacing: '证据出现后持续横移追踪，其余镜头按职责自然衔接',
        editingCue: '当前镜头职责完成后沿动作方向横移，再切换景别衔接下一段',
      },
      {
        cameraAndPacing: '开场直接揭晓产品状态，后续镜头按职责自然衔接',
        editingCue: '当前镜头职责完成后以揭晓式剪辑自然衔接下一段',
      },
    ];
    return pacingCandidates.map(({ cameraAndPacing, editingCue }) => ({
      ...input.draft,
      cameraAndPacing,
      segments: input.draft.segments.map(segment => ({
        ...segment,
        editingCue,
      })),
    }));
  }

  if (input.dimension === 'cta') {
    const ctaCandidates = [
      '镜头从产品整体持续推近证据结果，并在动作点切换景别形成明确购买引导。',
      '镜头沿证据区域横移回看开场，再快速切换至产品整体形成明确购买引导。',
      '镜头环绕处于完成状态的产品，以动态近景回扣需求并形成明确购买引导。',
    ];
    return ctaCandidates.map(action => ({
      ...input.draft,
      segments: input.draft.segments.map((segment, index) => index === lastIndex
        ? { ...segment, action }
        : segment),
    }));
  }

  const mainAction = normalizePromptWizardClause(
    fitPromptWizardDraftAction(input.context.selectedScene.mainAction),
  );
  const openingCandidates = [
    fitPromptWizardDraftAction(
      `${mainAction}，动作完成后镜头持续推近@图片1中的真实产品状态，证据区域立即成为画面焦点`,
    ),
    fitPromptWizardDraftAction(
      `第一秒从${mainAction}的关键过程切入，@图片1中的产品状态随动作完成清晰呈现`,
    ),
  ];
  return openingCandidates.map(action => ({
    ...input.draft,
    segments: input.draft.segments.map((segment, index) => index === firstIndex
      ? { ...segment, action }
      : segment),
  }));
}

function truncatePromptWizardUtf16(value: string, maxLength: number) {
  let result = '';
  for (const character of value) {
    if (result.length + character.length > maxLength) break;
    result += character;
  }
  return result.trim();
}

function fitPromptWizardDraftAction(value: string) {
  const maxLength = 300;
  const normalized = normalizePromptWizardSentence(value);
  if (normalized.length <= maxLength) return normalized;

  const body = normalizePromptWizardClause(value);
  const clipped = truncatePromptWizardUtf16(body, maxLength - 1)
    .replace(/[\s，,、：:；;]+$/gu, '')
    .trimEnd();
  return truncatePromptWizardUtf16(normalizePromptWizardSentence(clipped), maxLength);
}

export function assertPromptWizardUseDirectionDraftBoundary(
  draft: PromptWizardPlanDraft,
  context: PromptWizardUseDirectionPlanContext,
  evidenceGraph: PromptWizardEvidenceGraph,
) {
  const first = draft.segments[0];
  if (
    !first
    || !isPromptWizardObservableAction(first.action)
    || !promptWizardFirstShotHasProductAnchor(first, context, evidenceGraph)
  ) {
    throw promptError(
      '第一秒必须出现与产品相关的物理动作、状态变化或揭晓',
      'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID',
      { fieldPaths: ['segments[0].subject', 'segments[0].action'] },
    );
  }
  const narrativeText = [
    draft.hook,
    draft.narrative,
    draft.planningReview.surfaceNeed,
    draft.planningReview.realPainPoint,
    ...draft.segments.flatMap(segment => [segment.action, segment.voiceover, segment.voiceoverZh]),
  ].join('\n');
  if (!promptWizardSemanticOverlap(narrativeText, context.useDirection.purchaseReason)) {
    throw promptError(
      '脚本没有围绕用户选择的唯一购买理由展开',
      'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID',
      { fieldPaths: ['narrative', 'segments'] },
    );
  }
  assertPromptWizardSinglePurchaseReason(draft, context, evidenceGraph);
  const proofSegments = draft.segments.filter(segment => (
    segment.role === 'proof' || segment.role === 'proof-resolution' || segment.role === 'resolution'
  ));
  const proofActionVariants = promptWizardControlledActionVariants(
    context.useDirection.proofAction,
  );
  if (!proofSegments.some(segment => proofActionVariants.some(action => promptWizardSemanticOverlap(
    `${segment.action} ${segment.productionNote}`,
    action,
  )))) {
    throw promptError(
      '脚本没有执行所选方向的产品自证动作',
      'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID',
      { fieldPaths: ['segments'] },
    );
  }
  if (
    !draft.primaryScene.includes(context.selectedScene.title)
    || !promptWizardSemanticOverlap(draft.primaryScene, context.selectedScene.environment)
    || draft.segments.some(segment => !promptWizardSemanticOverlap(
      segment.location,
      context.selectedScene.environment,
    ))
    || !draft.segments.some(segment => [
      ...promptWizardControlledActionVariants(context.selectedScene.mainAction),
      // Mini 5 秒只能容纳一个主要动作族。此时确定性预算收口会从
      // “问题铺垫/自然拿起 + 自证动作”的完整场景流程中只保留已经
      // 验证的自证动作；它仍属于该场景主动作，而不是擅自换场景。
      ...promptWizardControlledActionVariants(context.useDirection.proofAction),
    ].some(action => promptWizardSemanticOverlap(segment.action, action)))
  ) {
    throw promptError(
      '脚本没有完整使用用户确认的场景与主动作',
      'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID',
      { fieldPaths: ['primaryScene', 'segments'] },
    );
  }
  const allowedEvidenceIds = new Set(context.useDirection.evidenceIds);
  const invalidEvidencePaths = draft.segments.flatMap((segment, segmentIndex) => (
    segment.evidenceRefs.flatMap((evidenceId, evidenceIndex) => (
      allowedEvidenceIds.has(evidenceId)
        ? []
        : [`segments[${segmentIndex}].evidenceRefs[${evidenceIndex}]`]
    ))
  ));
  if (invalidEvidencePaths.length > 0) {
    throw promptError(
      '脚本引用了所选使用方向之外的产品证据',
      'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID',
      { fieldPaths: invalidEvidencePaths },
    );
  }
}

function promptWizardControlledActionVariants(value: string) {
  const controlled = promptWizardSingleFamilyAction(value);
  return controlled === value ? [value] : [value, controlled];
}

/**
 * 视觉分镜可以为了保持产品一致性展示其他结构，但钩子、叙事和口播不能再
 * 把另一个可靠事实包装成第二购买理由。这里只检查面向观众的说服性文案，
 * 不扫描 productionNote 或一致性块，避免把必要的 Logo/结构提醒误判为卖点。
 */
function assertPromptWizardSinglePurchaseReason(
  draft: PromptWizardPlanDraft,
  context: PromptWizardUseDirectionPlanContext,
  evidenceGraph: PromptWizardEvidenceGraph,
) {
  const selectedIds = new Set(context.useDirection.evidenceIds);
  const extraEvidence = evidenceGraph.evidences.filter(evidence => (
    evidenceGraph.reliableEvidenceIds.includes(evidence.id)
    && !selectedIds.has(evidence.id)
    && (evidence.status === 'visible' || evidence.status === 'user-confirmed')
    // 产品名称与品类只用于明确画面主体，不属于第二购买理由；真正可能
    // 形成额外说服点的材质、结构、用途、能力等证据仍必须被拦截。
    && evidence.id !== 'profile:productName'
    && evidence.id !== 'profile:category'
    && !['appearance', 'audience', 'scenario'].includes(evidence.type)
    && !promptWizardStrongSemanticOverlap(
      evidence.text,
      context.useDirection.purchaseReason,
    )
  ));
  if (extraEvidence.length === 0) return;
  const persuasiveFields: PromptWizardStringLeaf[] = [
    { fieldPath: 'hook', value: draft.hook },
    { fieldPath: 'narrative', value: draft.narrative },
    ...draft.segments.flatMap((segment, index) => [
      { fieldPath: `segments[${index}].voiceover`, value: segment.voiceover },
      { fieldPath: `segments[${index}].voiceoverZh`, value: segment.voiceoverZh },
    ]),
  ];
  const fieldPaths = persuasiveFields.flatMap(field => (
    extraEvidence.some(evidence => promptWizardStrongSemanticOverlap(
      field.value,
      evidence.text,
    ))
      ? [field.fieldPath]
      : []
  ));
  if (fieldPaths.length > 0) {
    throw promptError(
      '脚本引入了所选方向之外的第二个购买理由',
      'PROMPT_WIZARD_USE_DIRECTION_EXPANSION_INVALID',
      { fieldPaths: [...new Set(fieldPaths)] },
    );
  }
}

function promptWizardFirstShotHasProductAnchor(
  first: PromptWizardPlanDraft['segments'][number],
  context: PromptWizardUseDirectionPlanContext,
  evidenceGraph: PromptWizardEvidenceGraph,
) {
  const firstShotText = `${first.subject}\n${first.action}`;
  if (/@图片\d+/u.test(firstShotText)) return true;
  const allowedEvidenceIds = new Set(context.useDirection.evidenceIds);
  if (first.evidenceRefs.some(evidenceId => allowedEvidenceIds.has(evidenceId))) return true;
  const allowedEvidenceTexts = evidenceGraph.evidences
    .filter(evidence => allowedEvidenceIds.has(evidence.id))
    .map(evidence => evidence.text);
  return [
    context.useDirection.title,
    context.useDirection.purchaseReason,
    context.useDirection.proofAction,
    context.selectedScene.mainAction,
    ...allowedEvidenceTexts,
  ].some(anchor => promptWizardSemanticOverlap(firstShotText, anchor));
}

function promptWizardSemanticOverlap(left: string, right: string) {
  const normalize = (value: string) => value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[^㐀-鿿\p{Script=Latin}\p{N}]+/gu, '');
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (
    (normalizedRight.length >= 3 && normalizedLeft.includes(normalizedRight))
    || (normalizedLeft.length >= 3 && normalizedRight.includes(normalizedLeft))
  ) return true;
  const ngrams = (value: string) => {
    const result = new Set<string>();
    for (let index = 0; index < value.length - 1; index += 1) {
      result.add(value.slice(index, index + 2));
    }
    return result;
  };
  const leftTerms = ngrams(normalizedLeft);
  const rightTerms = ngrams(normalizedRight);
  if (leftTerms.size === 0 || rightTerms.size === 0) return false;
  let intersection = 0;
  leftTerms.forEach(term => {
    if (rightTerms.has(term)) intersection += 1;
  });
  return intersection / Math.min(leftTerms.size, rightTerms.size) >= 0.34;
}

function promptWizardStrongSemanticOverlap(left: string, right: string) {
  const normalize = (value: string) => value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[^㐀-鿿\p{Script=Latin}\p{N}]+/gu, '');
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (!normalizedLeft || !normalizedRight) return false;
  const shorterLength = Math.min(normalizedLeft.length, normalizedRight.length);
  if (
    shorterLength >= 5
    && (
      normalizedLeft.includes(normalizedRight)
      || normalizedRight.includes(normalizedLeft)
    )
  ) return true;
  const ngrams = (value: string) => {
    const result = new Set<string>();
    for (let index = 0; index <= value.length - 3; index += 1) {
      result.add(value.slice(index, index + 3));
    }
    return result;
  };
  const leftTerms = ngrams(normalizedLeft);
  const rightTerms = ngrams(normalizedRight);
  if (leftTerms.size === 0 || rightTerms.size === 0) return false;
  let intersection = 0;
  leftTerms.forEach(term => {
    if (rightTerms.has(term)) intersection += 1;
  });
  return intersection >= 2
    && intersection / Math.min(leftTerms.size, rightTerms.size) >= 0.45;
}

export function buildPromptWizardConstraintBlock(
  profile: PromptWizardProductProfile,
  imageCount: number,
  includeUserConfirmedClaims = true,
) {
  const referenceNames = Array.from({ length: imageCount }, (_, index) => `@图片${index + 1}`).join('、');
  const appearance = [
    profile.materials && `材质：${normalizePromptWizardClause(profile.materials)}`,
    profile.structure && `结构：${normalizePromptWizardClause(profile.structure)}`,
    profile.logo && `Logo：${normalizePromptWizardClause(profile.logo)}`,
  ].filter(Boolean).join('；');
  return [
    `产品视觉仅以当前全能参考图片 ${referenceNames} 为依据，不增加不存在的部件或品牌标识。`,
    '画面内不新增可读文字、贴纸或水印；参考图片中已有 Logo 与印花必须保持原样。',
    appearance && normalizePromptWizardSentence(appearance),
    profile.usage && normalizePromptWizardSentence(`正确使用方式：${profile.usage}`),
    profile.consistencyConstraints && normalizePromptWizardSentence(`用户确认的一致性要求：${profile.consistencyConstraints}`),
    includeUserConfirmedClaims
      && profile.userConfirmedClaims
      && normalizePromptWizardSentence(`用户确认可使用的卖点或事实：${profile.userConfirmedClaims}`),
  ].filter(Boolean).join('\n');
}

function normalizePromptWizardClause(value: string) {
  return value.trim().replace(/[。．.；;！？!?]+$/gu, '').trimEnd();
}

function normalizePromptWizardSentence(value: string) {
  const trimmed = value.trim();
  const terminal = trimmed.match(/[。．.；;！？!?]+$/u)?.[0] ?? '';
  const body = terminal ? trimmed.slice(0, -terminal.length).trimEnd() : trimmed;
  const last = terminal.at(-1);
  if (last && /[！？!?]/u.test(last)) return `${body}${last}`;
  return `${body}。`;
}

export function describePromptWizardProduct(profile: PromptWizardProductProfile) {
  return {
    productName: profile.productName,
    category: profile.category,
    materials: profile.materials,
    structure: profile.structure,
    logo: profile.logo,
    usage: profile.usage,
    suggestedAudience: profile.suggestedAudience,
    suggestedScenarios: profile.suggestedScenarios,
    visibleFacts: profile.visibleFacts,
    needsConfirmation: profile.needsConfirmation,
    userConfirmedClaims: profile.userConfirmedClaims,
    consistencyConstraints: profile.consistencyConstraints,
  };
}

function composePromptWizardVisual(segment: PromptWizardPlanDraft['segments'][number]) {
  return [
    `地点与环境：${segment.location}`,
    `主体：${segment.subject}`,
    `景别：${segment.shotSize}`,
    `动作：${segment.action}`,
    `运镜：${segment.cameraMovement}`,
    `光线与真实感：${segment.lightingAndRealism}`,
  ].join('；');
}

function assertPromptWizardBeatRoles(
  draft: PromptWizardPlanDraft,
  expectedRoles: readonly z.infer<typeof promptWizardShotRoleSchema>[],
) {
  const actualRoles = draft.segments.map(segment => segment.role);
  if (
    actualRoles.length !== expectedRoles.length
    || actualRoles.some((role, index) => role !== expectedRoles[index])
  ) {
    const fieldPaths = actualRoles
      .map((role, index) => role !== expectedRoles[index] ? `segments[${index}].role` : null)
      .filter((path): path is string => Boolean(path));
    throw promptError(
      `镜头职责应为 ${expectedRoles.join(' → ')}，实际为 ${actualRoles.join(' → ')}`,
      'PROMPT_WIZARD_BEAT_INVALID',
      { fieldPaths: fieldPaths.length > 0 ? fieldPaths : ['segments'] },
    );
  }
}

function assertPromptWizardEvidence(
  draft: PromptWizardPlanDraft,
  _profile: PromptWizardProductProfile,
  evidenceGraph: PromptWizardEvidenceGraph,
) {
  const catalog = evidenceGraph.reliableEvidenceIds
    .map(id => evidenceGraph.evidences.find(item => item.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(
      item && (item.status === 'visible' || item.status === 'user-confirmed'),
    ))
    .map(item => ({ id: item.id, text: item.text }));
  const validIds = new Set(catalog.map(item => item.id));
  const validProofPoints = new Set(catalog.map(item => normalizeFactText(item.text)));
  const fieldPaths: string[] = [];

  draft.planningReview.proofPoints.forEach((proofPoint, index) => {
    if (!validProofPoints.has(normalizeFactText(proofPoint))) {
      fieldPaths.push(`planningReview.proofPoints[${index}]`);
    }
  });

  draft.segments.forEach((segment, index) => {
    if (
      ['proof', 'proof-resolution', 'resolution'].includes(segment.role)
      && segment.evidenceRefs.length === 0
    ) {
      fieldPaths.push(`segments[${index}].evidenceRefs`);
    }
    segment.evidenceRefs.forEach((reference, referenceIndex) => {
      if (!validIds.has(reference)) {
        fieldPaths.push(`segments[${index}].evidenceRefs[${referenceIndex}]`);
      }
    });
  });

  if (fieldPaths.length > 0) {
    throw promptError(
      `方案使用了无法追溯的产品事实：${fieldPaths.join('、')}`,
      'PROMPT_WIZARD_EVIDENCE_INVALID',
      { fieldPaths },
    );
  }
}

function splitConfirmedClaims(value: string) {
  return value
    .split(/[\n；;。]+/u)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeFactText(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/gu, '');
}

function assertImageReferences(leaves: PromptWizardStringLeaf[], imageCount: number) {
  const fieldPaths = promptWizardMatchingFieldPaths(leaves, value => {
    if (/@(?:视频|音频|素材|首帧|尾帧)/.test(value)) return true;
    const referenceStarts = value.match(/@图片/g)?.length ?? 0;
    const references = Array.from(value.matchAll(/@图片(\d+)/g));
    if (referenceStarts !== references.length) return true;
    return references.some(match => {
      const imageNumber = Number(match[1]);
      return !Number.isInteger(imageNumber) || imageNumber < 1 || imageNumber > imageCount;
    });
  });
  if (fieldPaths.length === 0) return;

  if (leaves.some(({ value }) => /@(?:视频|音频|素材|首帧|尾帧)/.test(value))) {
    throw promptError(
      '提示词只能引用当前全能参考图片',
      'PROMPT_WIZARD_REFERENCE_INVALID',
      { fieldPaths },
    );
  }
  throw promptError(
    '提示词包含无法识别或不存在的图片引用',
    'PROMPT_WIZARD_REFERENCE_INVALID',
    { fieldPaths },
  );
}

export function promptWizardReferenceModeFieldPaths(
  leaves: PromptWizardStringLeaf[],
) {
  return promptWizardMatchingFieldPaths(
    leaves,
    value => /(?:首\s*[_-]?\s*帧|尾\s*[_-]?\s*帧|首\s*尾\s*[_-]?\s*帧|起始\s*[_-]?\s*帧|结束\s*[_-]?\s*帧|第一\s*[_-]?\s*帧|最后一\s*[_-]?\s*帧|(?:first|last|start|end)[\s_-]*frame)/iu.test(
      value.normalize('NFKC'),
    ),
  );
}

/**
 * 渲染器与终态本地收口共用同一套首尾帧语义权威检查，避免
 * fallback 复制正则后与最终提示词门禁漂移。
 */
export function assertPromptWizardNoFirstLastSemantics(
  leaves: PromptWizardStringLeaf[],
) {
  const fieldPaths = promptWizardReferenceModeFieldPaths(leaves);
  if (fieldPaths.length === 0) return;
  throw promptError(
    '全能参考向导不能输出首尾帧语义',
    'PROMPT_WIZARD_REFERENCE_MODE_INVALID',
    { fieldPaths },
  );
}

/** 只移除历史渲染器固定追加的完整尾段，不改写用户正文中的相似语句。 */
export function normalizePromptWizardProductionPrompt(value: string) {
  const trimmed = value.trim();
  if (!trimmed.endsWith(LEGACY_PROMPT_WIZARD_PROHIBITION)) return trimmed;
  return trimmed.slice(0, -LEGACY_PROMPT_WIZARD_PROHIBITION.length).trimEnd();
}

export type PromptWizardStringLeaf = {
  fieldPath: string;
  value: string;
};

export function promptWizardStringLeaves(
  value: unknown,
  fieldPath = '',
): PromptWizardStringLeaf[] {
  if (typeof value === 'string') {
    return [{ fieldPath: fieldPath || 'value', value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => (
      promptWizardStringLeaves(item, `${fieldPath}[${index}]`)
    ));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => (
    promptWizardStringLeaves(item, fieldPath ? `${fieldPath}.${key}` : key)
  ));
}

function promptWizardMatchingFieldPaths(
  leaves: PromptWizardStringLeaf[],
  predicate: (value: string) => boolean,
) {
  return Array.from(new Set(
    leaves.filter(({ value }) => predicate(value)).map(({ fieldPath }) => fieldPath),
  )).slice(0, 24);
}

function assertNoUnconfirmedCommercialClaims(
  leaves: PromptWizardStringLeaf[],
  confirmedClaims: string,
) {
  const fieldPaths = findPromptWizardUnconfirmedClaimFieldPaths(leaves, confirmedClaims);
  if (fieldPaths.length > 0) {
    throw promptError(
      `方案包含未经用户确认的商业事实，涉及字段：${fieldPaths.join('、')}`,
      'PROMPT_WIZARD_UNCONFIRMED_CLAIM',
      { fieldPaths },
    );
  }
}

/**
 * 在冻结方案生成积分和调用 Provider 前校验会被确定性写入产品一致性块的字段。
 * 用户确认卖点是白名单来源，因此不把该字段本身作为待检查正文。
 */
export function assertPromptWizardProductInputClaims(profile: PromptWizardProductProfile) {
  const leaves: PromptWizardStringLeaf[] = [
    { fieldPath: 'materials', value: profile.materials },
    { fieldPath: 'structure', value: profile.structure },
    { fieldPath: 'logo', value: profile.logo },
    { fieldPath: 'usage', value: profile.usage },
    { fieldPath: 'consistencyConstraints', value: profile.consistencyConstraints },
  ];
  const fieldPaths = findPromptWizardUnconfirmedClaimFieldPaths(
    leaves,
    profile.userConfirmedClaims,
  );
  if (fieldPaths.length > 0) {
    throw promptError(
      `产品信息包含未经确认的商业主张，涉及字段：${fieldPaths.join('、')}`,
      'PROMPT_WIZARD_PRODUCT_INPUT_CLAIM_INVALID',
      { fieldPaths },
    );
  }
}

export function findPromptWizardUnconfirmedClaimFieldPaths(
  leaves: PromptWizardStringLeaf[],
  confirmedClaims: string,
) {
  const comparableClaims = splitConfirmedClaims(confirmedClaims);
  const riskyPatterns = [
    /[¥￥$€£]\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:元|美元|美金|欧元|英镑)/giu,
    /\d+(?:[.,]\d+)?\s*(?:%|db|小时|分钟|毫秒|mah|wh|瓦|w\b|v\b|hz|khz|mhz|gb|tb|折|倍|天续航|day(?:s)?|hour(?:s)?|minute(?:s)?)/giu,
    /\b(?:ce|fcc|fda|rohs|iso(?:\s*\d+)?|ul|etl|pse|kc|bqb|mfi|ccc|3c)\b\s*(?:认证|certified|certification)?|(?:通过|获得|拥有|符合|具备)[^，。！？,.!?]{0,12}认证|(?:欧盟|国家|行业|权威|专业)认证/giu,
    /(?:售价|价格|优惠|折扣|立减|满减|领券|券后|限时价|到手价|discount|coupon|sale\s+price|\d+\s*%\s*off)/giu,
    /(?:同类最佳|行业第一|销量第一|竞品都|领先竞品|用户评价|用户都说|五星好评|best\s+in\s+class|number\s+one|five[-\s]?star\s+review)/giu,
    /(?:百分之百|100\s*%|保证有效|永久有效|彻底解决|零风险|guaranteed?|cure[sd]?|risk[-\s]?free)/giu,
    /(?:主动降噪|降噪效果|防水|防尘|防摔|抗菌|抑菌|杀菌|除菌|低延迟|快充|续航|无毒|低敏|防蓝光|改善睡眠|缓解疲劳|提升效率|增强免疫|美白|祛痘|减脂|止痛|治疗|治愈|预防疾病)/giu,
  ];

  const fieldPaths = new Set<string>();
  for (const { fieldPath, value } of leaves) {
    for (const pattern of riskyPatterns) {
      for (const match of value.matchAll(pattern)) {
        const claim = normalizeClaimText(match[0]);
        if (!claim) continue;
        const sourceClause = promptWizardClaimClause(value, match.index ?? 0, match[0].length);
        if (isClaimConfirmed(comparableClaims, claim, sourceClause)) continue;
        fieldPaths.add(fieldPath);
      }
    }
  }

  return [...fieldPaths].slice(0, 24);
}

export function findPromptWizardUnsupportedRiskFieldPaths(
  leaves: PromptWizardStringLeaf[],
) {
  const prohibitedPatterns = [
    /(?:全网都在买|所有人都在用|人人都推荐|已经卖爆|百万用户选择|everyone\s+(?:is|has\s+been)\s+buying|everyone\s+recommends|viral\s+product)/iu,
    /(?:只剩\s*\d+\s*(?:件|个|套)|最后\s*\d+\s*(?:件|个|套)|马上售罄|今日最后机会|only\s+\d+\s+left|selling\s+out|last\s+chance\s+today)/iu,
    /(?:明火燃烧|故意浸水|车辆碾压|高空抛落|用重物砸|open\s+flame|submerge\s+in\s+water|run\s+over\s+with\s+a\s+car)/iu,
    /(?:凭空(?:变出|出现|生成)(?:产品)?|产品(?:会)?凭空(?:变出|出现|生成)|无接触自动变化|魔法生成产品|产品.{0,6}(?:瞬间|自动)?自我修复|magically\s+appears?|repairs?\s+itself)/iu,
    /(?:碾压竞品|吊打竞品|竞品完全不行|远超所有同类|beats?\s+every\s+competitor)/iu,
  ];
  return promptWizardMatchingFieldPaths(
    leaves,
    value => prohibitedPatterns.some(pattern => pattern.test(value)),
  );
}

function assertNoUnsupportedRiskClaims(leaves: PromptWizardStringLeaf[]) {
  const fieldPaths = findPromptWizardUnsupportedRiskFieldPaths(leaves);
  if (fieldPaths.length === 0) return;
  throw promptError(
    '方案包含虚假社会证明、虚假稀缺、危险测试、魔法变化或无依据竞品结论',
    'PROMPT_WIZARD_UNSAFE_CONTENT',
    { fieldPaths },
  );
}

function assertPromptWizardTranslations(draft: PromptWizardPlanDraft, targetLanguage: string) {
  if (targetLanguage === '普通话') {
    const fieldPaths = draft.segments.flatMap((segment, index) => (
      segment.voiceoverZh ? [`segments[${index}].voiceoverZh`] : []
    ));
    if (fieldPaths.length > 0) {
      throw promptError(
        '普通话方案不得重复返回中文译文',
        'PROMPT_WIZARD_TRANSLATION_INVALID',
        { fieldPaths },
      );
    }
    return;
  }
  const fieldPaths: string[] = [];
  for (const [index, segment] of draft.segments.entries()) {
    if (!segment.voiceover && !segment.voiceoverZh) continue;
    if (!segment.voiceover) fieldPaths.push(`segments[${index}].voiceover`);
    if (!segment.voiceoverZh || !/[\u3400-\u9fff]/u.test(segment.voiceoverZh)) {
      fieldPaths.push(`segments[${index}].voiceoverZh`);
    }
  }
  if (fieldPaths.length > 0) {
    throw promptError(
      '口播原文与简体中文翻译不完整',
      'PROMPT_WIZARD_TRANSLATION_INVALID',
      { fieldPaths },
    );
  }
}

/**
 * 方案元数据、预审、结构化画面、Foley 与制作提示必须以简体中文为主。
 * 目标语言仅允许出现在 voiceover，因此该字段不在这里校验。
 */
function assertPromptWizardContentLanguage(
  draft: PromptWizardPlanDraft,
  profile: PromptWizardProductProfile,
) {
  const allowedLatinTokens = promptWizardAllowedLatinTokens(profile);
  const fields: Array<[string, string]> = [
    ['name', draft.name],
    ['hook', draft.hook],
    ['narrative', draft.narrative],
    ['primaryScene', draft.primaryScene],
    ['cameraAndPacing', draft.cameraAndPacing],
    ...draft.differenceTags.map((value, index) => [`differenceTags[${index}]`, value] as [string, string]),
    ['planningReview.targetAudience', draft.planningReview.targetAudience],
    ['planningReview.surfaceNeed', draft.planningReview.surfaceNeed],
    ['planningReview.realPainPoint', draft.planningReview.realPainPoint],
    ['planningReview.nonAdEntry', draft.planningReview.nonAdEntry],
    ['planningReview.directionFit', draft.planningReview.directionFit],
    ...draft.planningReview.proofPoints.map((value, index) => (
      [`planningReview.proofPoints[${index}]`, value] as [string, string]
    )),
    ...draft.segments.flatMap((segment, index) => ([
      [`segments[${index}].location`, segment.location],
      [`segments[${index}].subject`, segment.subject],
      [`segments[${index}].shotSize`, segment.shotSize],
      [`segments[${index}].action`, segment.action],
      [`segments[${index}].cameraMovement`, segment.cameraMovement],
      [`segments[${index}].lightingAndRealism`, segment.lightingAndRealism],
      [`segments[${index}].foley`, segment.foley],
      [`segments[${index}].editingCue`, segment.editingCue],
      [`segments[${index}].productionNote`, segment.productionNote],
    ] as Array<[string, string]>)),
    ...draft.productionWarnings.map((warning, index) => (
      [`productionWarnings[${index}]`, warning] as [string, string]
    )),
  ];
  const fieldPaths = fields
    .filter(([, value]) => value.trim().length > 0)
    .filter(([, value]) => !isPromptWizardChineseDominant(value, allowedLatinTokens))
    .map(([path]) => path)
    .slice(0, 24);

  if (fieldPaths.length > 0) {
    throw promptError(
      `方案中以下字段必须以简体中文为主：${fieldPaths.join('、')}`,
      'PROMPT_WIZARD_CONTENT_LANGUAGE_INVALID',
      { fieldPaths },
    );
  }
}

export function isPromptWizardChineseDominant(value: string, allowedLatinTokens: Set<string>) {
  const normalized = value.normalize('NFKC').replace(/@图片\s*\d+/gu, '');
  const hanCount = normalized.match(/\p{Script=Han}/gu)?.length ?? 0;
  if (hanCount === 0) return false;

  const latinCount = Array.from(normalized.matchAll(/\p{Script=Latin}+/gu))
    .reduce((count, match) => {
      const token = match[0].toLocaleLowerCase('en-US');
      if (PROMPT_WIZARD_FIXED_LATIN_TOKENS.has(token) || allowedLatinTokens.has(token)) {
        return count;
      }
      return count + Array.from(match[0]).length;
    }, 0);
  return latinCount <= Math.max(4, hanCount);
}

function promptWizardAllowedLatinTokens(profile: PromptWizardProductProfile) {
  const profileText = [
    profile.productName,
    profile.logo,
    ...profile.visibleFacts,
    profile.consistencyConstraints,
  ].join('\n').normalize('NFKC');

  return new Set(
    Array.from(profileText.matchAll(/\p{Script=Latin}+/gu), match => (
      match[0].toLocaleLowerCase('en-US')
    )),
  );
}

const PROMPT_WIZARD_CLAIM_CONCEPTS = [
  ['price', /(?:[$¥￥€£]\s*\d|售价|价格|到手价|current\s+price|sale\s+price|price)/iu],
  ['promotion', /(?:优惠券|优惠|折扣|领券|满减|立减|包邮|coupon|discount|\boff\b|free\s+shipping)/iu],
  ['noise-cancellation', /(?:主动)?降噪|noise\s*cancell?ation|\banc\b/iu],
  ['battery-life', /续航|电池(?:寿命|时长)|battery\s*life|runtime/iu],
  ['fast-charge', /快充|快速充电|fast\s*charg/iu],
  ['waterproof', /防水|抗水|waterproof|water\s*resistan/iu],
  ['dustproof', /防尘|dustproof|dust\s*resistan/iu],
  ['drop-resistance', /防摔|抗摔|drop\s*resistan|shockproof/iu],
  ['fade-resistance', /防褪色|不褪色|耐褪色|fade\s*resistan|colorfast/iu],
  ['cotton', /棉(?:质|料|纤维)?|cotton/iu],
  ['satisfaction', /满意|satisfaction/iu],
  ['antibacterial', /抗菌|抑菌|杀菌|除菌|antibacterial|antimicrobial/iu],
  ['latency', /延迟|latency/iu],
  ['hypoallergenic', /低敏|防过敏|hypoallergenic/iu],
  ['blue-light', /蓝光|blue\s*light/iu],
] as const;

function isClaimConfirmed(
  confirmedClaims: string[],
  claim: string,
  sourceClause: string,
) {
  const matchingStatements = confirmedClaims.filter(statement => (
    containsNormalizedClaim(normalizeClaimText(statement), claim)
  ));
  if (matchingStatements.length === 0) return false;

  const sourceConcepts = promptWizardClaimConcepts(sourceClause);
  const sourcePolarity = promptWizardClaimPolarity(sourceClause, claim, sourceConcepts);
  if (sourcePolarity === 'uncertain') return false;

  return matchingStatements.some(statement => {
    const statementConcepts = promptWizardClaimConcepts(statement);
    const statementPolarity = promptWizardClaimPolarity(statement, claim, statementConcepts);
    if (statementPolarity !== sourcePolarity) return false;
    if (!/\d/u.test(claim)) return true;

    if (sourceConcepts.size > 0 || statementConcepts.size > 0) {
      return [...sourceConcepts].some(concept => statementConcepts.has(concept));
    }

    const sourceContext = promptWizardClaimContext(sourceClause, claim);
    const confirmedContext = promptWizardClaimContext(statement, claim);
    if (!sourceContext) return true;
    if (!confirmedContext) return false;
    return sourceContext.includes(confirmedContext)
      || confirmedContext.includes(sourceContext)
      || promptWizardClaimContextOverlaps(sourceContext, confirmedContext);
  });
}

type PromptWizardClaimPolarity = 'positive' | 'negative' | 'uncertain';

type PromptWizardTextRange = {
  start: number;
  end: number;
};

const PROMPT_WIZARD_POLARITY_SCOPE_BOUNDARY = /[\n，,。；;！？!?]+|但(?:是)?|不过|然而|却|\b(?:but|however|whereas)\b/giu;

const PROMPT_WIZARD_UNCERTAINTY_PATTERNS = [
  /(?:待|有待)(?:进一步)?(?:确认|核实|验证)|(?:需|需要)(?:进一步)?(?:确认|核实|验证)|(?:无法|不能|尚未|未)(?:确认|确定|判断|核实|验证)|尚不明确|不确定|可能(?:是|为)?|疑似|推测|或许|也许/gu,
  /\b(?:maybe|possibly|perhaps|uncertain|unconfirmed|unknown|unclear|allegedly|reportedly)\b/giu,
  /\b(?:may|might|could)\b/giu,
  /\b(?:cannot|can\s*not|can['’]?t|unable\s+to|not\s+yet|has['’]?t|have['’]?t)\s+(?:confirm|verify|determine)\b/giu,
  /\b(?:needs?|requires?|awaiting)\s+(?:confirmation|verification)\b|\bnot\s+(?:necessarily|confirmed|verified|clear|certain)\b/giu,
] as const;

const PROMPT_WIZARD_NEGATIVE_POLARITY_PATTERNS = [
  /并非|并不|不是|不再|不予|不支持|不具备|不提供|不包含|不含|不能|不可|不会|没有|没能|尚未|未曾|未能|无法/gu,
  /(?:不|无|未|非)(?=(?:支持|具备|提供|包含|含有|拥有|具有|实现|达到|符合|采用|可达|能够|可以|(?:主动)?降噪|续航|快充|快速充电|防水|抗水|防尘|防摔|抗摔|抗菌|抑菌|杀菌|除菌|低延迟|低敏|防蓝光|改善睡眠|缓解疲劳|提升效率|增强免疫|美白|祛痘|减脂|止痛|治疗|治愈|预防疾病))/gu,
  /\b(?:does|do|did|is|are|was|were|has|have|had)\s+not(?:\s+\w+){0,3}\s+(?:support(?:s|ed|ing)?|provide(?:s|d|ing)?|offer(?:s|ed|ing)?|include(?:s|d|ing)?|contain(?:s|ed|ing)?|have|has|be)\b/giu,
  /\b(?:doesn['’]?t|don['’]?t|didn['’]?t|isn['’]?t|aren['’]?t|wasn['’]?t|weren['’]?t|hasn['’]?t|haven['’]?t|hadn['’]?t|cannot|can\s*not|can['’]?t|won['’]?t)(?:\s+\w+){0,3}\s+(?:support(?:s|ed|ing)?|provide(?:s|d|ing)?|offer(?:s|ed|ing)?|include(?:s|d|ing)?|contain(?:s|ed|ing)?|have|has|be)?\b/giu,
  /\b(?:not|no|without|cannot|can\s*not|can['’]?t|doesn['’]?t|unsupported|never|neither|nor)\b/giu,
] as const;

const PROMPT_WIZARD_POSITIVE_POLARITY_PATTERNS = [
  /支持|具备|提供|包含|含有|拥有|具有|实现|达到|符合|采用|可达|能够|可以/gu,
  /\b(?:support(?:s|ed|ing)?|provide(?:s|d|ing)?|offer(?:s|ed|ing)?|include(?:s|d|ing)?|contain(?:s|ed|ing)?|feature(?:s|d|ing)?|capable)\b/giu,
] as const;

/**
 * 商业事实授权必须比较主张附近的极性，而不是仅比较命中的文字片段。
 * 不确定语句不构成确认；同一语句内出现相互冲突的极性时也按不确定处理。
 */
function promptWizardClaimPolarity(
  value: string,
  claim: string,
  concepts: Set<(typeof PROMPT_WIZARD_CLAIM_CONCEPTS)[number][0]>,
): PromptWizardClaimPolarity {
  const normalizedValue = value.normalize('NFKC').toLocaleLowerCase('en-US');
  const anchors = promptWizardClaimPolarityAnchors(normalizedValue, claim, concepts);
  if (anchors.length === 0) return 'uncertain';

  const polarities = new Set(anchors.map(anchor => (
    promptWizardClaimPolarityAtAnchor(normalizedValue, anchor)
  )));
  if (polarities.has('uncertain') || polarities.size !== 1) return 'uncertain';
  return [...polarities][0]!;
}

function promptWizardClaimPolarityAnchors(
  value: string,
  claim: string,
  concepts: Set<(typeof PROMPT_WIZARD_CLAIM_CONCEPTS)[number][0]>,
) {
  const claimRanges = promptWizardClaimRanges(value, claim);
  if (claimRanges.length === 0 || concepts.size === 0) return claimRanges;

  const conceptRanges = PROMPT_WIZARD_CLAIM_CONCEPTS.flatMap(([concept, pattern]) => {
    if (!concepts.has(concept)) return [];
    return promptWizardPatternRanges(value, pattern);
  });
  if (conceptRanges.length === 0) return claimRanges;

  return claimRanges.map(claimRange => {
    const scope = promptWizardPolarityScope(value, claimRange);
    const nearestConcept = conceptRanges
      .filter(range => range.start >= scope.start && range.end <= scope.end)
      .sort((left, right) => (
        promptWizardRangeDistance(left, claimRange) - promptWizardRangeDistance(right, claimRange)
      ))[0];
    if (!nearestConcept || promptWizardRangeDistance(nearestConcept, claimRange) > 32) {
      return claimRange;
    }
    return {
      start: Math.min(claimRange.start, nearestConcept.start),
      end: Math.max(claimRange.end, nearestConcept.end),
    };
  });
}

function promptWizardClaimRanges(value: string, claim: string) {
  const numericClaim = claim.match(/\d+(?:[.,]\d+)?/u)?.[0];
  if (numericClaim) {
    const ranges = promptWizardPatternRanges(
      value,
      new RegExp(escapePromptWizardRegExp(numericClaim), 'gu'),
    );
    return ranges.filter(range => {
      const before = value[range.start - 1] ?? '';
      const after = value[range.end] ?? '';
      return !/[\d.,]/u.test(before) && !/[\d.,]/u.test(after);
    });
  }

  const flexibleClaim = Array.from(claim)
    .map(character => escapePromptWizardRegExp(character))
    .join('\\s*');
  if (!flexibleClaim) return [];
  return promptWizardPatternRanges(value, new RegExp(flexibleClaim, 'giu'));
}

function promptWizardClaimPolarityAtAnchor(
  value: string,
  anchor: PromptWizardTextRange,
): PromptWizardClaimPolarity {
  const scope = promptWizardPolarityScope(value, anchor);
  const scopeValue = value.slice(scope.start, scope.end);
  const localAnchor = {
    start: anchor.start - scope.start,
    end: anchor.end - scope.start,
  };
  const uncertaintyRanges = PROMPT_WIZARD_UNCERTAINTY_PATTERNS.flatMap(pattern => (
    promptWizardPatternRanges(scopeValue, pattern)
  ));
  if (uncertaintyRanges.some(range => promptWizardRangeDistance(range, localAnchor) <= 24)) {
    return 'uncertain';
  }

  const negativeRanges = PROMPT_WIZARD_NEGATIVE_POLARITY_PATTERNS.flatMap(pattern => (
    promptWizardPatternRanges(scopeValue, pattern)
  ));
  const positiveRanges = PROMPT_WIZARD_POSITIVE_POLARITY_PATTERNS
    .flatMap(pattern => promptWizardPatternRanges(scopeValue, pattern))
    .filter(positive => !promptWizardPositiveCueIsNegated(
      scopeValue,
      positive,
      negativeRanges,
    ));
  const negativeDistance = promptWizardNearestRangeDistance(negativeRanges, localAnchor);
  const positiveDistance = promptWizardNearestRangeDistance(positiveRanges, localAnchor);
  return negativeDistance <= 24 && negativeDistance <= positiveDistance
    ? 'negative'
    : 'positive';
}

function promptWizardPositiveCueIsNegated(
  value: string,
  positive: PromptWizardTextRange,
  negatives: PromptWizardTextRange[],
) {
  return negatives.some(negative => {
    if (promptWizardRangesOverlap(positive, negative)) return true;
    if (negative.end > positive.start) return false;
    const bridge = value.slice(negative.end, positive.start).replace(/\s+/gu, '');
    return bridge.length === 0
      || /^(?:(?:真正|明确|完全|正式|实际|目前|现在|暂时|充分|成功)|(?:currently|actually|fully|clearly))*$/iu.test(bridge);
  });
}

function promptWizardPolarityScope(value: string, anchor: PromptWizardTextRange) {
  let start = 0;
  let end = value.length;
  for (const boundary of value.matchAll(PROMPT_WIZARD_POLARITY_SCOPE_BOUNDARY)) {
    const boundaryStart = boundary.index;
    const boundaryEnd = boundaryStart + boundary[0].length;
    if (boundaryEnd <= anchor.start) {
      start = boundaryEnd;
      continue;
    }
    if (boundaryStart >= anchor.end) {
      end = boundaryStart;
      break;
    }
  }
  return { start, end };
}

function promptWizardPatternRanges(value: string, pattern: RegExp): PromptWizardTextRange[] {
  const globalPattern = pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
  return Array.from(value.matchAll(globalPattern), match => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function promptWizardNearestRangeDistance(
  ranges: PromptWizardTextRange[],
  anchor: PromptWizardTextRange,
) {
  return ranges.reduce(
    (nearest, range) => Math.min(nearest, promptWizardRangeDistance(range, anchor)),
    Number.POSITIVE_INFINITY,
  );
}

function promptWizardRangeDistance(left: PromptWizardTextRange, right: PromptWizardTextRange) {
  if (promptWizardRangesOverlap(left, right)) return 0;
  return left.end <= right.start ? right.start - left.end : left.start - right.end;
}

function promptWizardRangesOverlap(left: PromptWizardTextRange, right: PromptWizardTextRange) {
  return left.start < right.end && right.start < left.end;
}

function escapePromptWizardRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function containsNormalizedClaim(value: string, claim: string) {
  let searchFrom = 0;
  while (searchFrom <= value.length - claim.length) {
    const index = value.indexOf(claim, searchFrom);
    if (index < 0) return false;
    if (!/\d/u.test(claim)) return true;
    const before = value[index - 1] ?? '';
    const after = value[index + claim.length] ?? '';
    // 避免把已确认的 140dB / 110 小时误当成已确认 40dB / 10 小时。
    if (!/[\d.,]/u.test(before) && !/[\d.,]/u.test(after)) return true;
    searchFrom = index + 1;
  }
  return false;
}

function promptWizardClaimClause(value: string, matchIndex: number, matchLength: number) {
  const clauseBoundary = /[\n，,。；;！？!?]/u;
  let start = matchIndex;
  while (start > 0 && !clauseBoundary.test(value[start - 1]!)) start -= 1;
  let end = matchIndex + matchLength;
  while (end < value.length && !clauseBoundary.test(value[end]!)) end += 1;
  return value.slice(start, end).trim();
}

function promptWizardClaimConcepts(value: string) {
  return new Set(
    PROMPT_WIZARD_CLAIM_CONCEPTS
      .filter(([, pattern]) => pattern.test(value.normalize('NFKC')))
      .map(([concept]) => concept),
  );
}

function promptWizardClaimContext(value: string, claim: string) {
  return normalizeClaimText(value)
    .replaceAll(claim, '')
    .replace(/(?:支持|具备|拥有|采用|达到|可达|最高|长达|约|超过|提供|效果|表现|功能|能力|supports?|with|up\s*to|provides?|offers?|feature[sd]?)/giu, '')
    .replace(/[^\p{Script=Han}\p{Script=Latin}\d]+/gu, '');
}

function promptWizardClaimContextOverlaps(left: string, right: string) {
  const leftLatin = new Set(left.match(/\p{Script=Latin}{3,}/gu) ?? []);
  if ((right.match(/\p{Script=Latin}{3,}/gu) ?? []).some(token => leftLatin.has(token))) {
    return true;
  }
  const leftHan = new Set(promptWizardHanBigrams(left));
  return promptWizardHanBigrams(right).some(token => leftHan.has(token));
}

function promptWizardHanBigrams(value: string) {
  const han = (value.match(/\p{Script=Han}/gu) ?? []).join('');
  return Array.from({ length: Math.max(0, han.length - 1) }, (_, index) => (
    han.slice(index, index + 2)
  ));
}

function normalizeClaimText(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/hours?/gu, '小时')
    .replace(/minutes?/gu, '分钟')
    .replace(/days?/gu, '天');
}

function formatSecond(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function promptError(message: string, code: string, details?: { fieldPaths?: string[] }) {
  const fieldPaths = details?.fieldPaths
    ? Array.from(new Set(details.fieldPaths)).slice(0, 24)
    : undefined;
  return Object.assign(new Error(message), { code }, fieldPaths ? { fieldPaths } : undefined);
}

export function expectedPromptWizardSegmentCount(durationSeconds: 5 | 10 | 15) {
  return promptWizardTimeline(durationSeconds).length;
}

export function expectedPromptWizardSegmentCountV6(durationSeconds: 5 | 10 | 15) {
  return promptWizardTimelineV6(durationSeconds).length;
}
