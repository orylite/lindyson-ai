import { Coins,Package } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect,useMemo,useRef,useState } from 'react';
import { toast } from 'sonner';
import { ApiError,getSessionEpoch } from '../../api/client';
import { privateQueryKey } from '../../api/queryClient';
import * as queries from '../../api/queries';
import type {
  AdminPlan,
  AdminUser,
  AdminUserSubscriptionUpdate,
} from '../../data/admin';
import { Button,DatePicker,Input,LoadingState,Select,TabBar } from '../../ui';
import { DetailGrid,number } from './AdminPageShared';
import type { ConfirmState } from '../types';

type AdjustmentTab = 'credits' | 'plan';
type BillingCycle = 'monthly' | 'yearly';

const FREE_PLAN_VALUE = '__free__';
const MAX_PLAN_DATE = '2099-12-31';
const SIGNED_INTEGER = /^[+-]?\d+$/;

interface UserAccountAdjustmentProps {
  user: AdminUser;
  onUserSubscriptionChange: (
    user: AdminUser,
    payload: AdminUserSubscriptionUpdate,
  ) => Promise<AdminUser>;
  onUserCreditsAdjust: (
    user: AdminUser,
    mainDelta: number,
    addonDelta: number,
    note: string,
  ) => Promise<AdminUser>;
  setConfirm: (confirm: ConfirmState) => void;
}

export interface CreditAdjustmentValidationInput {
  mainDelta: string;
  addonDelta: string;
  note: string;
  currentMainCredits: number;
  currentAddonCredits: number;
}

export interface SubscriptionAdjustmentValidationInput {
  currentUser: AdminUser;
  targetPlanId: string | null;
  targetPlan: AdminPlan | null;
  billingCycle: BillingCycle;
  planResetAt: string;
  planExpiresAt: string;
  note: string;
  today: string;
}

export interface SubscriptionPreviewInput {
  currentUser: AdminUser;
  currentAssignedPlan: AdminPlan | null;
  targetPlanId: string | null;
  targetPlan: AdminPlan | null;
  today: string;
}

