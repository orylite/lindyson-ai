import { randomUUID } from 'node:crypto';
import {
  promptWizardRouteSetV6Schema,
  type PromptWizardClaimBasisTag,
  type PromptWizardEvidence,
  type PromptWizardEvidenceGraph,
  type PromptWizardProductProfile,
  type PromptWizardProductionBrief,
  type PromptWizardRoutePlanContextV6,
  type PromptWizardRouteRole,
  type PromptWizardRouteSetV6,
  type PromptWizardRouteV6,
} from '@lindyson/api-contracts';
import type { PromptWizardRouteDraftPlanContext } from '../providers/promptWizardProvider.js';

export const PROMPT_WIZARD_V6_ROUTE_ROLES = [
  'proof-conversion',
  'problem-hook',
  'lifestyle-seeding',
] as const satisfies readonly PromptWizardRouteRole[];

const HIGH_RISK_INFERENCE_PATTERN = /(?:价格|优惠|折扣|促销|赠品|包邮|材质|成分|认证|医疗|治疗|健康|安全|防水|防尘|耐用|续航|容量|功率|尺寸|重量|百分比|倍|绝对|最佳|第一|竞品|胜过|无毒|抗菌|低敏|敏感肌|保证|永久|零风险|\d)/iu;

/** Zod 的字符串 max 使用 UTF-16 长度；遍历码点可避免在上限处切断代理对。 */
function promptWizardBoundedText(value: string, maxLength: number) {
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  let result = '';
  for (const character of normalized) {
    if (result.length + character.length > maxLength) break;
    result += character;
  }
  return result.trim();
}

/**
 * 只允许由品类推出“产品通常用来做什么”这一层普通功能。这里故意采用
 * 封闭词表，绝不根据图片推测规格、材质、功效、安全或促销。
 */
export function inferPromptWizardOrdinaryCategoryFunction(
  profile: PromptWizardProductProfile,
  graph?: PromptWizardEvidenceGraph,
) {
  const category = `${profile.productName} ${profile.category}`;
  let claim = '';
  if (/(?:耳机|耳麦|音箱|扬声器)/iu.test(category)) claim = '可用于日常聆听音频';
  else if (/(?:眼影|彩妆|口红|唇釉|粉底|遮瑕)/iu.test(category)) claim = '可用于日常彩妆上妆';
  else if (/(?:裤|紧身裤|服装|女装|男装|上衣|裙|鞋|帽)/iu.test(category)) claim = '可用于日常穿着或搭配';
  else if (/(?:戒指|项链|耳环|手链|首饰|珠宝|配饰)/iu.test(category)) claim = '可用于日常佩戴和造型搭配';
  else if (/(?:喂食器|饮水器|食盆|水碗|宠物碗)/iu.test(category)) claim = '可用于放置宠物食物或饮水';
  else if (/(?:杯|碗|盘|收纳|置物|灯|家居|厨房)/iu.test(category)) claim = '可用于对应的日常家居场景';
  else if (graph?.productFamily === 'beauty-personal-care') claim = '可用于对应的日常美妆或个护步骤';
  else if (graph?.productFamily === 'apparel-accessories') claim = '可用于日常穿戴或造型搭配';
  else if (graph?.productFamily === 'consumer-electronics') claim = '可用于对应的日常电子产品使用场景';
  else if (graph?.productFamily === 'home-living') claim = '可用于对应的日常家居场景';
  if (!claim || HIGH_RISK_INFERENCE_PATTERN.test(claim)) return null;
  return claim;
}

/** 第一步商品摘要与第三步路线共用的唯一品类常识来源。 */
export function inferPromptWizardOrdinaryCategoryFunctions(
  profile: PromptWizardProductProfile,
  graph?: PromptWizardEvidenceGraph,
) {
  const claim = inferPromptWizardOrdinaryCategoryFunction(profile, graph);
  return claim ? [claim] : [];
}

export function buildPromptWizardRouteSetV6(input: {
  id: string;
  runId: string;
  runRevision: number;
  profile: PromptWizardProductProfile;
  evidenceGraph: PromptWizardEvidenceGraph;
  productionBrief: PromptWizardProductionBrief;
  createdAt?: string;
}): PromptWizardRouteSetV6 {
  const reliable = promptWizardReliableRouteEvidence(input.evidenceGraph);
  if (reliable.length === 0) {
    throw Object.assign(new Error('缺少可追溯的商品证据，无法生成三方向方案'), {
      code: 'PROMPT_WIZARD_V6_EVIDENCE_REQUIRED',
    });
  }
  const inference = inferPromptWizardOrdinaryCategoryFunctions(
    input.profile,
    input.evidenceGraph,
  )[0] ?? null;
  const sceneCandidates = promptWizardSceneCandidates(input.profile, input.productionBrief);
  const routes = PROMPT_WIZARD_V6_ROUTE_ROLES.map((role, index) => buildRoute({
    role,
    index,
    profile: input.profile,
    productionBrief: input.productionBrief,
    evidence: reliable[index % reliable.length]!,
    inference,
    scene: sceneCandidates[index]!,
  }));
  const createdAt = input.createdAt ?? new Date().toISOString();
  return promptWizardRouteSetV6Schema.parse({
    id: input.id,
    runId: input.runId,
    status: 'completed',
    runRevision: input.runRevision,
    routes,
    failureReason: null,
    createdAt,
    completedAt: new Date().toISOString(),
  });
}

