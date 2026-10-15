import type { PromptWizardPlan } from '@lindyson/api-contracts';
import { PROMPT_WIZARD_PLAN_COUNT, PROMPT_WIZARD_V6_PLAN_COUNT } from './promptWizardPlanCount.js';
import { countDifferentStrategyAxes, strategySignature } from './promptWizardStrategy.js';

export const PROMPT_WIZARD_MAX_JACCARD = 0.45;
export const PROMPT_WIZARD_MIN_SIMHASH_DISTANCE = 10;

export interface PromptWizardDiversityIssue {
  planIndexes: [number, number];
  reason: string;
}

export function validatePromptWizardPlanDiversity(plans: PromptWizardPlan[]) {
  const issues: PromptWizardDiversityIssue[] = [];
  const isV6Batch = plans.length > 0 && plans.every(plan => plan.deliveryVersion === 6);
  const expectedCount = isV6Batch ? PROMPT_WIZARD_V6_PLAN_COUNT : PROMPT_WIZARD_PLAN_COUNT;
  if (plans.length !== expectedCount) {
    issues.push({
      planIndexes: [0, Math.max(0, plans.length - 1)],
      reason: isV6Batch ? 'V6 必须返回三个商业角色方案' : '历史批次必须返回两个方案',
    });
    return issues;
  }

  if (isV6Batch) return validatePromptWizardPlanV6Diversity(plans);

  const isUseDirectionBatch = plans.every(isPromptWizardPlanV5);
  if (!isUseDirectionBatch) {
    const signatures = plans.map(plan => (
      plan.deliveryVersion === 4
        ? strategySignature(plan.strategy)
        : plan.deliveryVersion === 5 ? `v5:${plan.variant}` : `v6:${plan.role}`
    ));
    if (new Set(signatures).size !== PROMPT_WIZARD_PLAN_COUNT) {
      issues.push({ planIndexes: [0, 1], reason: '策略签名重复' });
    }
  }

  for (let leftIndex = 0; leftIndex < plans.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < plans.length; rightIndex += 1) {
      const left = plans[leftIndex]!;
      const right = plans[rightIndex]!;
      if (left.deliveryVersion === 5 && right.deliveryVersion === 5) {
        const analysis = analyzePromptWizardUseDirectionPlanDifferences(left, right);
        if (analysis.count < 3) {
          issues.push({
            planIndexes: [leftIndex, rightIndex],
            reason: `易落地与强钩子方案只有 ${analysis.count} 项表现方式不同`,
          });
        }
      } else if (left.deliveryVersion === 4 && right.deliveryVersion === 4) {
        const differentAxes = countDifferentStrategyAxes(left.strategy, right.strategy);
        if (differentAxes < 4) {
          issues.push({
            planIndexes: [leftIndex, rightIndex],
            reason: `创意轴仅有 ${differentAxes} 项不同`,
          });
        }
      }

      // V5 有意共享购买理由、场景与证据。继续套用旧版正文相似度阈值会把
      // 正确的同方向 A/B 脚本误判为重复；V5 改由四项可观察表现差异门禁。
      if (!(left.deliveryVersion === 5 && right.deliveryVersion === 5)) {
        const leftBody = planCreativeComparisonBody(left);
        const rightBody = planCreativeComparisonBody(right);
        const jaccard = trigramJaccard(leftBody, rightBody);
        if (jaccard >= PROMPT_WIZARD_MAX_JACCARD) {
          issues.push({
            planIndexes: [leftIndex, rightIndex],
            reason: `创意正文 Jaccard 相似度 ${jaccard.toFixed(3)} 过高`,
          });
        }
        const distance = simHashHammingDistance(leftBody, rightBody);
        if (distance < PROMPT_WIZARD_MIN_SIMHASH_DISTANCE) {
          issues.push({
            planIndexes: [leftIndex, rightIndex],
            reason: `创意正文 SimHash 汉明距离 ${distance} 过低`,
          });
        }
      }
    }
  }
  return issues;
}

function isPromptWizardPlanV5(
  plan: PromptWizardPlan,
): plan is Extract<PromptWizardPlan, { deliveryVersion: 5 }> {
  return plan.deliveryVersion === 5;
}