export function parseCreditAdjustmentDelta(value: string) {
  const normalized = value.trim();
  if (!SIGNED_INTEGER.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function validateCreditAdjustment(input: CreditAdjustmentValidationInput) {
  const mainDelta = parseCreditAdjustmentDelta(input.mainDelta);
  const addonDelta = parseCreditAdjustmentDelta(input.addonDelta);
  if (mainDelta === null || addonDelta === null) return '主套餐积分和加购包积分的调整值都必须是整数';
  if (mainDelta === 0 && addonDelta === 0) return '至少填写一项非 0 的积分调整值';
  if (input.currentMainCredits + mainDelta < 0) return '调整后的主套餐积分不能小于 0';
  if (input.currentAddonCredits + addonDelta < 0) return '调整后的加购包积分不能小于 0';
  if (!input.note.trim()) return '请填写内部调整原因';
  return '';
}

export function validateSubscriptionAdjustment(input: SubscriptionAdjustmentValidationInput) {
  const { currentUser,targetPlanId,targetPlan,billingCycle,planResetAt,planExpiresAt,note,today } = input;
  if (!note.trim()) return '请填写内部调整原因';

  if (targetPlanId === null) {
    if (
      currentUser.planId === null
      && currentUser.planResetAt === null
      && currentUser.planExpiresAt === null
      && currentUser.billingCycle === 'monthly'
    ) return '当前已经是免费版，无需重复保存';
    return '';
  }

  if (!targetPlan || targetPlan.id !== targetPlanId) return '请选择可分配的套餐';
  if (targetPlan.kind !== 'main' || targetPlan.status !== 'active' || targetPlan.code.toLowerCase() === 'free') {
    return '只能分配启用中的主套餐';
  }
  if (!supportsBillingCycle(targetPlan, billingCycle)) return '所选套餐不支持当前计费周期';
  if (!isValidIsoDate(planResetAt)) return '请选择有效的套餐重置日期';
  if (!isValidIsoDate(planExpiresAt)) return '请选择有效的套餐到期日期';
  if (planResetAt <= today) return '套餐重置日期必须晚于北京时间今天';
  if (planExpiresAt <= today) return '套餐到期日期必须晚于北京时间今天';
  if (planResetAt > planExpiresAt) return '套餐重置日期不能晚于套餐到期日期';
  if (
    currentUser.planId === targetPlanId
    && currentUser.billingCycle === billingCycle
    && currentUser.planResetAt === planResetAt
    && currentUser.planExpiresAt === planExpiresAt
  ) return '套餐与周期日期没有变化';
  return '';
}

export function calculateSubscriptionPreview(input: SubscriptionPreviewInput) {
  const { currentUser,currentAssignedPlan,targetPlanId,targetPlan,today } = input;
  const reconcileWillExpire = Boolean(
    currentUser.planExpiresAt && currentUser.planExpiresAt <= today,
  );
  const reconcileWillReset = !reconcileWillExpire && Boolean(
    currentUser.planResetAt && currentUser.planResetAt <= today,
  );
  const reconciledPlanId = reconcileWillExpire ? null : currentUser.planId;
  const reconciledMainCredits = reconcileWillExpire
    ? 0
    : reconcileWillReset
      ? currentUser.planId ? currentAssignedPlan?.credits ?? 0 : 0
      : currentUser.mainCredits;
  const planActuallyChanges = targetPlanId !== reconciledPlanId;
  return {
    reconcileWillExpire,
    reconcileWillReset,
    planActuallyChanges,
    previewMainCredits: planActuallyChanges ? targetPlan?.credits ?? 0 : reconciledMainCredits,
  };
}

export function UserAccountAdjustment({
  user,
  onUserSubscriptionChange,
  onUserCreditsAdjust,
  setConfirm,
}: UserAccountAdjustmentProps) {
  const plansQuery = useQuery({
    queryKey: privateQueryKey(getSessionEpoch(), 'admin', 'plans'),
    queryFn: ({ signal }) => queries.getAdminPlans(signal),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const plans = plansQuery.data ?? [];
  const [activeTab,setActiveTab] = useState<AdjustmentTab>('credits');
  const [currentUser,setCurrentUser] = useState(user);
  const [mainDelta,setMainDelta] = useState('0');
  const [addonDelta,setAddonDelta] = useState('0');
  const [creditNote,setCreditNote] = useState('');
  const [creditError,setCreditError] = useState('');
  const [targetPlanValue,setTargetPlanValue] = useState(currentUser.planId ?? FREE_PLAN_VALUE);
  const [billingCycle,setBillingCycle] = useState<BillingCycle>(currentUser.billingCycle);
  const [planResetAt,setPlanResetAt] = useState(currentUser.planResetAt ?? '');
  const [planExpiresAt,setPlanExpiresAt] = useState(currentUser.planExpiresAt ?? '');
  const [planNote,setPlanNote] = useState('');
  const [planError,setPlanError] = useState('');
  const [checkingPlan,setCheckingPlan] = useState(false);
  const mountedRef = useRef(true);
  const planRefreshInFlightRef = useRef(false);
  const today = beijingToday();
  const earliestPlanDate = addIsoDays(today, 1);
  const renderedPlanDraftFingerprint = subscriptionDraftFingerprint({
    currentUser,
    activeTab,
    targetPlanValue,
    billingCycle,
    planResetAt,
    planExpiresAt,
    planNote,
  });
  const planDraftFingerprintRef = useRef(renderedPlanDraftFingerprint);
  planDraftFingerprintRef.current = renderedPlanDraftFingerprint;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const freePlan = useMemo(
    () => plans.find(plan => plan.kind === 'main' && plan.code.toLowerCase() === 'free') ?? null,
    [plans],
  );
  const assignablePlans = useMemo(
    () => plans.filter(plan => (
      plan.kind === 'main'
      && plan.status === 'active'
      && plan.code.toLowerCase() !== 'free'
    )),
    [plans],
  );
  const targetPlan = targetPlanValue === FREE_PLAN_VALUE
    ? null
    : plans.find(plan => plan.id === targetPlanValue) ?? null;
  const targetPlanId = targetPlanValue === FREE_PLAN_VALUE ? null : targetPlanValue;
  const targetIsFree = targetPlanId === null;
  const currentAssignedPlan = currentUser.planId
    ? plans.find(plan => plan.id === currentUser.planId) ?? null
    : null;
  const currentPolicyPlan = currentAssignedPlan ?? (currentUser.planId === null ? freePlan : null);
  const {
    reconcileWillExpire,
    reconcileWillReset,
    planActuallyChanges,
    previewMainCredits,
  } = calculateSubscriptionPreview({
    currentUser,
    currentAssignedPlan,
    targetPlanId,
    targetPlan,
    today,
  });
  const targetPolicyPlan = targetPlan ?? freePlan;
  const retentionShortens = isRetentionShorter(
    (reconcileWillExpire ? freePlan : currentPolicyPlan)?.assetRetentionDays,
    targetPolicyPlan?.assetRetentionDays,
  );
  const portraitEntitlementsReduce = isPortraitEntitlementsReduced(
    (reconcileWillExpire ? freePlan : currentPolicyPlan)?.portraitEntitlements,
    targetPolicyPlan?.portraitEntitlements,
  );

  const planOptions = useMemo(() => {
    const options: Array<{ value: string; label: string; disabled?: boolean }> = [
      { value: FREE_PLAN_VALUE, label: '免费版（特殊）' },
      ...assignablePlans.map(plan => ({
        value: plan.id,
        label: `${plan.name} · 标准 ${number(plan.credits)} 积分`,
      })),
    ];
    if (currentUser.planId && !assignablePlans.some(plan => plan.id === currentUser.planId)) {
      options.push({
        value: currentUser.planId,
        label: `${currentUser.planName}（当前套餐不可再分配）`,
        disabled: true,
      });
    }
    return options;
  }, [assignablePlans,currentUser.planId,currentUser.planName]);

  const billingOptions = useMemo(() => {
    if (!targetPlan) return [{ value: 'monthly' as const, label: '月付' }];
    const options: Array<{ value: BillingCycle; label: string }> = [];
    if (targetPlan.billing === 'monthly' || targetPlan.billing === 'both') {
      options.push({ value: 'monthly', label: '月付' });
    }
    if (targetPlan.billing === 'yearly' || targetPlan.billing === 'both') {
      options.push({ value: 'yearly', label: '年付' });
    }
    return options;
  }, [targetPlan]);

  const selectPlan = (value: string) => {
    setTargetPlanValue(value);
    setPlanError('');
    if (value === FREE_PLAN_VALUE) {
      setBillingCycle('monthly');
      setPlanResetAt('');
      setPlanExpiresAt('');
      return;
    }
    const selected = plans.find(plan => plan.id === value);
    if (!selected) return;
    if (value === currentUser.planId) {
      setBillingCycle(currentUser.billingCycle);
      setPlanResetAt(currentUser.planResetAt ?? '');
      setPlanExpiresAt(currentUser.planExpiresAt ?? '');
      return;
    }
    const nextCycle = supportsBillingCycle(selected, billingCycle)
      ? billingCycle
      : selected.billing === 'yearly' ? 'yearly' : 'monthly';
    setBillingCycle(nextCycle);
    setPlanResetAt('');
    setPlanExpiresAt('');
  };

  const submitCredits = () => {
    const validationError = validateCreditAdjustment({
      mainDelta,
      addonDelta,
      note: creditNote,
      currentMainCredits: currentUser.mainCredits,
      currentAddonCredits: currentUser.addonCredits,
    });
    if (validationError) {
      setCreditError(validationError);
      return;
    }
    const parsedMainDelta = parseCreditAdjustmentDelta(mainDelta) ?? 0;
    const parsedAddonDelta = parseCreditAdjustmentDelta(addonDelta) ?? 0;
    const nextMain = currentUser.mainCredits + parsedMainDelta;
    const nextAddon = currentUser.addonCredits + parsedAddonDelta;
    setCreditError('');
    setConfirm({
      title: '确认调整积分？',
      description: `${currentUser.userName} 的主套餐积分将从 ${number(currentUser.mainCredits)} 调整为 ${number(nextMain)}，加购包积分将从 ${number(currentUser.addonCredits)} 调整为 ${number(nextAddon)}。两类积分独立记账。`,
      confirmLabel: '确认调整积分',
      danger: parsedMainDelta < 0 || parsedAddonDelta < 0,
      onConfirm: async () => {
        const updated = await onUserCreditsAdjust(
          currentUser,
          parsedMainDelta,
          parsedAddonDelta,
          creditNote.trim(),
        );
        setCurrentUser(updated);
        setMainDelta('0');
        setAddonDelta('0');
        setCreditNote('');
        toast.success('积分已调整');
      },
    });
  };

  const submitPlan = async () => {
    if (checkingPlan || planRefreshInFlightRef.current) return;
    const validationToday = beijingToday();
    const validationError = validateSubscriptionAdjustment({
      currentUser,
      targetPlanId,
      targetPlan,
      billingCycle,
      planResetAt,
      planExpiresAt,
      note: planNote,
      today: validationToday,
    });
    if (validationError) {
      setPlanError(validationError);
      return;
    }
    planRefreshInFlightRef.current = true;
    const submittedDraftFingerprint = renderedPlanDraftFingerprint;
    setCheckingPlan(true);
    const refreshedPlans = await plansQuery.refetch().catch(() => null);
    if (!mountedRef.current) return;
    planRefreshInFlightRef.current = false;
    setCheckingPlan(false);
    if (planDraftFingerprintRef.current !== submittedDraftFingerprint) {
      setPlanError('套餐草稿在校验期间发生变化，当前未提交任何修改，请重新核对后保存');
      return;
    }
    if (!refreshedPlans || refreshedPlans.isError || !refreshedPlans.data) {
      setPlanError('套餐配置刷新失败，当前未提交任何修改，请稍后重试');
      return;
    }
    const latestTargetPlan = targetPlanId
      ? refreshedPlans.data.find(plan => plan.id === targetPlanId) ?? null
      : null;
    const latestCurrentPlan = currentUser.planId
      ? refreshedPlans.data.find(plan => plan.id === currentUser.planId) ?? null
      : null;
    const latestFreePlan = refreshedPlans.data.find(
      plan => plan.kind === 'main' && plan.code.toLowerCase() === 'free',
    ) ?? null;
    if (
      planAdjustmentFingerprint(targetPlan) !== planAdjustmentFingerprint(latestTargetPlan)
      || planAdjustmentFingerprint(currentAssignedPlan) !== planAdjustmentFingerprint(latestCurrentPlan)
      || planAdjustmentFingerprint(freePlan) !== planAdjustmentFingerprint(latestFreePlan)
    ) {
      setPlanError('套餐配置刚刚发生变化，预览已刷新，请重新核对后再次保存');
      return;
    }
    const confirmedToday = beijingToday();
    const latestValidationError = validateSubscriptionAdjustment({
      currentUser,
      targetPlanId,
      targetPlan: latestTargetPlan,
      billingCycle,
      planResetAt,
      planExpiresAt,
      note: planNote,
      today: confirmedToday,
    });
    if (latestValidationError) {
      setPlanError(latestValidationError);
      return;
    }
    const latestPreview = calculateSubscriptionPreview({
      currentUser,
      currentAssignedPlan: latestCurrentPlan,
      targetPlanId,
      targetPlan: latestTargetPlan,
      today: confirmedToday,
    });
    const latestCurrentPolicyPlan = latestCurrentPlan
      ?? (currentUser.planId === null ? latestFreePlan : null);
    const latestTargetPolicyPlan = latestTargetPlan ?? latestFreePlan;
    const latestRetentionShortens = isRetentionShorter(
      (latestPreview.reconcileWillExpire ? latestFreePlan : latestCurrentPolicyPlan)?.assetRetentionDays,
      latestTargetPolicyPlan?.assetRetentionDays,
    );
    const latestPortraitEntitlementsReduce = isPortraitEntitlementsReduced(
      (latestPreview.reconcileWillExpire ? latestFreePlan : latestCurrentPolicyPlan)?.portraitEntitlements,
      latestTargetPolicyPlan?.portraitEntitlements,
    );
    const payload: AdminUserSubscriptionUpdate = {
      planId: targetPlanId,
      billingCycle: targetIsFree ? null : billingCycle,
      planResetAt: targetIsFree ? null : planResetAt,
      planExpiresAt: targetIsFree ? null : planExpiresAt,
      note: planNote.trim(),
      expected: {
        planId: currentUser.planId,
        billingCycle: currentUser.billingCycle,
        planCycleStartedAt: currentUser.planCycleStartedAt,
        planResetAt: currentUser.planResetAt,
        planExpiresAt: currentUser.planExpiresAt,
        activeSubscriptionOrderId: currentUser.activeSubscriptionOrderId,
        mainCredits: currentUser.mainCredits,
      },
      expectedPlanCredits: latestTargetPlan?.credits ?? 0,
    };
    const targetName = latestTargetPlan?.name ?? '免费版';
    const mainCreditDescription = latestPreview.planActuallyChanges
      ? `主套餐积分将自动调整为 ${number(latestPreview.previewMainCredits)}`
      : latestPreview.reconcileWillExpire || latestPreview.reconcileWillReset
        ? `服务端会先结算已到期周期，主套餐积分将变为 ${number(latestPreview.previewMainCredits)}`
        : `主套餐积分保持 ${number(currentUser.mainCredits)}`;
    const dateDescription = targetIsFree
      ? '周期重置与到期日期将清空'
      : `周期为${billingCycle === 'yearly' ? '年付' : '月付'}，重置日 ${planResetAt}，到期日 ${planExpiresAt}`;
    const retentionWarning = latestRetentionShortens && latestTargetPolicyPlan
      ? `素材保留期将缩短为 ${formatRetention(latestTargetPolicyPlan.assetRetentionDays)}，超期素材会在下一个北京时间 03:00 清理。`
      : '';
    const portraitWarning = latestPortraitEntitlementsReduce
      ? '真人演员库权益将减少并进入 7 天宽限；超额演员到期后锁定，远端资源由异步任务释放。'
      : '';
    const oldOrderWarning = currentUser.activeSubscriptionOrderId
      ? '原订阅订单关联将解除；此后若退款旧订单，将转人工复核，避免覆盖本次设置。'
      : '';
    setPlanError('');
    setConfirm({
      title: '确认修改用户套餐？',
      description: `${currentUser.userName} 将从“${currentUser.planName}”改为“${targetName}”。${dateDescription}；${mainCreditDescription}，加购包积分保持 ${number(currentUser.addonCredits)}。${retentionWarning}${portraitWarning}${oldOrderWarning}本操作不会生成订单、收入、发票或通知邮件。`,
      confirmLabel: '确认修改套餐',
      danger: latestPreview.previewMainCredits < currentUser.mainCredits
        || latestRetentionShortens
        || latestPortraitEntitlementsReduce
        || targetIsFree,
      onConfirm: async () => {
        let updated: AdminUser;
        try {
          updated = await onUserSubscriptionChange(currentUser, payload);
        } catch (error) {
          const message = error instanceof Error ? error.message : '套餐修改失败';
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            setPlanError(`${message}。用户列表正在刷新，请基于最新数据重新打开调整。`);
            toast.error(message);
            return;
          }
          const retryMessage = `${message}。请求结果暂不确定；请再次确认，系统会复用同一幂等键安全重试。`;
          setPlanError(retryMessage);
          throw new Error(retryMessage);
        }
        setCurrentUser(updated);
        setTargetPlanValue(updated.planId ?? FREE_PLAN_VALUE);
        setBillingCycle(updated.billingCycle);
        setPlanResetAt(updated.planResetAt ?? '');
        setPlanExpiresAt(updated.planExpiresAt ?? '');
        setPlanNote('');
        toast.success('用户套餐已更新');
      },
    });
  };

  const parsedMainDelta = parseCreditAdjustmentDelta(mainDelta) ?? 0;
  const parsedAddonDelta = parseCreditAdjustmentDelta(addonDelta) ?? 0;

  return (
    <div className="space-y-5">
      <DetailGrid rows={[
        ['用户', `${currentUser.userName} · ${currentUser.email}`],
        ['当前套餐', currentUser.planName],
        ['当前积分', `主套餐 ${number(currentUser.mainCredits)} · 加购包 ${number(currentUser.addonCredits)}`],
      ]} />

      <TabBar
        tabs={[
          { id: 'credits', label: '调整积分', icon: <Coins className="h-4 w-4" /> },
          { id: 'plan', label: '修改套餐', icon: <Package className="h-4 w-4" /> },
        ]}
        active={activeTab}
        onChange={setActiveTab}
        variant="segment"
        ariaLabel="套餐与积分调整"
      />

      {activeTab === 'credits' ? (
        <div role="tabpanel" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="主套餐积分调整值"
              value={mainDelta}
              inputMode="numeric"
              onChange={event => { setMainDelta(event.target.value); setCreditError(''); }}
              hint="可输入正整数或负整数"
            />
            <Input
              label="加购包积分调整值"
              value={addonDelta}
              inputMode="numeric"
              onChange={event => { setAddonDelta(event.target.value); setCreditError(''); }}
              hint="不会自动与主套餐积分互相抵扣"
            />
          </div>
          <div className="grid gap-3 rounded-2xl border border-purple-500/20 bg-purple-500/10 p-4 text-sm sm:grid-cols-2">
            <PreviewValue label="调整后主套餐积分" value={currentUser.mainCredits + parsedMainDelta} />
            <PreviewValue label="调整后加购包积分" value={currentUser.addonCredits + parsedAddonDelta} />
          </div>
          <Input
            label="内部调整原因（仅后台）"
            value={creditNote}
            maxLength={500}
            onChange={event => { setCreditNote(event.target.value); setCreditError(''); }}
            placeholder="例如：人工补偿、异常扣减修正"
          />
          <p className="text-xs leading-5 text-gray-400">
            原因只写入后台审计；用户积分流水使用统一的增加或减少文案。两类积分会分别写入流水。
          </p>
          {creditError && <ValidationError message={creditError} />}
          <div className="flex justify-end">
            <Button onClick={submitCredits}>保存积分调整</Button>
          </div>
        </div>
      ) : (
        <div role="tabpanel" className="space-y-4">
          {!plansQuery.data && plansQuery.isPending ? (
            <LoadingState label="正在加载可分配套餐" />
          ) : !plansQuery.data && plansQuery.isError ? (
            <div className="space-y-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <p className="text-sm text-red-200">套餐列表加载失败，当前不能修改用户套餐。</p>
              <Button variant="secondary" size="sm" onClick={() => void plansQuery.refetch()}>重新加载</Button>
            </div>
          ) : (
            <>
          <Select
            label="目标套餐"
            value={targetPlanValue}
            options={planOptions}
            onValueChange={selectPlan}
            maxVisibleOptions={7}
          />

          {!targetIsFree && (
            <>
              <Select
                label="计费周期"
                value={billingCycle}
                options={billingOptions}
                onValueChange={value => { setBillingCycle(value); setPlanError(''); }}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <DatePicker
                  mode="date"
                  label="下次套餐重置日期"
                  value={planResetAt}
                  min={earliestPlanDate}
                  max={MAX_PLAN_DATE}
                  placeholder="请选择重置日期"
                  onValueChange={value => {
                    setPlanResetAt(value);
                    if (planExpiresAt && planExpiresAt < value) setPlanExpiresAt('');
                    setPlanError('');
                  }}
                />
                <DatePicker
                  mode="date"
                  label="套餐到期日期"
                  value={planExpiresAt}
                  min={planResetAt || earliestPlanDate}
                  max={MAX_PLAN_DATE}
                  placeholder="请选择到期日期"
                  onValueChange={value => { setPlanExpiresAt(value); setPlanError(''); }}
                />
              </div>
            </>
          )}

          <div className="rounded-2xl border border-purple-500/20 bg-purple-500/10 p-4 text-sm text-purple-100">
            <div className="grid gap-3 sm:grid-cols-3">
              <PreviewValue label="修改后主套餐积分" value={previewMainCredits} />
              <PreviewValue label="加购包积分" value={currentUser.addonCredits} />
              <PreviewValue label="合计可用积分" value={previewMainCredits + currentUser.addonCredits} />
            </div>
            <p className="mt-3 text-xs leading-5 text-purple-200/80">
              {reconcileWillExpire
                ? '当前套餐已到期；保存时服务端会先回退免费版，再应用本次目标套餐和标准积分。'
                : reconcileWillReset
                  ? '当前套餐已到重置日；保存时服务端会先按当前套餐标准积分结算旧周期，再应用本次修改。'
                  : planActuallyChanges
                ? '套餐发生切换时，主套餐积分自动改为目标套餐标准积分；加购包积分保持不变。'
                : '当前仅修改周期或日期，主套餐积分保持不变。'}
            </p>
          </div>

          {(reconcileWillExpire || reconcileWillReset) && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
              当前账户存在待结算的套餐{reconcileWillExpire ? '到期' : '重置'}。上方积分预览已按“先结算旧周期，再修改套餐”的服务端顺序计算，结算和修改会在同一事务完成。
            </div>
          )}

          {targetIsFree && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
              切换为免费版会把主套餐积分清零、保留加购包积分，并清空重置与到期日期。
            </div>
          )}
          {targetPolicyPlan && (
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-xs leading-5 text-gray-300">
              <p className="font-semibold text-white">目标套餐真人演员库权益</p>
              <p className="mt-1">
                {formatPortraitEntitlements(targetPolicyPlan.portraitEntitlements)}
              </p>
            </div>
          )}
          {portraitEntitlementsReduce && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
              目标套餐的真人演员库权益更低。保存后进入 7 天宽限；用户可选择保留演员，超额演员到期后进入套餐锁定，远端资源由异步任务释放。
            </div>
          )}
          {retentionShortens && targetPolicyPlan && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
              目标套餐素材保留期为 {formatRetention(targetPolicyPlan.assetRetentionDays)}。超出新保留期的素材会在下一个北京时间 03:00 清理，请先确认用户已备份重要素材。
            </div>
          )}
          <Input
            label="内部调整原因（仅后台）"
            value={planNote}
            maxLength={500}
            onChange={event => { setPlanNote(event.target.value); setPlanError(''); }}
            placeholder="例如：线下签约、客服纠错、测试账号调整"
          />
          <p className="text-xs leading-5 text-gray-400">
            周期起点由服务端记录为北京时间今天。提交会检查用户、标准积分与未决支付/退款状态；存在冲突时不会部分生效。
          </p>
          {planError && <ValidationError message={planError} />}
          <div className="flex justify-end">
            <Button loading={checkingPlan} onClick={() => void submitPlan()}>保存套餐设置</Button>
          </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PreviewValue({ label,value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`mt-1 font-semibold ${value < 0 ? 'text-red-300' : 'text-white'}`}>{number(value)}</p>
    </div>
  );
}

function ValidationError({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
      {message}
    </div>
  );
}

function supportsBillingCycle(plan: AdminPlan, billingCycle: BillingCycle) {
  return plan.billing === 'both' || plan.billing === billingCycle;
}

function isValidIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3]);
}

function beijingToday() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function addIsoDays(value: string, days: number) {
  const [year,month,day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days));
  return date.toISOString().slice(0, 10);
}