function buildRoute(input: {
  role: PromptWizardRouteRole;
  index: number;
  profile: PromptWizardProductProfile;
  productionBrief: PromptWizardProductionBrief;
  evidence: PromptWizardEvidence;
  inference: string | null;
  scene: { title: string; environment: string };
}): PromptWizardRouteV6 {
  const rawProductName = input.profile.productName.trim();
  const productName = rawProductName && rawProductName.length <= 120
    ? rawProductName
    : '参考图片中的商品';
  const proofAction = promptWizardBoundedText(
    promptWizardProofAction(input.evidence, productName, input.index),
    500,
  );
  const purchaseReason = promptWizardBoundedText(
    promptWizardPurchaseReason(input.evidence, input.inference),
    500,
  );
  const copy = routeCopy(input.role, productName, purchaseReason, proofAction, input.scene.title);
  const evidenceTag: PromptWizardClaimBasisTag = {
    labelZh: input.evidence.text,
    basis: input.evidence.status === 'user-confirmed' ? 'user-confirmed' : 'visible',
    evidenceRefs: [input.evidence.id],
  };
  const claimBasisTags = [
    evidenceTag,
    ...(input.inference ? [{
      labelZh: input.inference,
      basis: 'category-inferred' as const,
      evidenceRefs: [],
    }] : []),
  ];
  return {
    id: randomUUID(),
    role: input.role,
    titleZh: copy.title,
    directionExplanationZh: copy.explanation,
    audienceZh: input.profile.suggestedAudience.trim().length <= 500
      ? input.profile.suggestedAudience.trim()
        || '正在寻找该品类商品、重视真实使用方式与可见细节的人群'
      : '正在寻找该品类商品、重视真实使用方式与可见细节的人群',
    purchaseReasonZh: purchaseReason,
    hookZh: promptWizardBoundedText(copy.hook, 300),
    proofActionZh: proofAction,
    recommendedScene: {
      id: null,
      title: input.scene.title,
      environment: input.scene.environment,
      mainAction: promptWizardBoundedText(copy.mainAction, 500),
    },
    appearanceMode: input.productionBrief.appearanceMode,
    claimBasisTags,
    evidenceRefs: [input.evidence.id],
    requiredAssets: Array.from(new Set([
      '现有商品参考图片',
      ...input.productionBrief.availableAssets,
    ])).slice(0, 20),
  };
}

function routeCopy(
  role: PromptWizardRouteRole,
  productName: string,
  purchaseReason: string,
  proofAction: string,
  sceneTitle: string,
) {
  if (role === 'proof-conversion') {
    return {
      title: promptWizardRouteTitle(`${productName}｜${purchaseReason}实拍自证`),
      explanation: promptWizardBoundedText(
        `第一秒让${productName}进入画面，用连续、可复现的操作证明“${purchaseReason}”，适合承接明确购买需求。`,
        500,
      ),
      hook: promptWizardBoundedText(`先别听形容词，直接看${productName}怎么用。`, 300),
      mainAction: promptWizardBoundedText(
        `${proofAction}，镜头保持连续并清楚展示商品主体。`,
        500,
      ),
    };
  }
  if (role === 'problem-hook') {
    return {
      title: promptWizardRouteTitle(`${sceneTitle}痛点｜${productName}现场解法`),
      explanation: promptWizardBoundedText(
        `从${sceneTitle}中的具体不便切入，先建立问题再让${productName}通过正确操作介入，只展示可观察的缓解。`,
        500,
      ),
      hook: '遇到这种使用时刻，别急着将就。',
      mainAction: promptWizardBoundedText(
        `先呈现一个与“${purchaseReason}”相关的真实使用不便，再${proofAction}。`,
        500,
      ),
    };
  }
  return {
    title: promptWizardRouteTitle(`${sceneTitle}种草｜${productName}自然融入`),
    explanation: promptWizardBoundedText(
      `把${productName}放进${sceneTitle}的真实生活节奏，用自然使用动作和环境反应建立“${purchaseReason}”的购买理由。`,
      500,
    ),
    hook: `我会在这个日常时刻顺手用到它。`,
    mainAction: promptWizardBoundedText(
      `在${sceneTitle}自然拿起并使用${productName}，随后${proofAction}。`,
      500,
    ),
  };
}

