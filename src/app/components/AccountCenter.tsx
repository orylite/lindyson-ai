import { ReferralRewards } from './ReferralRewards';
import { ChatGptConnections } from './ChatGptConnections';
import {
  ArrowRight,
  CalendarDays,
  Coins,
  Eye,
  KeyRound,
  LogOut,
  Mail,
  PackageOpen,
  ReceiptText,
  RefreshCw,
  Save,
  ShieldCheck,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import { AnimatePresence,motion } from 'motion/react';
import { useEffect,useRef,useState } from 'react';
import { toast } from 'sonner';
import { isPaginationSnapshotChanged } from '../api/client';
import type { ExactCursorPagination as CursorPaginationState,PagePosition } from '../api/cursor';
import type { AccountProfile } from '../data/account';
import type { AdminGenerationJob,AdminOrder,CreditType,OrderHistoryFilter,OrderHistoryPage,UserCreditLedgerEntry } from '../data/admin';
import { formatRetryAfterMs,paymentAttemptStatusLabel,refundAttemptStatusLabel } from '../data/paymentState';
import { validateRegisterPassword } from '../state/auth';
import { getEmptyPageRecoveryRequest,type CursorPageRequest } from '../state/useCursorPagination';
import { AppPage,Badge,Button,Card,Dialog,EmptyState,Input,LoadingState,PageHeader,TabBar } from '../ui';
import { formatCnyFromCents } from '../utils/currency';
import { getSafePercent } from '../utils/progress';
import { CursorPagination } from './CursorPagination';
import { PaginationFooter } from './PaginationFooter';

type TransactionFilter = 'all' | CreditType;

interface AccountCenterProps {
  account: AccountProfile;
  transactions: UserCreditLedgerEntry[];
  transactionFilter: TransactionFilter;
  transactionPagination?: CursorPaginationState;
  transactionLoading?: boolean;
  onTransactionFilterChange: (filter: TransactionFilter) => void;
  onTransactionPageNavigate: (position: PagePosition) => void;
  activeSection: 'overview' | 'orders' | 'referrals' | 'chatgpt';
  onSectionChange: (section: 'overview' | 'orders' | 'referrals' | 'chatgpt') => void;
  onOrderHistoryLoad: (input: {
    cursor?: string | null;
    snapshotCursor?: string | null;
    position?: PagePosition;
    limit: number;
    status: OrderHistoryFilter;
  }) => Promise<OrderHistoryPage>;
  onGenerationJobDetailLoad: (jobId: string) => Promise<AdminGenerationJob>;
  onAccountChange: (patch: Partial<AccountProfile>) => Promise<void>;
  onPasswordChange: (payload: { currentPassword: string; newPassword: string }) => Promise<void>;
  onLogout: () => void;
  onLogoutAllDevices: () => Promise<void>;
  onNavigate: (tab: string) => void;
  onAdminOpen: () => void;
}

export const ACCOUNT_ORDER_PAGE_SIZE = 20;

export function shouldReplaceOrderHistoryWithLoading(loading: boolean, itemCount: number) {
  return loading && itemCount === 0;
}

export function hasGenerationTaskDetail(transaction: UserCreditLedgerEntry) {
  return Boolean(transaction.generationSnapshot || transaction.relatedJobId);
}

export function shouldLoadCurrentGenerationTask(transaction: UserCreditLedgerEntry) {
  return !transaction.generationSnapshot && Boolean(transaction.relatedJobId);
}

const ACCOUNT_SECTIONS = [
  { id: 'overview' as const, label: '账户概览', icon: <UserRound className="h-4 w-4" /> },
  { id: 'orders' as const, label: '订单记录', icon: <ReceiptText className="h-4 w-4" /> },
  { id: 'referrals' as const, label: '邀约奖励', icon: <Coins className="h-4 w-4" /> },
  { id: 'chatgpt' as const, label: 'MCP 连接', icon: <ShieldCheck className="h-4 w-4" /> },
];

const ORDER_FILTER_TABS: { id: OrderHistoryFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '待支付' },
  { id: 'paid', label: '已支付' },
  { id: 'refunded', label: '已退款' },
  { id: 'failed', label: '支付失败' },
];

const FILTER_TABS: { id: TransactionFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'earn', label: '获得' },
  { id: 'hold', label: '预扣' },
  { id: 'spend', label: '消耗' },
  { id: 'refund', label: '退回' },
  { id: 'adjust', label: '调整' },
  { id: 'void', label: '冲销' },
];

const TRANSACTION_TYPE_META: Record<CreditType, { label: string; badge: 'success' | 'error' | 'blue' | 'purple' }> = {
  earn: { label: '获得', badge: 'success' },
  hold: { label: '预扣', badge: 'purple' },
  spend: { label: '消耗', badge: 'error' },
  refund: { label: '退回', badge: 'blue' },
  adjust: { label: '调整', badge: 'purple' },
  void: { label: '冲销', badge: 'error' },
};

const TRANSACTION_GRID_CLASS = 'grid grid-cols-[150px_90px_110px_110px_190px_minmax(220px,1fr)] gap-4';
const TRANSACTION_CELL_CLASS = 'min-h-7 flex items-center';

