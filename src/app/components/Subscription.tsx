import { ArrowLeft,ArrowRight,CalendarDays,Check,ChevronDown,Coins,CreditCard,HardDrive,ReceiptText,Users,X,Zap } from 'lucide-react';
import { useEffect,useMemo,useRef,useState,type ReactNode } from 'react';
import { toast } from 'sonner';
import alipayLogo from '../../imports/alipay-logo.png';
import { type AdminOrder,type AdminPlan,type PaymentAttempt,type PaymentLaunch } from '../data/admin';
import { isPaymentAttemptDefinitivelyFailed,paymentFailureMessage } from '../data/paymentState';
import { getPlanIconGradientForPlan,isEnterprisePlan } from '../data/planIcons';
import { formatCnyFromCents } from '../utils/currency';
import { acquirePaymentIntentKey,clearPaymentIntentKey } from '../state/paymentIntent';
import type { PaymentMonitorStatus,StartPaymentMonitorInput } from '../state/usePaymentMonitor';
import { AppPage,Card,PageHeader } from '../ui';
import { PaymentQrModal } from './PaymentQrModal';
import { getPlanCardVisual,PlanCard,PortraitEntitlementSummary } from './PlanCard';

interface SubscriptionProps {
  plans: AdminPlan[];
  currentPlanCode: string | null;
  onOrderHistory: () => void;
  onCreatePayment: (
    plan: AdminPlan,
    billing: 'monthly' | 'yearly' | 'one-time',
    surface: 'pc' | 'mobile',
    idempotencyKey: string,
  ) => Promise<{ order: AdminOrder; paymentAttempt: PaymentAttempt }>;
  paymentMonitorStatus: PaymentMonitorStatus | null;
  onStartPaymentMonitor: (input: StartPaymentMonitorInput) => void;
  onStopPaymentMonitor: () => void;
  onCancelPaymentOrder: (orderId: string) => Promise<AdminOrder>;
  onPaymentPaid: (order: AdminOrder) => void | Promise<void>;
}

function addonFeatures(plan: AdminPlan) {
  return [
    `补充积分 ${plan.credits.toLocaleString()}`,
    '不改变套餐周期',
    '不改变积分重置日期',
    '优先消耗主套餐积分',
  ];
}

function yearlyBillingLabel(plan: AdminPlan) {
  if (plan.monthlyPrice <= 0 || plan.yearlyPrice <= 0) return null;

  const monthlyAnnualPrice = plan.monthlyPrice * 12;
  const discountPercent = Math.max(
    0,
    Math.round((1 - plan.yearlyPrice / monthlyAnnualPrice) * 100),
  );

  return `按年计费 ${formatCnyFromCents(plan.yearlyPrice)}/年 · 月付原价 ${formatCnyFromCents(monthlyAnnualPrice)}/年 · 省 ${discountPercent}%`;
}

function roundedYearlyMonthlyPrice(yearlyPrice: number) {
  return Math.round(yearlyPrice / 12 / 100) * 100;
}

const SUBSCRIPTION_FAQS = [
  {
    question: '未用完的积分会继续留到下个月吗？',
    answer: '不会，主套餐积分会在每个结算周期开始时重置。',
  },
  {
    question: '如果周期积分用完了，需要更多积分怎么办？',
    answer: '可以升级套餐或购买积分加购包；加购包为一次性补充，且优先消耗主套餐积分。',
  },
  {
    question: '结算周期是怎么计算的？',
    answer: '月付按购买日起约 30 天为一个周期，年付按一年周期计算，积分重置日期以账户中心显示为准。',
  },
  {
    question: '购买后可以退款吗？',
    answer: '付款成功且套餐正式生效后无法退款，请谨慎购买。',
  },
];

type PurchaseSelection = {
  plan: AdminPlan;
  billing: 'monthly' | 'yearly' | 'one-time';
};

type RedirectPaymentLaunch = Exclude<PaymentLaunch, { type: 'qr' }>;