function isRetentionShorter(currentDays?: number, targetDays?: number) {
  if (currentDays === undefined || targetDays === undefined) return false;
  if (currentDays === 0) return targetDays > 0;
  if (targetDays === 0) return false;
  return targetDays < currentDays;
}

function formatRetention(days: number) {
  return days === 0 ? '永久保留' : `${days} 天`;
}

export function isPortraitEntitlementsReduced(
  current?: AdminPlan['portraitEntitlements'],
  target?: AdminPlan['portraitEntitlements'],
) {
  if (!current || !target) return false;
  if (current.enabled && !target.enabled) return true;
  if (!current.enabled) return false;
  if (
    current.profileLimit === null
    ? target.profileLimit !== null
    : target.profileLimit !== null && target.profileLimit < current.profileLimit
  ) return true;
  return target.activeLimit < current.activeLimit
    || target.assetsPerActor < current.assetsPerActor;
}

function formatPortraitEntitlements(entitlements: AdminPlan['portraitEntitlements']) {
  if (!entitlements.enabled) return '未启用';
  const profiles = entitlements.profileLimit === null ? '不限档案' : `${number(entitlements.profileLimit)} 个档案`;
  return `${profiles} · 同时激活 ${number(entitlements.activeLimit)} 人 · 每人 ${number(entitlements.assetsPerActor)} 张图片`;
}

