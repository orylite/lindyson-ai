import { Building2,Crown,Gem,Rocket,Sparkles,Zap,type LucideIcon } from 'lucide-react';
import type { AdminPlan,PlanIconKey } from './admin';

export interface PlanIconOption {
  key: PlanIconKey;
  label: string;
  icon: LucideIcon;
}

export const PLAN_ICON_OPTIONS: PlanIconOption[] = [
  { key: 'zap', label: '闪电', icon: Zap },
  { key: 'sparkles', label: '星光', icon: Sparkles },
  { key: 'crown', label: '皇冠', icon: Crown },
  { key: 'gem', label: '宝石', icon: Gem },
  { key: 'rocket', label: '火箭', icon: Rocket },
  { key: 'building-2', label: '企业楼宇', icon: Building2 },
];

const PLAN_ICON_OPTION_MAP = new Map(PLAN_ICON_OPTIONS.map(option => [option.key, option]));

type PlanIdentity = Pick<AdminPlan, 'code' | 'recommendation'> & Partial<Pick<AdminPlan, 'name' | 'nameEn'>>;

export function isPlanIconKey(value: unknown): value is PlanIconKey {
  return typeof value === 'string' && PLAN_ICON_OPTION_MAP.has(value as PlanIconKey);
}

export function getPlanIconOption(iconKey: PlanIconKey | null | undefined) {
  return PLAN_ICON_OPTION_MAP.get(iconKey ?? 'sparkles') ?? PLAN_ICON_OPTION_MAP.get('sparkles')!;
}

export function getPlanIconGradientClass(
  iconKey: PlanIconKey | 'coins' | null | undefined,
  fallback: string,
) {
  return iconKey === 'building-2' || iconKey === 'coins'
    ? 'from-orange-500 to-red-600'
    : fallback;
}

export function isEnterprisePlan(plan: PlanIdentity) {
  const codeTokens = plan.code.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const name = plan.name?.trim() ?? '';
  const nameEn = plan.nameEn?.trim().toLowerCase() ?? '';

  return plan.recommendation === 'enterprise'
    || codeTokens.includes('enterprise')
    || codeTokens.includes('ent')
    || name.startsWith('企业')
    || nameEn === 'enterprise'
    || nameEn.startsWith('enterprise ');
}

export function getPlanIconGradientForPlan(
  plan: Pick<AdminPlan, 'kind' | 'code' | 'recommendation' | 'iconKey'> & Partial<Pick<AdminPlan, 'name' | 'nameEn'>>,
) {
  if (plan.kind === 'addon' || isEnterprisePlan(plan)) {
    return 'from-orange-500 to-red-600';
  }
  return 'from-purple-600 to-blue-600';
}

export function resolvePlanIconKey(
  iconKey: unknown,
  plan: Pick<AdminPlan, 'kind' | 'code' | 'recommendation'> & Partial<Pick<AdminPlan, 'name' | 'nameEn'>>,
): PlanIconKey | null {
  if (plan.kind === 'addon') return null;
  if (isPlanIconKey(iconKey)) return iconKey;

  const code = plan.code.trim().toLowerCase();
  if (isEnterprisePlan(plan)) return 'building-2';
  if (code === 'free' || code === 'basic') return 'zap';
  if (code === 'ultra') return 'crown';
  if (plan.recommendation === 'popular' || code === 'pro') return 'sparkles';
  return 'sparkles';
}