export function Subscription({ plans, currentPlanCode, onOrderHistory, onCreatePayment, paymentMonitorStatus, onStartPaymentMonitor, onStopPaymentMonitor, onCancelPaymentOrder, onPaymentPaid }: SubscriptionProps) {
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('yearly');
  const [selection, setSelection] = useState<PurchaseSelection | null>(null);
  const [isPaymentSubmitting, setIsPaymentSubmitting] = useState(false);
  const [activeQrPayment, setActiveQrPayment] = useState<{
    order: AdminOrder;
    payment: Extract<PaymentLaunch, { type: 'qr' }>;
    fingerprint: string;
  } | null>(null);
  const paymentAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => () => onStopPaymentMonitor(), [onStopPaymentMonitor]);

  const mainPlans = useMemo(
    () => [...plans]
      .filter(plan => plan.kind === 'main' && plan.status === 'active')
      .sort((a, b) => a.monthlyPrice - b.monthlyPrice),
    [plans],
  );

  const addonPlans = useMemo(
    () => [...plans]
      .filter(plan => plan.kind === 'addon' && plan.status === 'active')
      .sort((a, b) => a.monthlyPrice - b.monthlyPrice),
    [plans],
  );

  const handleSelect = (plan: AdminPlan) => {
    setSelection({
      plan,
      billing: plan.kind === 'addon' ? 'one-time' : supportedBilling(plan, billing),
    });
  };

  const handleConfirmationBillingChange = (nextBilling: 'monthly' | 'yearly') => {
    setSelection(current => {
      if (!current || current.plan.kind === 'addon') return current;
      return { ...current, billing: supportedBilling(current.plan, nextBilling) };
    });
  };

  const handleConfirmPayment = async () => {
    if (!selection || isPaymentSubmitting) return;
    const surface = detectPaymentSurface();
    const fingerprint = `${selection.plan.id}:${selection.billing}:${surface}`;
    if (paymentAttemptRef.current?.fingerprint !== fingerprint) {
      paymentAttemptRef.current = { fingerprint, key: acquirePaymentIntentKey(fingerprint) };
    }
    const paymentWindow = surface === 'mobile' ? window.open('', '_blank') : null;

    setIsPaymentSubmitting(true);
    try {
      const result = await onCreatePayment(selection.plan, selection.billing, surface, paymentAttemptRef.current.key);
      const attempt = result.paymentAttempt;
      const clearIntent = () => {
        clearPaymentIntentKey(fingerprint);
        if (paymentAttemptRef.current?.fingerprint === fingerprint) paymentAttemptRef.current = null;
      };

      if (result.order.status === 'paid' || attempt.status === 'paid') {
        onStopPaymentMonitor();
        paymentWindow?.close();
        clearIntent();
        void onPaymentPaid(result.order);
        return;
      }
      if (result.order.status === 'refunded') {
        onStopPaymentMonitor();
        paymentWindow?.close();
        clearIntent();
        toast.info('该订单已退款');
        return;
      }
      if (isPaymentAttemptDefinitivelyFailed(result.order)) {
        onStopPaymentMonitor();
        paymentWindow?.close();
        clearIntent();
        toast.error(paymentFailureMessage(result.order));
        return;
      }
      if (attempt.status === 'manual-review') {
        onStopPaymentMonitor();
        paymentWindow?.close();
        toast.warning(attempt.manualReviewReason || attempt.error || '支付信息需要人工核对，请勿重复付款并联系客户支持');
        return;
      }
      if (attempt.status !== 'ready' || !attempt.launch) {
        onStopPaymentMonitor();
        paymentWindow?.close();
        if (attempt.status === 'uncertain') {
          toast.warning(attempt.error || '支付结果暂时无法确认，系统会继续查询；请勿重复创建订单');
        } else if (attempt.status === 'ready') {
          toast.error(attempt.error || '支付入口数据暂不可用，请稍后使用同一订单重试');
        } else {
          const retryHint = attempt.retryAfterMs && attempt.retryAfterMs > 0
            ? `，约 ${Math.max(1, Math.ceil(attempt.retryAfterMs / 1_000))} 秒后可重试`
            : '';
          toast.info(`支付入口正在准备${retryHint}`);
        }
        return;
      }

      if (attempt.launch.type === 'qr') {
        paymentWindow?.close();
        setActiveQrPayment({ order: result.order, payment: attempt.launch, fingerprint });
        onStartPaymentMonitor({
          orderId: result.order.id,
          mode: 'qr',
          onPaid: order => {
            clearIntent();
            setActiveQrPayment(null);
            return onPaymentPaid(order);
          },
          onFailed: order => {
            if (isPaymentAttemptDefinitivelyFailed(order)) clearIntent();
            if (order.paymentAttemptStatus === 'manual-review') toast.warning(paymentFailureMessage(order));
            else toast.info(paymentFailureMessage(order));
            setActiveQrPayment(null);
          },
        });
        return;
      }

      launchPayment(attempt.launch, paymentWindow);
      toast.success('已打开支付页面');
      onStartPaymentMonitor({
        orderId: result.order.id,
        mode: 'popup',
        paymentWindow,
        onPaid: order => {
          clearIntent();
          return onPaymentPaid(order);
        },
        onFailed: order => {
          if (isPaymentAttemptDefinitivelyFailed(order)) clearIntent();
          if (order.paymentAttemptStatus === 'manual-review') toast.warning(paymentFailureMessage(order));
          else toast.error(paymentFailureMessage(order));
        },
        onUnconfirmed: () => {
          toast.info('支付状态暂未确认，请稍后在历史订单中查看');
        },
      });
    } catch (error) {
      paymentWindow?.close();
      toast.error(error instanceof Error ? error.message : '支付创建失败');
    } finally {
      setIsPaymentSubmitting(false);
    }
  };

  if (selection) {
    return (
      <>
        <PurchaseConfirmation
          selection={selection}
          isSubmitting={isPaymentSubmitting}
          onCancel={() => {
            onStopPaymentMonitor();
            setActiveQrPayment(null);
            setSelection(null);
          }}
          onBillingChange={handleConfirmationBillingChange}
          onConfirm={handleConfirmPayment}
        />
        {activeQrPayment && (
          <PaymentQrModal
            order={activeQrPayment.order}
            payment={activeQrPayment.payment}
            monitorMessage={paymentMonitorStatus?.mode === 'qr' && paymentMonitorStatus.orderId === activeQrPayment.order.id
              ? paymentMonitorStatus.message
              : null}
            onStopPaymentMonitor={onStopPaymentMonitor}
            onCancelPaymentOrder={onCancelPaymentOrder}
            onPaymentPaid={order => {
              clearPaymentIntentKey(activeQrPayment.fingerprint);
              if (paymentAttemptRef.current?.fingerprint === activeQrPayment.fingerprint) paymentAttemptRef.current = null;
              setActiveQrPayment(null);
              void onPaymentPaid(order);
            }}
            onPaymentFailed={order => {
              if (isPaymentAttemptDefinitivelyFailed(order)) {
                clearPaymentIntentKey(activeQrPayment.fingerprint);
                if (paymentAttemptRef.current?.fingerprint === activeQrPayment.fingerprint) paymentAttemptRef.current = null;
              }
              setActiveQrPayment(null);
            }}
          />
        )}
      </>
    );
  }

  return (
    <AppPage width="standard" className="space-y-10">
      <div className="relative mb-8 text-center">
        <button
          type="button"
          onClick={onOrderHistory}
          className="mb-5 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:border-purple-500/30 hover:bg-white/10 hover:text-white md:absolute md:right-0 md:top-0 md:mb-0"
        >
          <ReceiptText className="h-4 w-4" />
          历史订单
        </button>
        <PageHeader
          eyebrow="PRICING"
          title="选择适合你的套餐"
          subtitle="解锁更多 AI 创作能力，加速你的内容增长"
          titleTone="solid"
          align="center"
        />

        <div data-ui="subscription-billing-toggle" className="mt-6 inline-flex items-center rounded-full border border-white/10 bg-white/5 p-1">
          {[
            { value: 'monthly' as const, label: '月付' },
            { value: 'yearly' as const, label: '年付', badge: '年付更优惠' },
          ].map(option => {
            const active = billing === option.value;

            return (
              <button
                key={option.value}
                type="button"
                data-ui="subscription-billing-option"
                aria-label={option.label}
                aria-pressed={active}
                onClick={() => setBilling(option.value)}
                className="flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap px-4 text-sm font-semibold"
              >
                {option.label}
                {option.badge && (
                  <span data-ui="subscription-billing-badge" className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold">
                    {option.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {mainPlans.map((plan) => {
          const price = billing === 'yearly' ? roundedYearlyMonthlyPrice(plan.yearlyPrice) : plan.monthlyPrice;
          const yearlyLabel = yearlyBillingLabel(plan);
          const isCurrent = plan.code === currentPlanCode;
          const isFree = plan.monthlyPrice <= 0 && plan.yearlyPrice <= 0;

          return (
            <PlanCard
              key={plan.id}
              plan={plan}
              price={price}
              priceHelper={billing === 'yearly' ? yearlyLabel : null}
              actionLabel={isCurrent ? '当前套餐' : isFree ? '免费套餐' : plan.ctaLabel}
              actionDisabled={isCurrent || isFree}
              onAction={() => handleSelect(plan)}
            />
          );
        })}
      </div>

      {addonPlans.length > 0 && (
        <section className="mt-10 border-t border-white/10 pt-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-white">积分加购包</h2>
              <p className="mt-1 text-sm text-gray-400">一次性补充积分，优先消耗主套餐积分，不改变重置日期。</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {addonPlans.map((plan) => (
              <Card
                key={plan.id}
                variant="interactive"
                className="relative flex flex-col p-6 hover:border-pink-400/60"
              >
                <div className="mb-4 flex items-center gap-3">
                  <div data-plan-icon-key="coins" className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${getPlanIconGradientForPlan(plan)}`}>
                    <Coins className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-white">{plan.name}</p>
                    <p className="text-xs text-gray-500">{plan.nameEn}</p>
                  </div>
                </div>

                <div className="mb-2">
                  <div className="flex items-end gap-1">
                    <span className="text-3xl font-bold text-white">{formatCnyFromCents(plan.monthlyPrice)}</span>
                    <span className="mb-1 text-sm text-gray-500">一次性</span>
                  </div>
                </div>

                <p className="mb-5 text-xs text-white">{plan.description}</p>

                <div className="mb-6 flex-1 space-y-2.5">
                  {addonFeatures(plan).map(feature => (
                    <div key={feature} className="flex items-center gap-2.5">
                      <Check className="h-4 w-4 flex-shrink-0 text-green-400" />
                      <span className="text-xs text-white">{feature}</span>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => handleSelect(plan)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90"
                >
                  {plan.ctaLabel}<ArrowRight className="w-3.5 h-3.5" />
                </button>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10 border-t border-white/10 pt-8">
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold text-white">常见问题</h2>
        </div>

        <div
          data-subscription-faq
          className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] shadow-[var(--product-shadow-card)]"
        >
          {SUBSCRIPTION_FAQS.map(item => (
            <details key={item.question} className="group open:bg-white/[0.025]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold text-white transition-colors marker:hidden hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-400 [&::-webkit-details-marker]:hidden sm:text-base">
                <span>{item.question}</span>
                <ChevronDown aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-purple-300 transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <p className="px-5 pb-5 pr-12 text-sm leading-6 text-gray-300">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>
    </AppPage>
  );
}

function PurchaseConfirmation({
  selection,
  isSubmitting,
  onCancel,
  onBillingChange,
  onConfirm,
}: {
  selection: PurchaseSelection;
  isSubmitting: boolean;
  onCancel: () => void;
  onBillingChange: (billing: 'monthly' | 'yearly') => void;
  onConfirm: () => void;
}) {
  const { plan, billing } = selection;
  const visual = getPlanCardVisual(plan);
  const Icon = visual.icon;
  const isAddon = plan.kind === 'addon';
  const amount = billing === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice;
  const monthlyOriginal = plan.monthlyPrice * 12;
  const yearlySavings = billing === 'yearly' ? Math.max(0, monthlyOriginal - plan.yearlyPrice) : 0;
  const benefitItems = isAddon ? addonFeatures(plan) : plan.features.map(feature => feature.text);
  const billingOptions = isAddon ? [] : (['monthly', 'yearly'] as const).filter(option => plan.billing === 'both' || plan.billing === option);

  return (
    <AppPage width="standard">
      <button
        type="button"
        onClick={onCancel}
        disabled={isSubmitting}
        className="inline-flex items-center gap-2 text-sm font-medium text-gray-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ArrowLeft className="h-4 w-4" />
        返回选择套餐
      </button>

      <PageHeader
        eyebrow="CHECKOUT"
        title="确认购买"
        subtitle="请核对套餐权益与支付金额，确认后将发起支付宝支付。"
        titleTone="solid"
        className="mt-5"
      />

      <div className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card
          variant="raised"
          accent={isEnterprisePlan(plan) ? 'orange' : 'violet'}
          className="p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-6">
            <div className="flex items-center gap-4">
              <div data-plan-icon-key={visual.iconKey} className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${getPlanIconGradientForPlan(plan)}`}>
                <Icon className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-xl font-bold text-white">{plan.name}</p>
                <p className="mt-1 text-sm text-gray-500">{plan.nameEn}</p>
              </div>
            </div>
            {isAddon ? (
              <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs font-semibold text-purple-200">
                {billingLabel(billing)}
              </span>
            ) : (
              <div className="inline-flex rounded-full border border-white/15 bg-black/20 p-1" aria-label="选择计费周期">
                {billingOptions.map(option => {
                  const active = billing === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-label={`${billingLabel(option)}套餐`}
                      aria-pressed={active}
                      disabled={isSubmitting}
                      onClick={() => onBillingChange(option)}
                      className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                        active
                          ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-md shadow-pink-500/20'
                          : 'text-gray-300 hover:text-white'
                      }`}
                    >
                      {billingLabel(option)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <p className="mt-6 text-sm leading-6 text-gray-200">{plan.description}</p>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <PlanMetric icon={<Coins className="h-4 w-4" />} label={isAddon ? '补充积分' : '周期积分'} value={plan.credits.toLocaleString()} />
            {isAddon ? (
              <>
                <PlanMetric icon={<CalendarDays className="h-4 w-4" />} label="套餐周期" value="不改变" />
                <PlanMetric icon={<Zap className="h-4 w-4" />} label="积分消耗" value="主套餐优先" />
              </>
            ) : (
              <>
                <PlanMetric icon={<HardDrive className="h-4 w-4" />} label="存储空间" value={plan.storage || '-'} />
                <PlanMetric icon={<Users className="h-4 w-4" />} label="TikTok 账号" value={plan.tiktokAccounts || '-'} />
              </>
            )}
          </div>

          <PortraitEntitlementSummary plan={plan} className="mt-6" />

          <div className="mt-7">
            <h2 className="text-sm font-semibold text-white">{isAddon ? '加购包规则' : '完整套餐权益'}</h2>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {benefitItems.map(item => {
                const feature = isAddon ? null : plan.features.find(candidate => candidate.text === item);
                const enabled = feature?.enabled ?? true;
                return (
                  <div key={item} className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                    {enabled
                      ? <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-400" />
                      : <X className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-600" />}
                    <span className={enabled ? 'text-sm text-gray-200' : 'text-sm text-gray-500'}>{item}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        <div className="space-y-4 lg:sticky lg:top-6">
          <Card variant="raised" data-testid="payment-summary-card" className="p-5" aria-labelledby="payment-summary-title">
            <div className="flex items-center gap-3 border-b border-white/10 pb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-r from-pink-600 to-purple-600">
                <CreditCard className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 id="payment-summary-title" className="font-semibold text-white">支付摘要</h2>
                <p className="mt-0.5 text-xs text-gray-500">支付前请确认以下信息</p>
              </div>
            </div>

            <div className="space-y-3 py-5 text-sm">
              <SummaryRow label="购买内容" value={plan.name} />
              <SummaryRow label="购买类型" value={isAddon ? '积分加购包' : '主套餐'} />
              <SummaryRow label="计费方式" value={billingLabel(billing)} />
              {billing === 'yearly' && (
                <>
                  <SummaryRow label="月付原价" value={formatCnyFromCents(monthlyOriginal)} />
                  <SummaryRow label="年付优惠" value={yearlySavings > 0 ? `-${formatCnyFromCents(yearlySavings)}` : formatCnyFromCents(0)} valueClassName="text-green-400" />
                </>
              )}
            </div>

            <div className="flex items-end justify-between border-t border-white/10 pt-5">
              <span className="text-sm text-gray-400">应付金额</span>
              <div className="text-right">
                <p className="text-3xl font-bold text-white">{formatCnyFromCents(amount)}</p>
                {billing === 'yearly' && <p className="mt-1 text-xs text-gray-500">约 {formatCnyFromCents(roundedYearlyMonthlyPrice(amount))}/月</p>}
              </div>
            </div>
          </Card>

          <Card variant="raised" accent="blue" data-testid="payment-method-card" className="p-5" aria-labelledby="payment-method-title">
            <div className="flex items-center gap-3 border-b border-white/10 pb-4">
              <div data-testid="payment-method-title-icon" className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-r from-pink-600 to-purple-600">
                <CreditCard className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 id="payment-method-title" className="font-semibold text-white">支付方式</h2>
                <p className="mt-0.5 text-xs text-gray-500">请选择支付方式</p>
              </div>
            </div>

            <div className="py-5" role="radiogroup" aria-label="支付方式">
              <label className="flex cursor-default items-center justify-between gap-3 rounded-xl border border-blue-400/50 bg-blue-500/10 px-4 py-3 shadow-sm shadow-blue-500/10">
                <span data-testid="payment-method-option-content" className="flex items-center gap-3">
                  <input type="radio" name="payment-method" value="alipay" checked readOnly className="h-4 w-4 accent-blue-500" />
                  <img data-testid="alipay-method-logo" src={alipayLogo} alt="" aria-hidden="true" className="h-6 w-6 flex-shrink-0 object-contain" />
                  <span className="text-sm font-semibold text-white">支付宝</span>
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-300">
                  <Check className="h-3.5 w-3.5" />
                  已选择
                </span>
              </label>
            </div>

            <button
              type="button"
              onClick={onConfirm}
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 py-3 text-sm font-semibold text-white shadow-lg shadow-pink-500/20 transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
            >
              {isSubmitting ? '正在创建支付订单' : `确认支付 ${formatCnyFromCents(amount)}`}
              {!isSubmitting && <ArrowRight className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              取消支付
            </button>
            <p className="mt-4 text-center text-xs leading-5 text-gray-500">付款成功且套餐正式生效后无法退款。</p>
          </Card>
        </div>
      </div>
    </AppPage>
  );
}

function PlanMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/15 bg-white/[0.08] p-3.5">
      <div className="flex items-center gap-2 text-xs font-medium text-white/85">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white">{icon}</span>
        <span>{label}</span>
      </div>
      <p className="mt-2.5 text-base font-bold text-white">{value}</p>
    </div>
  );
}

function SummaryRow({ label, value, valueClassName = 'text-white' }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-gray-500">{label}</span>
      <span className={`text-right font-medium ${valueClassName}`}>{value}</span>
    </div>
  );
}

function billingLabel(value: PurchaseSelection['billing']) {
  if (value === 'yearly') return '年付';
  if (value === 'monthly') return '月付';
  return '一次性购买';
}

function supportedBilling(plan: AdminPlan, preferred: 'monthly' | 'yearly') {
  if (plan.billing === 'both' || plan.billing === preferred) return preferred;
  return plan.billing === 'yearly' ? 'yearly' : 'monthly';
}

function detectPaymentSurface(): 'pc' | 'mobile' {
  if (typeof window === 'undefined') return 'pc';
  const mobileViewport = window.matchMedia('(max-width: 767px)').matches;
  const mobileAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator.userAgent);
  return mobileViewport || mobileAgent ? 'mobile' : 'pc';
}

function launchPayment(payment: RedirectPaymentLaunch, paymentWindow: Window | null) {
  if (payment.type === 'url') {
    if (paymentWindow) paymentWindow.location.replace(payment.url);
    else window.location.assign(payment.url);
    return;
  }

  const targetDocument = paymentWindow?.document ?? document;
  if (paymentWindow) {
    paymentWindow.opener = null;
    targetDocument.title = '正在进入支付宝';
    targetDocument.body.replaceChildren();
  }

  const form = targetDocument.createElement('form');
  form.action = payment.action;
  form.method = payment.method;
  form.target = '_self';
  form.hidden = true;
  for (const field of payment.fields) {
    const input = targetDocument.createElement('input');
    input.type = 'hidden';
    input.name = field.name;
    input.value = field.value;
    form.appendChild(input);
  }
  (targetDocument.body ?? targetDocument.documentElement).appendChild(form);
  form.submit();
}