export function validatePromptWizardPlanV6Diversity(
  plans: Extract<PromptWizardPlan, { deliveryVersion: 6 }>[],
) {
  const issues: PromptWizardDiversityIssue[] = [];
  if (plans.length !== PROMPT_WIZARD_V6_PLAN_COUNT) {
    return [{
      planIndexes: [0, Math.max(0, plans.length - 1)] as [number, number],
      reason: 'V6 必须返回三个商业角色方案',
    }];
  }
  const roles = new Set(plans.map(plan => plan.role));
  if (roles.size !== PROMPT_WIZARD_V6_PLAN_COUNT) {
    issues.push({ planIndexes: [0, 2], reason: '三个方案必须覆盖产品自证、痛点钩子、场景种草' });
  }
  for (let leftIndex = 0; leftIndex < plans.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < plans.length; rightIndex += 1) {
      const left = plans[leftIndex]!;
      const right = plans[rightIndex]!;
      const leftFirst = left.shots[0];
      const rightFirst = right.shots[0];
      if (!meaningfullyDifferentV6(leftFirst?.action ?? left.hookZh, rightFirst?.action ?? right.hookZh)) {
        issues.push({ planIndexes: [leftIndex, rightIndex], reason: 'V6 两个方案的开场事件实质相同' });
      }
      const axes = [
        meaningfullyDifferentV6(
          `${left.selectedScene.title}${left.selectedScene.environment}`,
          `${right.selectedScene.title}${right.selectedScene.environment}`,
        ),
        meaningfullyDifferentV6(
          `${left.purchaseReasonZh}${left.shots.slice(1, -1).map(shot => shot.action).join('')}`,
          `${right.purchaseReasonZh}${right.shots.slice(1, -1).map(shot => shot.action).join('')}`,
        ),
        meaningfullyDifferentV6(
          `${leftFirst?.shotSize ?? ''}${leftFirst?.cameraMovement ?? ''}`,
          `${rightFirst?.shotSize ?? ''}${rightFirst?.cameraMovement ?? ''}`,
        ),
        meaningfullyDifferentV6(
          `${left.cameraAndPacing}${left.shots.map(shot => shot.editingCue).join('')}`,
          `${right.cameraAndPacing}${right.shots.map(shot => shot.editingCue).join('')}`,
        ),
        meaningfullyDifferentV6(
          `${left.shots.at(-1)?.action ?? ''}${left.shots.at(-1)?.voiceover ?? ''}`,
          `${right.shots.at(-1)?.action ?? ''}${right.shots.at(-1)?.voiceover ?? ''}`,
        ),
      ].filter(Boolean).length;
      if (axes < 3) {
        issues.push({
          planIndexes: [leftIndex, rightIndex],
          reason: `V6 场景、自证动作、镜头语法、节奏、CTA 仅有 ${axes} 项实质差异`,
        });
      }
    }
  }
  return issues;
}

function meaningfullyDifferentV6(left: string, right: string) {
  return normalizePromptText(left) !== normalizePromptText(right)
    && trigramJaccard(left, right) < 0.72;
}