function promptWizardRouteTitle(value: string) {
  return promptWizardBoundedText(value, 80);
}

function promptWizardReliableRouteEvidence(graph: PromptWizardEvidenceGraph) {
  const reliableIds = new Set(graph.reliableEvidenceIds);
  const priorities: Record<PromptWizardEvidence['type'], number> = {
    usage: 0,
    structure: 1,
    'logo-print': 2,
    material: 3,
    capability: 4,
    other: 5,
    appearance: 6,
    'commercial-claim': 7,
    audience: 8,
    scenario: 9,
  };
  return graph.evidences
    .filter(evidence => reliableIds.has(evidence.id))
    .filter(evidence => evidence.status === 'visible' || evidence.status === 'user-confirmed')
    .filter(evidence => evidence.type !== 'commercial-claim' || evidence.status === 'user-confirmed')
    // V6 Draft 的可追溯证据正文上限是 300 个 UTF-16 码元、id 上限 80。
    // 过长事实不能在生成阶段截断，否则可能丢失限定词。
    .filter(evidence => evidence.id.length <= 80 && evidence.text.length <= 300)
    .sort((left, right) => priorities[left.type] - priorities[right.type]);
}

function promptWizardPurchaseReason(evidence: PromptWizardEvidence, inference: string | null) {
  if (evidence.type !== 'appearance' && evidence.type !== 'audience' && evidence.type !== 'scenario') {
    return evidence.text;
  }
  return inference ?? `镜头可清楚展示的商品外观与细节：${evidence.text}`;
}

function promptWizardProofAction(
  evidence: PromptWizardEvidence,
  productName: string,
  variant: number,
) {
  const existing = evidence.proofActions.find(Boolean);
  if (existing) return existing;
  if (variant === 1) return `拿起${productName}并完成一次正确使用动作，镜头跟随动作落点展示“${evidence.text}”。`;
  if (variant === 2) return `在真实场景中使用${productName}，随后以侧面近景展示“${evidence.text}”。`;
  return `将${productName}转向镜头，以稳定近景清楚展示“${evidence.text}”。`;
}

function promptWizardSceneCandidates(
  profile: PromptWizardProductProfile,
  productionBrief: PromptWizardProductionBrief,
) {
  const raw = [
    ...productionBrief.availableScenes,
    ...profile.suggestedScenarios.split(/[\r\n；;]+/u),
  ].map(value => value.trim()).filter(Boolean);
  const unique = Array.from(new Set(raw));
  const fallbacks = ['整洁产品展示区', '真实问题发生处', '日常生活使用区'];
  return fallbacks.map((fallback, index) => {
    const title = promptWizardRouteTitle(unique[index] ?? fallback);
    const environments = [
      `${title}，光线清楚、背景克制，商品主体始终可辨认`,
      `${title}，保留真实生活痕迹，并让问题与商品动作处于同一连续空间`,
      `${title}，自然环境光与轻量手机实拍感，商品自然融入人物动作`,
    ];
    return {
      title,
      environment: promptWizardBoundedText(environments[index]!, 300),
    };
  });
}

/** 将内部 V6 路线适配到成熟的逐方案分镜 Provider 输入，不暴露给客户端。 */
export function promptWizardRouteContextsV6(
  routeSet: PromptWizardRouteSetV6,
): PromptWizardRouteDraftPlanContext[] {
  return routeSet.routes.map((route, planIndex) => ({
    planIndex: planIndex as 0 | 1 | 2,
    routeRole: route.role,
    lockedHookZh: route.hookZh,
    variant: route.role === 'problem-hook' ? 'hook' : 'reliable',
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
        ? 'problem-solution'
        : route.role === 'lifestyle-seeding' ? 'ugc' : 'feature-test',
      requiredAssets: route.requiredAssets,
    },
    selectedScene: route.recommendedScene,
    ...(route.claimBasisTags.find(tag => tag.basis === 'category-inferred')?.labelZh
      ? { categoryInference: route.claimBasisTags.find(tag => tag.basis === 'category-inferred')!.labelZh }
      : {}),
  }));
}

export function promptWizardRoutePlanContextsV6(
  routeSet: PromptWizardRouteSetV6,
): PromptWizardRoutePlanContextV6[] {
  return routeSet.routes.map((route, planIndex) => ({
    planIndex: planIndex as 0 | 1 | 2,
    route,
  }));
}
