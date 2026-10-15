import type { PromptWizardCreativeBrief } from '@lindyson/api-contracts';
import type { PromptWizardPlanIndex } from './promptWizardPlanCount.js';
import type { PromptWizardStrategy } from './promptWizardStrategy.js';
import type { PromptWizardConceptAssignment } from './promptWizardConceptContext.js';

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

const PLAN_ORDINAL_LABELS = ['一', '二', '三'] as const;

/**
 * 名称命中未经确认商业主张时，不再让模型自由改写标题。标题只使用服务端
 * 分配的方向与创意轴标签，避免引入产品功效、价格、认证或社会证明。
 */
export function buildPromptWizardSafeTitle(input: {
  direction: PromptWizardCreativeBrief['direction'];
  strategy: PromptWizardStrategy;
  planIndex: PromptWizardPlanIndex;
  reservedNames?: Iterable<string>;
}) {
  const reserved = new Set(
    Array.from(input.reservedNames ?? [], value => value.normalize('NFKC').trim()),
  );
  const base = [
    DIRECTION_LABELS[input.direction],
    input.strategy.hookType,
    input.strategy.sceneFamily,
    input.strategy.cameraGrammar,
  ].join(' · ');
  if (!reserved.has(base)) return base;

  const ordinalTitle = `${base} · 方案${PLAN_ORDINAL_LABELS[input.planIndex]}`;
  if (!reserved.has(ordinalTitle)) return ordinalTitle;

  // 末尾数字是服务端索引而非产品事实，作为最后的
  // 确定性去重键。分支正常不会触发，但可防御历史标题与两个候选都冲突。
  return `${ordinalTitle}-${input.planIndex + 1}`;
}

/**
 * Hook 是唯一命中未经确认商业主张的字段时，使用服务端已经分配的创意轴
 * 生成不含产品功效、价格、认证或社会证明的中性切口。结果仍必须重新经过
 * 完整事实、语言、时间轴与差异门禁；该函数不是商业事实白名单。
 */
export function buildPromptWizardSafeHook(input: {
  strategy: PromptWizardStrategy;
  conceptAssignment?: PromptWizardConceptAssignment;
}) {
  if (input.conceptAssignment) {
    return `在${input.conceptAssignment.scene}以${input.conceptAssignment.perspective}捕捉具体产品操作，用${input.strategy.hookType}建立观看问题`;
  }
  return `以${input.strategy.hookType}切入${input.strategy.sceneFamily}，通过${input.strategy.cameraGrammar}呈现人物与产品的真实互动`;
}