export function validatePromptWizardPlanHistory(
  plans: PromptWizardPlan[],
  historicalPlans: PromptWizardPlan[],
) {
  const issues: PromptWizardDiversityIssue[] = [];
  const historicalSignatures = new Set(historicalPlans.map(promptWizardPlanSignature));
  plans.forEach((plan, planIndex) => {
    const signature = promptWizardPlanSignature(plan);
    // V5 刷新会继续使用同一方向、场景和 A/B 类型；这些字段相同不是重复创意。
    // 新版只比较实际分镜正文，历史策略签名门禁仅服务于 V4。
    if (plan.deliveryVersion === 4 && historicalSignatures.has(signature)) {
      issues.push({ planIndexes: [planIndex, planIndex], reason: '策略签名与当前任务历史批次重复' });
    }
    historicalPlans.forEach(historical => {
      // V6 的三个商业角色是固定且互斥的历史赛道；跨角色差异已经由同批
      // V6 diversity 门禁强制。换批历史只比较相同角色，否则服务端锁定的
      // 角色会让一个新“产品自证”方案与旧“痛点钩子”方案发生伪碰撞。
      if (
        plan.deliveryVersion === 6
        && historical.deliveryVersion === 6
        && plan.role !== historical.role
      ) return;
      const jaccard = trigramJaccard(
        planCreativeComparisonBody(plan),
        planCreativeComparisonBody(historical),
      );
      const distance = simHashHammingDistance(
        planCreativeComparisonBody(plan),
        planCreativeComparisonBody(historical),
      );
      if (jaccard >= PROMPT_WIZARD_MAX_JACCARD || distance < PROMPT_WIZARD_MIN_SIMHASH_DISTANCE) {
        issues.push({
          planIndexes: [planIndex, planIndex],
          reason: `方案 ${planIndex + 1} 与当前任务历史批次过于相似`,
        });
      }
    });
  });
  return issues;
}

function promptWizardPlanSignature(plan: PromptWizardPlan) {
  if (plan.deliveryVersion === 4) return strategySignature(plan.strategy);
  if (plan.deliveryVersion === 5) {
    return `v5:${plan.useDirection.id}:${plan.selectedScene.id ?? plan.selectedScene.title}:${plan.variant}`;
  }
  return `v6:${plan.role}:${plan.selectedScene.id ?? plan.selectedScene.title}`;
}

export function creativeBody(prompt: string) {
  return prompt.split('【产品一致性硬约束】', 1)[0] ?? prompt;
}

export function planCreativeComparisonBody(plan: PromptWizardPlan) {
  // 只比较真正承载创意差异的
  // 摘要、创意路线、预审切口与场景动作。
  // 产品主体、固定景别/光线、职责型 Foley 和剪辑模板由服务端蓝图重复注入，
  // 把它们混入 SimHash 会让不同方案被模板噪声错误拉近。
  const commonParts = [
    plan.name,
    plan.deliveryVersion === 6 ? plan.hookZh : plan.hook,
    plan.narrative,
    plan.primaryScene,
    plan.cameraAndPacing,
    ...plan.differenceTags,
    ...plan.shots.flatMap(shot => [
      shot.location,
      shot.action,
    ]),
  ];
  if (plan.deliveryVersion === 5) {
    // V5 的使用方向、具体场景、唯一购买理由和证据由用户在批次前锁定，
    // 付费“换一批”仍应继续服务同一选择。历史差异只比较能够变化的
    // 表达层：开场事件、观看视角、镜头运动、剪辑节奏和 CTA 回扣。
    // 将固定输入混入正文会把合格刷新误判为重复，也会诱导 Provider
    // 为了过门禁擅自更换购买理由或场景。
    const firstShot = plan.shots[0];
    const lastShot = plan.shots.at(-1);
    const lockedValues = [
      plan.useDirection.title,
      plan.useDirection.useMoment,
      plan.useDirection.audienceNeed,
      plan.useDirection.purchaseReason,
      plan.useDirection.proofAction,
      plan.selectedScene.title,
      plan.selectedScene.environment,
      plan.selectedScene.mainAction,
    ];
    return [
      plan.name,
      plan.hook,
      plan.narrative,
      plan.cameraAndPacing,
      ...plan.differenceTags,
      firstShot?.action ?? '',
      firstShot?.shotSize ?? '',
      firstShot?.cameraMovement ?? '',
      firstShot?.editingCue ?? '',
      lastShot?.action ?? '',
      lastShot?.cameraMovement ?? '',
      lastShot?.editingCue ?? '',
    ]
      .map(value => stripPromptWizardLockedValues(value, lockedValues))
      .filter(Boolean)
      .join('\n');
  }
  if (plan.deliveryVersion === 6) {
    // V6 的三个商业角色、购买理由、证据、推荐场景与卡片中文说明在路线
    // 预生成阶段已经锁定；付费“换一批”会复用同一 RouteSet，只改写分镜
    // 表达。历史门禁若把这些固定输入计入正文，会在真实表达已经变化时仍
    // 把同角色方案误判为重复。这里与 V5 一样只比较 Provider 能够改写的
    // 表达层，同时保留原有 Jaccard/SimHash 阈值；批内三角色差异仍由
    // validatePromptWizardPlanV6Diversity 独立、完整地强制执行。
    const routeTitle = plan.prompt.match(/^【商业路线】([^\n]+)/u)?.[1]?.trim() ?? '';
    const lockedValues = [
      routeTitle,
      plan.directionExplanationZh,
      plan.audienceZh,
      plan.purchaseReasonZh,
      plan.hookZh,
      plan.selectedScene.title,
      plan.selectedScene.environment,
      plan.selectedScene.mainAction,
      ...plan.claimBasisTags.map(tag => tag.labelZh),
    ];
    return [
      // Provider 首稿 hook 只参与当前 Draft 编译，公开 V6 Plan 不持久化该
      // 内部字段；route.hookZh 是服务端锁定元数据，不能冒充换批创意差异。
      ...plan.shots.flatMap(shot => [
        shot.shotSize,
        ...(shot.role === 'cta' ? [shot.action] : []),
        shot.cameraMovement,
        shot.lightingAndRealism,
        shot.foley,
        shot.editingCue,
        shot.voiceover,
        shot.voiceoverZh,
      ]),
    ]
      .map(value => stripPromptWizardLockedValues(value, lockedValues))
      .filter(Boolean)
      .join('\n');
  }
  return [
    ...commonParts,
    plan.concept.firstSecondEvent,
    plan.concept.purchaseReason,
    ...plan.concept.evidenceIds,
    plan.planningReview.realPainPoint,
    plan.planningReview.nonAdEntry,
    plan.planningReview.directionFit,
  ].join('\n');
}

