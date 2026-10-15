import { ArrowRight,Check,Coins,X } from 'lucide-react';
import type { AdminPlan,PlanIconKey } from '../data/admin';
import { getPlanIconGradientForPlan,getPlanIconOption,isEnterprisePlan } from '../data/planIcons';
import { getPortraitPlanBenefits } from '../data/realPortraits';
import { Button,Card } from '../ui';
import { formatCnyFromCents } from '../utils/currency';

export interface PlanCardVisual {
  icon: ReturnType<typeof getPlanIconOption>['icon'];
  iconKey: PlanIconKey | 'coins';
  badgeGradient: string;
  hoverBorder: string;
}

interface PlanCardProps {
  plan: AdminPlan;
  price: number;
  priceHelper?: string | null;
  featureLimit?: number;
  actionLabel: string;
  onAction: () => void;
  actionDisabled?: boolean;
  actionIcon?: boolean;
  className?: string;
}

export function getPlanRecommendationLabel(plan: AdminPlan) {
  if (plan.recommendation === 'popular') return '最受欢迎';
  if (plan.recommendation === 'enterprise') return '企业首选';
  return null;
}

export function getPlanCardVisual(plan: AdminPlan): PlanCardVisual {
  const iconOption = plan.kind === 'main' ? getPlanIconOption(plan.iconKey) : null;
  const icon = iconOption?.icon ?? Coins;
  const iconKey: PlanIconKey | 'coins' = iconOption?.key ?? 'coins';

  if (plan.code === 'free') {
    return {
      icon,
      iconKey,
      badgeGradient: 'from-gray-600 to-gray-500',
      hoverBorder: 'hover:border-white/20',
    };
  }

  if (isEnterprisePlan(plan)) {
    return {
      icon,
      iconKey,
      badgeGradient: 'from-orange-500 to-red-600',
      hoverBorder: 'hover:border-orange-400',
    };
  }

  return {
    icon,
    iconKey,
    badgeGradient: 'from-purple-600 to-blue-600',
    hoverBorder: 'hover:border-purple-400',
  };
}

export function PlanCard({
  plan,
  price,
  priceHelper,
  featureLimit,
  actionLabel,
  onAction,
  actionDisabled = false,
  actionIcon = true,
  className = '',
}: PlanCardProps) {
  const visual = getPlanCardVisual(plan);
  const Icon = visual.icon;
  const badge = getPlanRecommendationLabel(plan);
  const enterprise = isEnterprisePlan(plan);
  const features = featureLimit === undefined ? plan.features : plan.features.slice(0,featureLimit);

  return (
    <Card
      variant="interactive"
      accent={enterprise ? 'orange' : 'violet'}
      data-plan-card={plan.code}
      className={`plan-card-surface relative flex min-h-full flex-col p-6 ${visual.hoverBorder} ${className}`}
    >
      <div data-plan-card-header className="mb-4 flex h-10 items-start justify-between gap-3">
        <div data-plan-card-identity className="flex min-w-0 flex-1 items-center gap-3">
          <div
            data-plan-icon-key={visual.iconKey}
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${getPlanIconGradientForPlan(plan)}`}
          >
            <Icon className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <p title={plan.name} className="truncate font-semibold text-white">{plan.name}</p>
            <p title={plan.nameEn} className="truncate text-xs text-gray-500">{plan.nameEn}</p>
          </div>
        </div>
        {badge && (
          <div
            data-plan-recommendation-badge
            className={`flex-shrink-0 whitespace-nowrap rounded-full bg-gradient-to-r px-3 py-1 text-xs font-semibold text-white ${visual.badgeGradient}`}
          >
            {badge}
          </div>
        )}
      </div>

      <div data-plan-card-price className="mb-2 min-h-[3.75rem]">
        <div className="flex items-end gap-1">
          <span className="text-3xl font-bold text-white">{formatCnyFromCents(price)}</span>
          <span className="mb-1 text-sm text-gray-500">/月</span>
        </div>
        {priceHelper && <p className="mt-1 text-xs text-white">{priceHelper}</p>}
      </div>

      <p className="mb-5 min-h-10 text-xs leading-5 text-white">{plan.description}</p>

      <PlanCreditsSummary plan={plan} className="mb-3" />
      <PortraitEntitlementSummary plan={plan} className="mb-5" />

      <div className="mb-6 flex-1 space-y-2.5">
        {features.map(feature => (
          <div key={feature.text} className="flex items-center gap-2.5">
            {feature.enabled
              ? <Check className="h-4 w-4 flex-shrink-0 text-green-400" />
              : <X className="h-4 w-4 flex-shrink-0 text-gray-600" />}
            <span className="text-xs text-white">{feature.text}</span>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="pink"
        size="md"
        className={`w-full ${actionDisabled ? '' : 'shadow-lg shadow-pink-500/20'}`}
        disabled={actionDisabled}
        iconRight={actionIcon && !actionDisabled ? <ArrowRight className="h-3.5 w-3.5" /> : undefined}
        onClick={onAction}
      >
        {actionLabel}
      </Button>
    </Card>
  );
}

export function PlanCreditsSummary({ plan,className = '' }: { plan: AdminPlan; className?: string }) {
  const enterprise = isEnterprisePlan(plan);

  return (
    <div
      data-plan-cycle-credits
      data-plan-tone={enterprise ? 'enterprise' : 'standard'}
      className={`rounded-2xl border bg-gradient-to-r px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${enterprise
        ? 'border-orange-400/30 from-orange-500/15 via-amber-500/10 to-red-500/10'
        : 'border-fuchsia-400/30 from-fuchsia-500/15 via-purple-500/10 to-blue-500/10'} ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.12em] ${enterprise ? 'text-orange-200' : 'text-fuchsia-200'}`}>
          <Coins className={`h-3.5 w-3.5 ${enterprise ? 'text-orange-300' : 'text-fuchsia-300'}`} />
          周期积分
        </span>
        <span className={`text-xl font-black tabular-nums ${enterprise ? 'text-orange-200' : 'text-fuchsia-200'}`}>{plan.credits.toLocaleString()}</span>
      </div>
    </div>
  );
}

export function PortraitEntitlementSummary({ plan,className = '' }: { plan: AdminPlan; className?: string }) {
  const items = getPortraitPlanBenefits(plan);
  if (items.length === 0) return null;

  return (
    <div
      data-plan-portrait-entitlements
      className={`rounded-2xl border border-violet-400/15 bg-violet-500/[0.06] px-3 py-3 ${className}`}
    >
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-300/80">真人演员库</p>
      <div className="space-y-2">
        {items.map(item => (
          <div key={item.key} className="flex items-center justify-between gap-3 text-xs">
            <span className={item.enabled ? 'text-gray-300' : 'text-gray-500'}>{item.label}</span>
            <span className={item.enabled ? 'font-semibold text-white' : 'font-semibold text-gray-500'}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
