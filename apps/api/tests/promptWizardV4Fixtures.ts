import type {
  PromptWizardConceptPreview,
  PromptWizardCreativeBrief,
  PromptWizardProductProfile,
  PromptWizardVideoConfig,
} from '@lindyson/api-contracts';
import {
  conceptPreviewToAssignment,
} from '../src/domain/promptWizardConceptDirector.js';
import { buildPromptWizardEvidenceGraph } from '../src/domain/promptWizardEvidenceGraph.js';
import type { PromptWizardPlanDraft } from '../src/domain/promptWizardPrompt.js';
import {
  allocatePromptWizardStrategies,
  type PromptWizardStrategy,
} from '../src/domain/promptWizardStrategy.js';
import { PROMPT_WIZARD_PLAN_INDEXES } from '../src/domain/promptWizardPlanCount.js';

export function makePromptWizardV4Selection(input: {
  runId: string;
  ordinal: number;
  profile: PromptWizardProductProfile;
  brief: PromptWizardCreativeBrief;
  config: PromptWizardVideoConfig;
  strategies?: readonly PromptWizardStrategy[];
  drafts?: readonly PromptWizardPlanDraft[];
  previousStrategySignatures?: readonly string[];
}) {
  const evidenceGraph = buildPromptWizardEvidenceGraph(input.profile, 1);
  const strategies = input.strategies
    ? [...input.strategies]
    : allocatePromptWizardStrategies({
    runId: input.runId,
    ordinal: input.ordinal,
    previousSignatures: input.previousStrategySignatures ?? [],
    });
  const conceptPreviews = PROMPT_WIZARD_PLAN_INDEXES.map(planIndex => makeConceptPreview({
    planIndex,
    profile: input.profile,
    brief: input.brief,
    strategy: strategies[planIndex]!,
    evidenceGraph,
    draft: input.drafts?.[planIndex],
  }));
  return {
    evidenceGraph,
    strategies,
    conceptPreviews,
    conceptAssignments: conceptPreviews.map((preview, index) => (
      conceptPreviewToAssignment(preview, PROMPT_WIZARD_PLAN_INDEXES[index]!)
    )),
  };
}

function makeConceptPreview(input: {
  planIndex: 0 | 1;
  profile: PromptWizardProductProfile;
  brief: PromptWizardCreativeBrief;
  strategy: PromptWizardStrategy;
  evidenceGraph: ReturnType<typeof buildPromptWizardEvidenceGraph>;
  draft?: PromptWizardPlanDraft;
}): PromptWizardConceptPreview {
  const { planIndex, draft } = input;
  const preferredEvidenceId = draft?.segments
    .flatMap(segment => segment.evidenceRefs)
    .find(id => input.evidenceGraph.reliableEvidenceIds.includes(id));
  const evidenceId = preferredEvidenceId
    ?? input.evidenceGraph.reliableEvidenceIds[planIndex]
    ?? input.evidenceGraph.reliableEvidenceIds[0]
    ?? 'visible:1';
  const evidence = input.evidenceGraph.evidences.find(item => item.id === evidenceId);
  const proofText = evidence?.text ?? input.profile.visibleFacts[planIndex] ?? input.profile.structure;
  const defaults = planIndex === 0
    ? {
        firstSecondEvent: `人物从包中拿出${input.profile.productName}并立即展开可见结构`,
        viewerQuestion: '这个连续操作如何解决当下的使用问题？',
        tension: '人物在忙乱环境中需要快速完成取用动作',
        productAction: `人物按正确方式使用${input.profile.productName}并展示${proofText}`,
        visibleResult: `${proofText}在真实操作中清楚可见`,
        scene: '真实通勤现场',
        perspective: '人物视角手机跟拍',
        ctaCallback: '回到开场的取用问题，邀请观众继续核对产品细节。',
      }
    : {
        firstSecondEvent: `双手立即翻转${input.profile.productName}并把${proofText}推到镜头前`,
        viewerQuestion: '局部细节揭开后还会出现什么结构？',
        tension: '观众只看到局部轮廓，还无法判断完整产品状态',
        productAction: `双手转动产品并用近景验证${proofText}`,
        visibleResult: `完整产品轮廓与${proofText}同时稳定留在画面中`,
        scene: '定向柔光下的简洁桌面',
        perspective: '产品微距发现视角',
        ctaCallback: '回扣开场的细节悬念，让观众选择最想继续查看的结构。',
      };
  const firstSegment = draft?.segments[0];
  const proofSegment = draft?.segments.find(segment => (
    segment.role === 'proof' || segment.role === 'proof-resolution'
  ));
  const resultSegment = draft?.segments.find(segment => (
    segment.role === 'resolution' || segment.role === 'proof-resolution'
  ));
  const ctaSegment = draft?.segments.at(-1);
  return {
    id: `00000000-0000-4000-8000-${String(700 + planIndex).padStart(12, '0')}`,
    role: planIndex === 0 ? 'reliable-conversion' : 'creative-breakthrough',
    title: draft?.name ?? `3.0 产品专属路线 ${planIndex + 1}`,
    firstSecondEvent: firstSegment?.action ?? defaults.firstSecondEvent,
    viewerQuestion: draft?.hook ?? defaults.viewerQuestion,
    // 扩写门禁要求购买理由在结构化脚本中可找回。有 Draft 时
    // 直接使用其表层需求；无 Draft 时则使用可追溯的证据文本。
    purchaseReason: draft?.planningReview.surfaceNeed ?? proofText,
    tension: draft?.planningReview.realPainPoint ?? defaults.tension,
    productAction: proofSegment?.action ?? defaults.productAction,
    visibleResult: resultSegment?.action ?? defaults.visibleResult,
    evidenceIds: [evidenceId],
    scene: firstSegment?.location ?? defaults.scene,
    perspective: draft?.cameraAndPacing ?? defaults.perspective,
    cameraGrammar: draft?.cameraAndPacing ?? input.strategy.cameraGrammar,
    ctaCallback: ctaSegment?.action ?? defaults.ctaCallback,
    requiredAssets: ['产品参考图片'],
    difficulty: 'low',
    risk: 'low',
    direction: input.brief.direction,
    strategy: input.strategy,
    productionLoad: {
      locationCount: 1,
      personCount: 1,
      majorActionCount: 1,
      propCount: 0,
      cameraMoveCount: 1,
      hasMagicTransition: false,
    },
    rank: planIndex + 1,
  };
}