function stripPromptWizardLockedValues(value: string, lockedValues: string[]) {
  return lockedValues
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .reduce((result, locked) => result.split(locked).join(''), value)
    .trim();
}

export interface PromptWizardUseDirectionDifferenceAnalysis {
  openingEvent: boolean;
  perspective: boolean;
  pacing: boolean;
  cta: boolean;
  count: number;
}

/**
 * V5 A/B 的唯一权威四维差异分析器。服务端修复反馈、最终门禁和两轮后的
 * 确定性安全收口都必须复用该结果，禁止分别解析中文错误原因或另写阈值。
 */
export function analyzePromptWizardUseDirectionPlanDifferences(
  left: Extract<PromptWizardPlan, { deliveryVersion: 5 }>,
  right: Extract<PromptWizardPlan, { deliveryVersion: 5 }>,
): PromptWizardUseDirectionDifferenceAnalysis {
  const leftFirst = left.shots[0];
  const rightFirst = right.shots[0];
  const leftLast = left.shots.at(-1);
  const rightLast = right.shots.at(-1);
  const meaningfullyDifferent = (a: string, b: string, threshold = 0.55) => (
    normalizePromptText(a) !== normalizePromptText(b)
    && trigramJaccard(a, b) < threshold
  );
  const perspectivePatterns = [
    ['pov', /(?:第一视角|主观视角|POV)/iu],
    ['overhead', /(?:俯拍|顶拍|鸟瞰)/u],
    ['macro', /(?:微距|极近景|细节特写)/u],
    ['handheld', /(?:手持|跟拍)/u],
    ['locked', /(?:固定机位|静止机位)/u],
    ['orbit', /(?:环绕|绕拍)/u],
  ] as const;
  const pacingPatterns = [
    ['fast', /(?:快切|快速|加速|高密度)/u],
    ['slow', /(?:慢速|放慢|舒缓|缓慢)/u],
    ['continuous', /(?:一镜到底|连续动作|不切镜)/u],
    ['pause', /(?:停顿|定格|停留)/u],
    ['reveal', /(?:揭晓|反转|突然切入)/u],
  ] as const;
  const signature = (
    value: string,
    patterns: readonly (readonly [string, RegExp])[],
  ) => new Set(patterns.filter(([, pattern]) => pattern.test(value)).map(([name]) => name));
  const categoryDifferent = (
    leftValue: string,
    rightValue: string,
    patterns: readonly (readonly [string, RegExp])[],
  ) => {
    const leftSignature = signature(leftValue, patterns);
    const rightSignature = signature(rightValue, patterns);
    if (leftSignature.size > 0 && rightSignature.size > 0) {
      return [...leftSignature].every(value => !rightSignature.has(value));
    }
    return meaningfullyDifferent(leftValue, rightValue, 0.45);
  };
  const leftPerspective = `${leftFirst?.subject ?? ''}${leftFirst?.shotSize ?? ''}${leftFirst?.cameraMovement ?? ''}`;
  const rightPerspective = `${rightFirst?.subject ?? ''}${rightFirst?.shotSize ?? ''}${rightFirst?.cameraMovement ?? ''}`;
  const leftPacing = `${left.cameraAndPacing}${left.shots.map(shot => shot.editingCue).join('')}`;
  const rightPacing = `${right.cameraAndPacing}${right.shots.map(shot => shot.editingCue).join('')}`;
  const lockedValues = [
    left.useDirection.title,
    left.useDirection.useMoment,
    left.useDirection.audienceNeed,
    left.useDirection.purchaseReason,
    left.useDirection.proofAction,
    left.selectedScene.title,
    left.selectedScene.environment,
    left.selectedScene.mainAction,
  ];
  const unlocked = (value: string) => stripPromptWizardLockedValues(value, lockedValues);
  const openingEvent = meaningfullyDifferent(
    unlocked(leftFirst?.action ?? ''),
    unlocked(rightFirst?.action ?? ''),
  );
  const perspective = categoryDifferent(
    leftPerspective,
    rightPerspective,
    perspectivePatterns,
  );
  const pacing = categoryDifferent(leftPacing, rightPacing, pacingPatterns);
  const cta = meaningfullyDifferent(
    unlocked(`${leftLast?.action ?? ''}${leftLast?.voiceover ?? ''}`),
    unlocked(`${rightLast?.action ?? ''}${rightLast?.voiceover ?? ''}`),
  );
  return {
    openingEvent,
    perspective,
    pacing,
    cta,
    count: [openingEvent, perspective, pacing, cta].filter(Boolean).length,
  };
}