function planAdjustmentFingerprint(plan: AdminPlan | null) {
  if (!plan) return 'none';
  return JSON.stringify({
    id: plan.id,
    name: plan.name,
    code: plan.code,
    kind: plan.kind,
    billing: plan.billing,
    credits: plan.credits,
    assetRetentionDays: plan.assetRetentionDays,
    portraitEntitlements: plan.portraitEntitlements,
    status: plan.status,
    updatedAt: plan.updatedAt,
  });
}

function subscriptionDraftFingerprint(input: {
  currentUser: AdminUser;
  activeTab: AdjustmentTab;
  targetPlanValue: string;
  billingCycle: BillingCycle;
  planResetAt: string;
  planExpiresAt: string;
  planNote: string;
}) {
  const { currentUser,activeTab,targetPlanValue,billingCycle,planResetAt,planExpiresAt,planNote } = input;
  return JSON.stringify({
    userId: currentUser.id,
    currentPlanId: currentUser.planId,
    currentBillingCycle: currentUser.billingCycle,
    currentPlanCycleStartedAt: currentUser.planCycleStartedAt,
    currentPlanResetAt: currentUser.planResetAt,
    currentPlanExpiresAt: currentUser.planExpiresAt,
    currentActiveSubscriptionOrderId: currentUser.activeSubscriptionOrderId,
    currentMainCredits: currentUser.mainCredits,
    currentAddonCredits: currentUser.addonCredits,
    activeTab,
    targetPlanValue,
    billingCycle,
    planResetAt,
    planExpiresAt,
    planNote,
  });
}