export function AccountCenter({ account, transactions, transactionFilter, transactionPagination, transactionLoading, onTransactionFilterChange, onTransactionPageNavigate, activeSection, onSectionChange, onOrderHistoryLoad, onGenerationJobDetailLoad, onAccountChange, onPasswordChange, onLogout, onLogoutAllDevices, onNavigate, onAdminOpen }: AccountCenterProps) {
  const [nameDraft, setNameDraft] = useState(account.userName);
  const [profileNameDraft, setProfileNameDraft] = useState(account.userName);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileError, setProfileError] = useState('');
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [orderFilter, setOrderFilter] = useState<OrderHistoryFilter>('all');
  const [orderPageRequest, setOrderPageRequest] = useState<CursorPageRequest>({ limit: ACCOUNT_ORDER_PAGE_SIZE, position: 'first' });
  const [orderHistory, setOrderHistory] = useState<OrderHistoryPage>({
    items: [],
    pagination: {
      limit: ACCOUNT_ORDER_PAGE_SIZE,
      position: 'first',
      hasPrevious: false,
      hasNext: false,
      previousCursor: null,
      nextCursor: null,
      currentPage: 0,
      totalPages: 0,
      totalItems: 0,
      snapshotCursor: '',
    },
  });
  const [orderHistoryLoading, setOrderHistoryLoading] = useState(false);
  const [orderHistoryError, setOrderHistoryError] = useState('');
  const [orderRefreshKey, setOrderRefreshKey] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState<AdminOrder | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<UserCreditLedgerEntry | null>(null);
  const [selectedGenerationJob, setSelectedGenerationJob] = useState<AdminGenerationJob | null>(null);
  const [generationDetailLoading, setGenerationDetailLoading] = useState(false);
  const [generationDetailError, setGenerationDetailError] = useState('');
  const generationDetailRequestRef = useRef(0);
  const orderSnapshotNoticeRef = useRef(false);

  useEffect(() => {
    setNameDraft(account.userName);
    setProfileNameDraft(account.userName);
  }, [account.userName]);

  useEffect(() => {
    if (activeSection !== 'orders') return;
    let canceled = false;
    setOrderHistoryLoading(true);
    setOrderHistoryError('');
    void onOrderHistoryLoad({
      cursor: orderPageRequest.cursor,
      snapshotCursor: orderPageRequest.snapshotCursor,
      position: orderPageRequest.position,
      limit: ACCOUNT_ORDER_PAGE_SIZE,
      status: orderFilter,
    })
      .then(result => {
        if (canceled) return;
        orderSnapshotNoticeRef.current = false;
        const recovery = result.items.length === 0
          ? getEmptyPageRecoveryRequest(orderPageRequest, result.pagination)
          : null;
        if (recovery) setOrderPageRequest(recovery);
        else setOrderHistory(result);
      })
      .catch(error => {
        if (canceled) return;
        if (isPaginationSnapshotChanged(error)) {
          setOrderPageRequest({ limit: ACCOUNT_ORDER_PAGE_SIZE, position: 'first' });
          if (!orderSnapshotNoticeRef.current) {
            orderSnapshotNoticeRef.current = true;
            toast.info('列表已更新，已返回第 1 页');
          }
          return;
        }
        setOrderHistoryError(error instanceof Error ? error.message : '订单记录加载失败');
      })
      .finally(() => {
        if (!canceled) setOrderHistoryLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [activeSection, orderFilter, orderPageRequest, orderRefreshKey, onOrderHistoryLoad]);

  const handleOrderFilterChange = (nextFilter: OrderHistoryFilter) => {
    if (nextFilter === orderFilter) return;
    setOrderPageRequest({ limit: ACCOUNT_ORDER_PAGE_SIZE, position: 'first' });
    setOrderFilter(nextFilter);
  };

  const handleOrderPageNavigate = (position: PagePosition) => {
    const cursor = position === 'previous'
      ? orderHistory.pagination.previousCursor
      : position === 'next'
        ? orderHistory.pagination.nextCursor
        : null;
    if ((position === 'previous' || position === 'next') && !cursor) return;
    setOrderPageRequest({
      limit: ACCOUNT_ORDER_PAGE_SIZE,
      position,
      cursor: cursor ?? undefined,
      snapshotCursor: orderHistory.pagination.snapshotCursor,
    });
  };

  const availablePercent = getSafePercent(account.availableCredits, account.totalCredits);

  const openProfileModal = () => {
    setProfileNameDraft(account.userName);
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setProfileError('');
    setIsProfileModalOpen(true);
  };

  const handleSaveProfile = async () => {
    if (profileSaving) return;
    const trimmedName = profileNameDraft.trim();
    const isChangingPassword = oldPassword || newPassword || confirmPassword;

    if (!trimmedName) {
      setProfileError('用户名不能为空');
      return;
    }

    if (isChangingPassword) {
      if (!oldPassword || !newPassword || !confirmPassword) {
        setProfileError('修改密码时需要填写旧密码、新密码和确认新密码');
        return;
      }

      if (newPassword !== confirmPassword) {
        setProfileError('两次输入的新密码不一致');
        return;
      }
      const passwordError = validateRegisterPassword(newPassword);
      if (passwordError) {
        setProfileError(passwordError);
        return;
      }
    }

    setProfileSaving(true);
    setProfileError('');
    try {
      if (trimmedName !== account.userName) await onAccountChange({ userName: trimmedName });
      if (isChangingPassword) {
        await onPasswordChange({ currentPassword: oldPassword, newPassword });
      }
      toast.success(isChangingPassword ? '资料与密码已更新' : '资料已保存');
      setSaved(true);
      setIsProfileModalOpen(false);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : '资料保存失败，请稍后重试');
    } finally {
      setProfileSaving(false);
    }
  };

  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const handleLogoutAllDevices = async () => {
    setLoggingOutAll(true);
    try {
      await onLogoutAllDevices();
    } finally {
      setLoggingOutAll(false);
      setIsLogoutModalOpen(false);
    }
  };
  const handleLogout = () => {
    setIsLogoutModalOpen(false);
    onLogout();
  };

  const openGenerationTransactionDetail = async (transaction: UserCreditLedgerEntry) => {
    if (generationDetailLoading) return;
    setSelectedTransaction(transaction);
    setSelectedGenerationJob(null);
    setGenerationDetailError('');
    if (transaction.generationSnapshot) {
      generationDetailRequestRef.current += 1;
      setGenerationDetailLoading(false);
      return;
    }
    if (!shouldLoadCurrentGenerationTask(transaction) || !transaction.relatedJobId) return;
    setGenerationDetailLoading(true);
    const requestId = ++generationDetailRequestRef.current;
    try {
      const job = await onGenerationJobDetailLoad(transaction.relatedJobId);
      if (generationDetailRequestRef.current === requestId) setSelectedGenerationJob(job);
    } catch (error) {
      if (generationDetailRequestRef.current === requestId) {
        setGenerationDetailError(error instanceof Error ? error.message : '生成任务详情加载失败');
      }
    } finally {
      if (generationDetailRequestRef.current === requestId) setGenerationDetailLoading(false);
    }
  };

  const closeGenerationTransactionDetail = () => {
    generationDetailRequestRef.current += 1;
    setSelectedTransaction(null);
    setSelectedGenerationJob(null);
    setGenerationDetailError('');
    setGenerationDetailLoading(false);
  };

  return (
    <AppPage width="standard" className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="ACCOUNT"
        title="账户中心"
        subtitle="管理账户资料、订阅权益、订单与积分流水"
        titleTone="solid"
        action={account.role === 'admin' ? (
          <Button
            size="md"
            variant="primary"
            icon={<ShieldCheck className="w-4 h-4" />}
            onClick={onAdminOpen}
          >
            进入管理后台
          </Button>
        ) : undefined}
      />

      <TabBar
        tabs={ACCOUNT_SECTIONS}
        active={activeSection}
        onChange={section => {
          setSelectedOrder(null);
          closeGenerationTransactionDetail();
          onSectionChange(section);
        }}
        variant="segment"
        className="max-w-2xl"
      />

      {activeSection === 'chatgpt' ? <ChatGptConnections /> : activeSection === 'referrals' ? <ReferralRewards /> : activeSection === 'overview' ? (
      <div className="space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <Card variant="raised" className="flex h-full min-w-0 flex-col p-5">
            <div className="flex items-center justify-between gap-4 mb-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]">
                  <UserRound className="h-5 w-5 text-violet-200" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">账户资料</h2>
                  <p className="text-xs text-gray-500 mt-1">当前账户详细资料，请妥善保管。</p>
                </div>
              </div>
              {saved && <Badge variant="success">已保存</Badge>}
            </div>

            <div className="space-y-4">
              <Input
                label="用户名"
                value={nameDraft}
                readOnly
                icon={<UserRound className="w-4 h-4" />}
                placeholder="请输入用户名"
                className="text-gray-300 cursor-default"
              />
              <Input
                label="注册邮箱"
                value={account.email}
                readOnly
                icon={<Mail className="w-4 h-4" />}
                className="text-gray-400 cursor-default"
              />
            </div>

            <div className="mt-auto pt-5 grid grid-cols-2 gap-3">
              <Button
                size="md"
                variant="primary"
                icon={<Save className="w-3.5 h-3.5" />}
                onClick={openProfileModal}
              >
                修改资料
              </Button>
              <Button
                size="md"
                variant="danger"
                icon={<LogOut className="w-3.5 h-3.5" />}
                onClick={() => setIsLogoutModalOpen(true)}
              >
                退出账号
              </Button>
            </div>
          </Card>

          <Card variant="raised" accent={account.hasActiveSubscription ? 'violet' : 'none'} className="flex h-full min-w-0 flex-col p-5">
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <h2 className="text-sm font-semibold text-white">当前订阅</h2>
                <p className="text-xs text-gray-500 mt-1">查看当前套餐与周期日期。</p>
              </div>
              <Badge variant="purple">{account.planName}</Badge>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
                <span className="text-gray-400">套餐周期</span>
                <span className="text-white">{account.hasActiveSubscription ? (account.billingCycle === 'yearly' ? '年付' : '月付') : '无订阅'}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
                <span className="text-gray-400">积分重置</span>
                <span className="text-white">{account.resetDate}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
                <span className="text-gray-400">到期日期</span>
                <span className="text-white">{account.expiresAt}</span>
              </div>
            </div>

            <Button
              className="mt-auto w-full"
              iconRight={<ArrowRight className="w-3.5 h-3.5" />}
              onClick={() => onNavigate('subscription')}
            >
              管理套餐
            </Button>
          </Card>

          <Card variant="raised" accent="pink" className="flex h-full min-w-0 flex-col p-5">
            <div className="flex items-center gap-3 mb-5">
              <div className="product-card-accent-icon flex h-10 w-10 items-center justify-center rounded-xl border">
                <Coins className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">积分概览</h2>
                <p className="text-xs text-gray-500 mt-1">按当前订阅周期统计。</p>
              </div>
            </div>

            <div>
              <p className="text-xs text-gray-500">当前积分</p>
              <p className="mt-1 text-4xl font-bold text-white">{account.availableCredits.toLocaleString()}</p>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">当前可用</span>
                <span className="text-gray-300">{account.availableCredits.toLocaleString()} / {account.totalCredits.toLocaleString()}</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--product-accent-violet)]"
                  style={{ width: `${availablePercent}%` }}
                />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-black/20 border border-white/5 p-3">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Zap className="w-3.5 h-3.5" />
                  可用比例
                </div>
                <p className="mt-1 text-lg font-semibold text-white">{availablePercent}%</p>
              </div>
              <div className="rounded-xl bg-black/20 border border-white/5 p-3">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <CalendarDays className="w-3.5 h-3.5" />
                  周期总量
                </div>
                <p className="mt-1 text-lg font-semibold text-white">{account.totalCredits.toLocaleString()}</p>
              </div>
            </div>
          </Card>
        </div>

        <Card variant="raised" className="overflow-hidden">
          <div className="p-5 border-b border-white/10 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]">
                <ReceiptText className="h-5 w-5 text-violet-200" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">积分流水</h2>
                <p className="text-xs text-gray-500 mt-1">查看积分获得、消耗与退回记录。</p>
              </div>
            </div>
            <TabBar tabs={FILTER_TABS} active={transactionFilter} onChange={onTransactionFilterChange} variant="pill" />
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              <div className={`${TRANSACTION_GRID_CLASS} items-center px-5 py-3 text-xs text-gray-500 border-b border-white/10`}>
                <span className={TRANSACTION_CELL_CLASS}>时间</span>
                <span className={TRANSACTION_CELL_CLASS}>类型</span>
                <span className={TRANSACTION_CELL_CLASS}>积分变动</span>
                <span className={TRANSACTION_CELL_CLASS}>余额</span>
                <span className={TRANSACTION_CELL_CLASS}>来源</span>
                <span className={TRANSACTION_CELL_CLASS}>备注</span>
              </div>
              <div className="divide-y divide-white/10">
                {transactions.map(item => {
                  const typeMeta = TRANSACTION_TYPE_META[item.type];
                  const isPositive = item.amount > 0;

                  return (
                    <div
                      key={item.id}
                      className={`${TRANSACTION_GRID_CLASS} items-center px-5 py-3 text-sm hover:bg-white/[0.03] transition-colors`}
                    >
                      <span className={`${TRANSACTION_CELL_CLASS} text-gray-400 whitespace-nowrap`}>{item.time}</span>
                      <span className={TRANSACTION_CELL_CLASS}>
                        <Badge variant={typeMeta.badge}>{typeMeta.label}</Badge>
                      </span>
                      <span className={`${TRANSACTION_CELL_CLASS} font-semibold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                        {isPositive ? '+' : ''}{item.amount.toLocaleString()}
                      </span>
                      <span className={`${TRANSACTION_CELL_CLASS} text-white`}>{item.balance.toLocaleString()}</span>
                      <span className={`${TRANSACTION_CELL_CLASS} text-gray-300 truncate`}>{item.source}</span>
                      <div className={`${TRANSACTION_CELL_CLASS} min-w-0 justify-between gap-3`}>
                        <span className="min-w-0 truncate text-gray-500">{item.note}</span>
                        {hasGenerationTaskDetail(item) && (
                          <button
                            type="button"
                            onClick={() => void openGenerationTransactionDetail(item)}
                            className="inline-flex flex-shrink-0 items-center gap-1 text-xs font-medium text-violet-300 hover:text-violet-200"
                          >
                            <Eye className="h-3.5 w-3.5" />任务详情
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <PaginationFooter count={transactions.length} totalItems={transactionPagination?.totalItems ?? transactions.length} totalPages={transactionPagination?.totalPages} loading={transactionLoading} className="border-t border-white/10 px-5 py-3">
            {transactionPagination && (
              <CursorPagination
                pagination={transactionPagination}
                loading={transactionLoading}
                empty={transactions.length === 0}
                onNavigate={onTransactionPageNavigate}
                label="积分流水翻页"
              />
            )}
          </PaginationFooter>
        </Card>
      </div>
      ) : (
        <OrderHistoryPanel
          history={orderHistory}
          filter={orderFilter}
          loading={orderHistoryLoading}
          error={orderHistoryError}
          onFilterChange={handleOrderFilterChange}
          onPageNavigate={handleOrderPageNavigate}
          onRefresh={() => setOrderRefreshKey(key => key + 1)}
          onOrderOpen={setSelectedOrder}
        />
      )}

      <AnimatePresence>
        {selectedTransaction && (
          <GenerationTransactionDetailModal
            transaction={selectedTransaction}
            job={selectedGenerationJob}
            loading={generationDetailLoading}
            error={generationDetailError}
            onRetry={() => void openGenerationTransactionDetail(selectedTransaction)}
            onClose={closeGenerationTransactionDetail}
          />
        )}
        {selectedOrder && (
          <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
        )}
        {isProfileModalOpen && (
          <Dialog
            onClose={() => setIsProfileModalOpen(false)}
            titleId="account-profile-dialog-title"
            closeDisabled={profileSaving}
            panelClassName="max-w-xl"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
              className="relative w-full"
            >
              <Card variant="modal" className="p-5">
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div>
                    <h2 id="account-profile-dialog-title" className="text-lg font-bold text-white">修改资料</h2>
                    <p className="text-xs text-gray-500 mt-1">修改用户名，或同时更新账户密码。</p>
                  </div>
                  <button
                    type="button"
                    aria-label="关闭修改资料窗口"
                    disabled={profileSaving}
                    onClick={() => setIsProfileModalOpen(false)}
                    className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-colors disabled:cursor-wait disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-5">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <UserRound className="w-4 h-4 text-purple-300" />
                      修改用户名
                    </div>
                    <Input
                      label="用户名"
                      value={profileNameDraft}
                      onChange={event => {
                        setProfileNameDraft(event.target.value);
                        setProfileError('');
                      }}
                      icon={<UserRound className="w-4 h-4" />}
                      placeholder="请输入用户名"
                    />
                  </div>

                  <div className="space-y-3 pt-4 border-t border-white/10">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <KeyRound className="w-4 h-4 text-purple-300" />
                      修改密码
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      <Input
                        label="旧密码"
                        type="password"
                        value={oldPassword}
                        onChange={event => {
                          setOldPassword(event.target.value);
                          setProfileError('');
                        }}
                        icon={<ShieldCheck className="w-4 h-4" />}
                        placeholder="请输入旧密码"
                      />
                      <Input
                        label="新密码"
                        type="password"
                        value={newPassword}
                        onChange={event => {
                          setNewPassword(event.target.value);
                          setProfileError('');
                        }}
                        icon={<KeyRound className="w-4 h-4" />}
                        placeholder="请输入新密码"
                      />
                      <Input
                        label="确认新密码"
                        type="password"
                        value={confirmPassword}
                        onChange={event => {
                          setConfirmPassword(event.target.value);
                          setProfileError('');
                        }}
                        icon={<KeyRound className="w-4 h-4" />}
                        placeholder="请再次输入新密码"
                      />
                    </div>
                  </div>

                  {profileError && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                      {profileError}
                    </div>
                  )}
                </div>

                <div className="mt-6 flex items-center justify-end gap-3">
                  <Button variant="secondary" disabled={profileSaving} onClick={() => setIsProfileModalOpen(false)}>
                    取消
                  </Button>
                  <Button loading={profileSaving} disabled={profileSaving} onClick={() => void handleSaveProfile()}>
                    {profileSaving ? '正在保存' : '保存修改'}
                  </Button>
                </div>
              </Card>
            </motion.div>
          </Dialog>
        )}

        {isLogoutModalOpen && (
          <Dialog
            onClose={() => setIsLogoutModalOpen(false)}
            role="alertdialog"
            titleId="logout-dialog-title"
            panelClassName="max-w-md"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
              className="relative w-full"
            >
              <Card variant="modal" className="p-5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center flex-shrink-0">
                    <LogOut className="w-5 h-5 text-red-300" />
                  </div>
                  <div>
                    <h2 id="logout-dialog-title" className="text-lg font-bold text-white">退出账号</h2>
                    <p className="text-sm text-gray-400 mt-2">确认退出当前账号吗？选择“退出所有设备”会让其他浏览器和 MCP 客户端的登录一并失效。</p>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-end gap-3">
                  <Button data-dialog-initial-focus variant="secondary" onClick={() => setIsLogoutModalOpen(false)}>
                    取消
                  </Button>
                  <Button variant="secondary" loading={loggingOutAll} onClick={() => void handleLogoutAllDevices()}>
                    退出所有设备
                  </Button>
                  <Button variant="danger" onClick={handleLogout}>
                    确认退出
                  </Button>
                </div>
              </Card>
            </motion.div>
          </Dialog>
        )}
      </AnimatePresence>
    </AppPage>
  );
}

export function getGenerationBillingSnapshot(job: AdminGenerationJob) {
  const config = job.configData ?? {};
  const referenceAssets = Array.isArray(config.referenceAssets) ? config.referenceAssets : [];
  const hasReferenceVideo = referenceAssets.some(reference => {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return false;
    const item = reference as Record<string, unknown>;
    return item.type === 'video' || item.role === 'reference_video';
  });
  const durationSeconds = typeof config.durationSeconds === 'number' && Number.isFinite(config.durationSeconds)
    ? `${config.durationSeconds}s`
    : '-';
  const resolution = typeof config.resolution === 'string' && config.resolution.trim()
    ? config.resolution
    : '-';
  const statusLabels: Record<AdminGenerationJob['status'], string> = {
    queued: '排队中',
    processing: '生成中',
    completed: '已完成',
    failed: '失败',
    canceled: '已取消',
  };
  const creditStatusLabels: Record<AdminGenerationJob['creditStatus'], string> = {
    none: '未结算',
    held: '冻结中',
    settled: '已结算',
    refunded: '已退回',
    reversed: '已撤销',
  };
  return {
    model: job.model,
    duration: durationSeconds,
    resolution,
    hasReferenceVideo,
    reservedCredits: job.reservedCredits,
    settledCredits: job.settledCredits,
    refundedCredits: job.refundedCredits,
    status: statusLabels[job.status],
    creditStatus: creditStatusLabels[job.creditStatus],
  };
}

/** 用户流水优先读取随该笔账务事件落库的快照，绝不反查同 task 的最新 attempt。 */
export function getLedgerGenerationBillingSnapshot(transaction: UserCreditLedgerEntry) {
  const snapshot = transaction.generationSnapshot;
  if (!snapshot) return null;
  const statusLabels: Record<typeof snapshot.taskStatus, string> = {
    queued: '排队中',
    processing: '生成中',
    completed: '已完成',
    failed: '失败',
    canceled: '已取消',
  };
  const creditStatusLabels: Record<typeof snapshot.creditStatus, string> = {
    none: '未结算',
    held: '冻结中',
    settled: '已结算',
    refunded: '已退回',
    reversed: '已撤销',
  };
  return {
    attempt: snapshot.attempt,
    model: snapshot.model,
    duration: snapshot.durationSeconds === null ? '-' : `${snapshot.durationSeconds}s`,
    resolution: snapshot.resolution ?? '-',
    hasReferenceVideo: snapshot.hasReferenceVideo,
    reservedCredits: snapshot.reservedCredits,
    settledCredits: snapshot.settledCredits,
    refundedCredits: snapshot.refundedCredits,
    status: statusLabels[snapshot.taskStatus],
    creditStatus: creditStatusLabels[snapshot.creditStatus],
    rawStatus: snapshot.taskStatus,
  };
}

function GenerationTransactionDetailModal({
  transaction,
  job,
  loading,
  error,
  onRetry,
  onClose,
}: {
  transaction: UserCreditLedgerEntry;
  job: AdminGenerationJob | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  const ledgerSnapshot = getLedgerGenerationBillingSnapshot(transaction);
  const snapshot = ledgerSnapshot ?? (job ? getGenerationBillingSnapshot(job) : null);
  const rawStatus = ledgerSnapshot?.rawStatus ?? job?.status;
  const statusBadge = rawStatus === 'completed'
    ? 'success'
    : rawStatus === 'failed'
      ? 'error'
      : rawStatus === 'canceled'
        ? 'blue'
        : 'warning';
  return (
    <Dialog onClose={onClose} titleId="generation-transaction-detail-title" panelClassName="max-w-2xl">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="relative w-full">
        <Card variant="modal" className="max-h-[85vh] overflow-y-auto p-5">
          <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-5">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="generation-transaction-detail-title" className="text-lg font-bold text-white">生成任务账单详情</h2>
                {snapshot && <Badge variant={statusBadge}>{snapshot.status}</Badge>}
              </div>
              <p className="mt-2 break-all text-xs text-gray-500">流水时间：{transaction.time} · 任务 ID：{transaction.relatedJobId}</p>
            </div>
            <button type="button" aria-label="关闭生成任务账单详情" onClick={onClose} className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          {loading ? (
            <LoadingState label="正在加载生成任务快照" />
          ) : error ? (
            <div className="py-8 text-center">
              <p className="text-sm text-red-300">{error}</p>
              <p className="mt-2 text-xs text-gray-500">任务可能已删除或暂时无法访问，请刷新后重试。</p>
              <Button className="mt-4" size="sm" onClick={onRetry}>重新加载</Button>
            </div>
          ) : snapshot ? (
            <>
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <OrderDetailItem label="模型" value={snapshot.model} />
                {ledgerSnapshot && <OrderDetailItem label="执行批次" value={`第 ${ledgerSnapshot.attempt + 1} 次执行（attempt ${ledgerSnapshot.attempt}）`} />}
                <OrderDetailItem label="本笔状态快照" value={`${snapshot.status} · ${snapshot.creditStatus}`} />
                <OrderDetailItem label="视频时长" value={snapshot.duration} />
                <OrderDetailItem label="分辨率" value={snapshot.resolution} />
                <OrderDetailItem label="含参考视频" value={snapshot.hasReferenceVideo ? '是' : '否'} />
                <OrderDetailItem label="本笔流水金额" value={`${transaction.amount > 0 ? '+' : ''}${transaction.amount.toLocaleString()} 积分`} />
                <OrderDetailItem label="本 attempt 预扣基准" value={`${snapshot.reservedCredits.toLocaleString()} 积分`} />
                <OrderDetailItem label="本笔实扣" value={`${snapshot.settledCredits.toLocaleString()} 积分`} emphasize />
                <OrderDetailItem label="本笔退回" value={`${snapshot.refundedCredits.toLocaleString()} 积分`} />
              </div>
              {!ledgerSnapshot && job?.failReason && (
                <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  失败原因：{job.failReason}
                </div>
              )}
              <p className="mt-4 text-xs leading-5 text-gray-500">这里展示该笔生成流水落账时的 attempt、规格与事件级积分事实；“本笔实扣/退回”为 0 仅表示该事件未发生对应动作，不代表同一 attempt 的其他流水合计。后续管理员重试不会改写；套餐或支付订单退款请在“订单记录”查看。</p>
            </>
          ) : null}

          <div className="mt-6 flex justify-end">
            <Button variant="secondary" onClick={onClose}>关闭</Button>
          </div>
        </Card>
      </motion.div>
    </Dialog>
  );
}

function OrderHistoryPanel({
  history,
  filter,
  loading,
  error,
  onFilterChange,
  onPageNavigate,
  onRefresh,
  onOrderOpen,
}: {
  history: OrderHistoryPage;
  filter: OrderHistoryFilter;
  loading: boolean;
  error: string;
  onFilterChange: (filter: OrderHistoryFilter) => void;
  onPageNavigate: (position: PagePosition) => void;
  onRefresh: () => void;
  onOrderOpen: (order: AdminOrder) => void;
}) {
  const { items, pagination } = history;

  return (
    <Card variant="raised" className="overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-white/10 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]">
            <ReceiptText className="h-5 w-5 text-violet-200" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">历史订单</h2>
            <p className="mt-1 text-xs text-gray-500">查看套餐和积分加购包的支付记录。</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TabBar tabs={ORDER_FILTER_TABS} active={filter} onChange={onFilterChange} variant="pill" />
          <button
            type="button"
            aria-label="刷新订单记录"
            onClick={onRefresh}
            disabled={loading}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {shouldReplaceOrderHistoryWithLoading(loading, items.length) ? (
        <LoadingState label="正在加载订单记录" />
      ) : error ? (
        <EmptyState
          icon={<PackageOpen className="h-12 w-12" />}
          title={error}
          subtitle="请检查网络连接后重试。"
          action={(
            <div className="flex items-center gap-2">
              {pagination.hasPrevious && <Button size="sm" variant="secondary" onClick={() => onPageNavigate('previous')}>返回上一页</Button>}
              <Button size="sm" onClick={onRefresh}>重新加载</Button>
            </div>
          )}
        />
      ) : (
        <>
          {items.length === 0 ? (
            <EmptyState
              icon={<ReceiptText className="h-12 w-12" />}
              title={filter === 'all' ? '暂无历史订单' : '暂无符合条件的订单'}
              subtitle="完成套餐或积分加购包购买后，订单会显示在这里。"
            />
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[950px]">
                <div className="grid grid-cols-[minmax(240px,1.5fr)_140px_120px_130px_170px_80px] gap-4 border-b border-white/10 px-5 py-3 text-xs text-gray-500">
                  <span>订单 / 套餐</span>
                  <span>类型</span>
                  <span>金额</span>
                  <span>状态</span>
                  <span>创建时间</span>
                  <span>操作</span>
                </div>
                <div className="divide-y divide-white/10">
                  {items.map(order => {
                    const status = orderStatusMeta(order);
                    return (
                      <div key={order.id} className="grid grid-cols-[minmax(240px,1.5fr)_140px_120px_130px_170px_80px] items-center gap-4 px-5 py-4 text-sm transition-colors hover:bg-white/[0.03]">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-white">{order.planName}</p>
                          <p className="mt-1 truncate text-xs text-gray-500">{order.merchantOrderNo ?? order.id}</p>
                        </div>
                        <span className="text-gray-300">{order.kind === 'addon' ? '积分加购包' : billingCycleLabel(order.billing)}</span>
                        <span className="font-semibold text-white">{formatCnyFromCents(order.amount)}</span>
                        <span><Badge variant={status.badge} dot={order.status === 'pending'}>{status.label}</Badge></span>
                        <span className="whitespace-nowrap text-gray-400">{order.createdAt}</span>
                        <button
                          type="button"
                          onClick={() => onOrderOpen(order)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-300 transition-colors hover:text-purple-200"
                        >
                          <Eye className="h-3.5 w-3.5" />详情
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {(items.length > 0 || pagination.hasPrevious || pagination.hasNext) && (
            <PaginationFooter count={items.length} totalItems={pagination.totalItems} totalPages={pagination.totalPages} loading={loading} className="border-t border-white/10 px-5 py-3">
              <CursorPagination pagination={pagination} loading={loading} empty={items.length === 0} onNavigate={onPageNavigate} label="历史订单翻页" />
            </PaginationFooter>
          )}
        </>
      )}
    </Card>
  );
}

function OrderDetailModal({ order, onClose }: { order: AdminOrder; onClose: () => void }) {
  const status = orderStatusMeta(order);
  const paymentMethod = order.paymentWayLabel ?? order.paymentMethodLabel ?? order.paymentMethod;
  const creditStatus = order.creditStatus === 'settled'
    ? '已到账'
    : order.creditStatus === 'reversed' || order.creditStatus === 'refunded'
      ? '已冲销'
      : '未到账';

  return (
    <Dialog onClose={onClose} titleId="account-order-detail-title" panelClassName="max-w-2xl">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="relative w-full">
        <Card variant="modal" className="max-h-[85vh] overflow-y-auto p-5">
          <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-5">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="account-order-detail-title" className="text-lg font-bold text-white">订单详情</h2>
                <Badge variant={status.badge} dot={order.status === 'pending'}>{status.label}</Badge>
              </div>
              <p className="mt-2 break-all text-xs text-gray-500">订单编号：{order.merchantOrderNo ?? order.id}</p>
            </div>
            <button type="button" aria-label="关闭订单详情" onClick={onClose} className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <OrderDetailItem label="套餐" value={order.planName} />
            <OrderDetailItem label="订单类型" value={order.kind === 'addon' ? '积分加购包' : '主套餐'} />
            <OrderDetailItem label="计费方式" value={billingCycleLabel(order.billing)} />
            <OrderDetailItem label="订单金额" value={formatCnyFromCents(order.amount)} emphasize />
            <OrderDetailItem label="支付方式" value={paymentMethod} />
            {order.paymentAttemptStatus && <OrderDetailItem label="支付进度" value={paymentAttemptStatusLabel(order.paymentAttemptStatus)} />}
            {order.paymentAttemptId && <OrderDetailItem label="支付 attempt ID" value={order.paymentAttemptId} />}
            {formatRetryAfterMs(order.paymentRetryAfterMs) && <OrderDetailItem label="支付重试时间" value={formatRetryAfterMs(order.paymentRetryAfterMs)!} />}
            <OrderDetailItem label="开票状态" value={order.invoiceStatus === 'issued' ? '已开票' : '未开票'} />
            <OrderDetailItem label="到账积分" value={`${order.creditAmount.toLocaleString()} 积分`} />
            <OrderDetailItem label="积分状态" value={creditStatus} />
            <OrderDetailItem label="创建时间" value={order.createdAt} />
            {order.paymentExpiresAt && <OrderDetailItem label="订单失效时间" value={order.paymentExpiresAt} />}
            {order.paidAt && <OrderDetailItem label="支付时间" value={order.paidAt} />}
            {order.failedAt && <OrderDetailItem label="失败时间" value={order.failedAt} />}
            {order.refundedAt && <OrderDetailItem label="退款时间" value={order.refundedAt} />}
            {order.paymentOrderNo && <OrderDetailItem label="支付单号" value={order.paymentOrderNo} />}
            {order.refundAttemptStatus && <OrderDetailItem label="退款进度" value={refundAttemptStatusLabel(order.refundAttemptStatus)} />}
            {order.refundAttemptId && <OrderDetailItem label="退款 attempt ID" value={order.refundAttemptId} />}
            {formatRetryAfterMs(order.refundRetryAfterMs) && <OrderDetailItem label="退款重试时间" value={formatRetryAfterMs(order.refundRetryAfterMs)!} />}
          </div>

          {order.status === 'failed' && order.paymentError && (
            <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              支付失败原因：{order.paymentError}
            </div>
          )}

          {order.paymentAttemptError && order.paymentAttemptError !== order.paymentError && (
            <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              支付进度说明：{order.paymentAttemptError}
            </div>
          )}

          {order.refundManualReviewReason && (
            <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              退款人工核对原因：{order.refundManualReviewReason}
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <Button variant="secondary" onClick={onClose}>关闭</Button>
          </div>
        </Card>
      </motion.div>
    </Dialog>
  );
}

function OrderDetailItem({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 break-all text-sm ${emphasize ? 'font-semibold text-white' : 'text-gray-200'}`}>{value}</p>
    </div>
  );
}

function orderStatusMeta(order: AdminOrder): { label: string; badge: 'success' | 'warning' | 'error' | 'blue' } {
  if (order.status === 'refunded' || order.refundAttemptStatus === 'succeeded') return { label: '已退款', badge: 'blue' };
  if (order.refundAttemptStatus === 'manual-review') return { label: '退款待人工核对', badge: 'warning' };
  if (order.refundAttemptStatus && ['queued', 'processing', 'submitted', 'uncertain'].includes(order.refundAttemptStatus)) {
    return { label: '退款处理中', badge: 'warning' };
  }
  if (order.refundAttemptStatus === 'failed') return { label: '退款失败', badge: 'error' };
  if (order.status === 'paid') return { label: '已支付', badge: 'success' };
  if (order.paymentAttemptStatus === 'manual-review') return { label: '需人工核对', badge: 'warning' };
  if (order.paymentAttemptStatus === 'uncertain') return { label: '支付确认中', badge: 'warning' };
  if (order.paymentAttemptStatus === 'queued' || order.paymentAttemptStatus === 'processing') {
    return { label: '支付入口准备中', badge: 'warning' };
  }
  if (order.status === 'failed' || order.paymentAttemptStatus === 'closed' || order.paymentAttemptStatus === 'failed') {
    return { label: '支付失败', badge: 'error' };
  }
  if (order.status === 'pending') return { label: '待支付', badge: 'warning' };
  return { label: '支付失败', badge: 'error' };
}

function billingCycleLabel(billing: AdminOrder['billing']) {
  if (billing === 'yearly') return '年付';
  if (billing === 'monthly') return '月付';
  return '一次性购买';
}