export function normalizePromptText(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？；：“”‘’、,.!?;:'"`()\[\]{}<>【】]/g, '');
}

export function trigramJaccard(left: string, right: string) {
  const leftSet = characterNgrams(normalizePromptText(left), 3);
  const rightSet = characterNgrams(normalizePromptText(right), 3);
  if (leftSet.size === 0 && rightSet.size === 0) return 1;
  let intersection = 0;
  for (const gram of leftSet) if (rightSet.has(gram)) intersection += 1;
  const union = leftSet.size + rightSet.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

export function simHashHammingDistance(left: string, right: string) {
  return popcount64(simHash64(left) ^ simHash64(right));
}

function simHash64(value: string) {
  const tokens = [...characterNgrams(normalizePromptText(value), 3)];
  const weights = Array.from({ length: 64 }, () => 0);
  for (const token of tokens) {
    const hash = fnv1a64(token);
    for (let bit = 0; bit < 64; bit += 1) {
      weights[bit] = weights[bit]! + (((hash >> BigInt(bit)) & 1n) === 1n ? 1 : -1);
    }
  }
  return weights.reduce(
    (hash, weight, bit) => weight >= 0 ? hash | (1n << BigInt(bit)) : hash,
    0n,
  );
}

function fnv1a64(value: string) {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash;
}

function popcount64(value: bigint) {
  let count = 0;
  let remaining = BigInt.asUintN(64, value);
  while (remaining !== 0n) {
    remaining &= remaining - 1n;
    count += 1;
  }
  return count;
}

function characterNgrams(value: string, size: number) {
  const characters = Array.from(value);
  const grams = new Set<string>();
  if (characters.length < size) {
    if (characters.length > 0) grams.add(characters.join(''));
    return grams;
  }
  for (let index = 0; index <= characters.length - size; index += 1) {
    grams.add(characters.slice(index, index + size).join(''));
  }
  return grams;
}
