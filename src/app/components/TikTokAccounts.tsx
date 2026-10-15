import { ChevronLeft,ChevronRight,Clock,Globe2,Megaphone,Pencil,Plus,ShieldOff,Store,Trash2,Users,X } from 'lucide-react';
import { AnimatePresence,motion } from 'motion/react';
import { useState } from 'react';
import { AppPage,Badge,Button,Card,Dialog,PageHeader,TabBar,Textarea } from '../ui';

type AccountType = 'commerce' | 'traffic';
type AccountStatus = 'active' | 'expired' | 'revoked';
type AccountFilter = 'all' | AccountType;

interface TikTokAccount {
  id: string;
  name: string;
  country: string;
  type: AccountType;
  authorizedAt: string;
  status: AccountStatus;
  note: string;
}

type PendingAction = {
  type: 'delete' | 'revoke';
  account: TikTokAccount;
} | null;

const BASE_ACCOUNTS: TikTokAccount[] = [
  {
    id: 'acc-1',
    name: '@lindyson_official',
    country: '美国',
    type: 'commerce',
    authorizedAt: '2026-06-02 14:32',
    status: 'active',
    note: '主店铺账号，用于新品发布与直播切片',
  },
  {
    id: 'acc-2',
    name: '@brand_store_hk',
    country: '中国香港',
    type: 'commerce',
    authorizedAt: '2026-05-28 09:18',
    status: 'active',
    note: '跨境电商账号，绑定商品橱窗',
  },
  {
    id: 'acc-3',
    name: '@creator_pro',
    country: '英国',
    type: 'traffic',
    authorizedAt: '2026-05-19 21:06',
    status: 'expired',
    note: '',
  },
  {
    id: 'acc-4',
    name: '@lindyson_lab',
    country: '新加坡',
    type: 'traffic',
    authorizedAt: '2026-04-30 16:45',
    status: 'revoked',
    note: '测试账号，已停止自动发布',
  },
];

const GENERATED_ACCOUNTS: TikTokAccount[] = Array.from({ length: 20 }, (_, index) => {
  const number = index + 5;
  const isCommerce = index % 2 === 0;
  const type: AccountType = isCommerce ? 'commerce' : 'traffic';
  const countries = ['美国', '英国', '新加坡', '日本', '泰国'];
  const status = (['active', 'active', 'expired', 'revoked'] as AccountStatus[])[index % 4];

  return {
    id: `acc-${number}`,
    name: isCommerce ? `@store_growth_${number}` : `@creator_flow_${number}`,
    country: countries[index % countries.length],
    type,
    authorizedAt: `2026-05-${String(24 - (index % 18)).padStart(2, '0')} ${String(10 + (index % 9)).padStart(2, '0')}:20`,
    status,
    note: index % 3 === 0 ? '' : isCommerce ? '区域电商账号，用于商品内容发布' : '流量测试账号，用于达人内容分发',
  };
});

const INITIAL_ACCOUNTS: TikTokAccount[] = [...BASE_ACCOUNTS, ...GENERATED_ACCOUNTS];

const TYPE_CONFIG: Record<AccountType, { label: string; variant: 'orange' | 'blue'; icon: typeof Store }> = {
  commerce: { label: '电商账号', variant: 'orange', icon: Store },
  traffic: { label: '流量账号', variant: 'blue', icon: Megaphone },
};

const STATUS_CONFIG: Record<AccountStatus, { label: string; variant: 'success' | 'warning' | 'default' }> = {
  active: { label: '已授权', variant: 'success' },
  expired: { label: '授权过期', variant: 'warning' },
  revoked: { label: '已取消授权', variant: 'default' },
};

const ACCOUNT_TABLE_COLUMNS = 'grid-cols-[1.25fr_0.75fr_0.85fr_minmax(150px,1fr)_0.8fr_minmax(150px,1.5fr)_190px]';
const ACCOUNT_CELL_CLASS = 'min-h-8 flex items-center';
const ACCOUNT_STACK_CELL_CLASS = 'min-h-10 flex flex-col justify-center';
const ACCOUNT_PAGE_SIZE = 10;
const ACCOUNT_FILTER_TABS: { id: AccountFilter; label: string }[] = [
  { id: 'all', label: '全部账号' },
  { id: 'commerce', label: '电商账号' },
  { id: 'traffic', label: '流量账号' },
];

export function TikTokAccounts() {
  const [accounts, setAccounts] = useState<TikTokAccount[]>(INITIAL_ACCOUNTS);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [isAuthorizeModalOpen, setIsAuthorizeModalOpen] = useState(false);
  const [editingNoteAccount, setEditingNoteAccount] = useState<TikTokAccount | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);

  const activeCount = accounts.filter(account => account.status === 'active').length;
  const commerceCount = accounts.filter(account => account.type === 'commerce').length;
  const trafficCount = accounts.filter(account => account.type === 'traffic').length;
  const filteredAccounts = accountFilter === 'all'
    ? accounts
    : accounts.filter(account => account.type === accountFilter);
  const totalPages = Math.max(1, Math.ceil(filteredAccounts.length / ACCOUNT_PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pagedAccounts = filteredAccounts.slice((safePage - 1) * ACCOUNT_PAGE_SIZE, safePage * ACCOUNT_PAGE_SIZE);

  const handleFilterChange = (filter: AccountFilter) => {
    setAccountFilter(filter);
    setCurrentPage(1);
  };

  const confirmAction = () => {
    if (!pendingAction) return;

    if (pendingAction.type === 'delete') {
      setAccounts(prev => prev.filter(account => account.id !== pendingAction.account.id));
    } else {
      setAccounts(prev => prev.map(account =>
        account.id === pendingAction.account.id ? { ...account, status: 'revoked' } : account
      ));
    }

    setPendingAction(null);
  };

  const openNoteEditor = (account: TikTokAccount) => {
    setEditingNoteAccount(account);
    setNoteDraft(account.note);
  };

  const saveNote = () => {
    if (!editingNoteAccount) return;

    setAccounts(prev => prev.map(account =>
      account.id === editingNoteAccount.id ? { ...account, note: noteDraft.trim() } : account
    ));
    setEditingNoteAccount(null);
    setNoteDraft('');
  };

  return (
    <AppPage width="wide" className="space-y-6">
      <PageHeader
        eyebrow="TIKTOK ACCOUNTS"
        title="管理TikTok账号"
        subtitle="查看授权账号、账号类型与授权状态"
        titleTone="solid"
        className="mb-2"
        action={
          <Button
            size="md"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setIsAuthorizeModalOpen(true)}
          >
            新增授权
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: '已授权账号', value: activeCount, icon: Users },
          { label: '电商账号', value: commerceCount, icon: Store },
          { label: '流量账号', value: trafficCount, icon: Megaphone },
        ].map(item => {
          const Icon = item.icon;
          return (
            <Card key={item.label} variant="raised" accent="slate" className="flex items-center gap-4 p-4">
              <div className="product-card-accent-icon flex h-10 w-10 items-center justify-center rounded-xl border">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{item.value}</p>
                <p className="text-xs text-gray-400">{item.label}</p>
              </div>
            </Card>
          );
        })}
      </div>

      <TabBar
        tabs={ACCOUNT_FILTER_TABS}
        active={accountFilter}
        onChange={handleFilterChange}
        variant="segment"
        className="max-w-xl"
      />

      <Card variant="raised" className="overflow-hidden">
        <div className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-400" role="region" aria-label="TikTok 账号列表" tabIndex={0}>
          <div className="min-w-[1180px]">
        <div className={`grid ${ACCOUNT_TABLE_COLUMNS} gap-4 items-center px-5 py-3 border-b border-white/10 text-xs text-gray-500`}>
          <span className={ACCOUNT_CELL_CLASS}>账号名称</span>
          <span className={ACCOUNT_CELL_CLASS}>所属国家</span>
          <span className={ACCOUNT_CELL_CLASS}>账号类型</span>
          <span className={`${ACCOUNT_CELL_CLASS} whitespace-nowrap`}>授权时间</span>
          <span className={ACCOUNT_CELL_CLASS}>状态</span>
          <span className={ACCOUNT_CELL_CLASS}>备注</span>
          <span className={`${ACCOUNT_CELL_CLASS} justify-end text-right`}>操作</span>
        </div>

        <div className="divide-y divide-white/10">
          {pagedAccounts.map(account => {
            const type = TYPE_CONFIG[account.type];
            const status = STATUS_CONFIG[account.status];
            const TypeIcon = type.icon;
            const isRevoked = account.status === 'revoked';

            return (
              <motion.div
                key={account.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }} transition={{ duration: 0.18 }}
                className={`grid ${ACCOUNT_TABLE_COLUMNS} gap-4 px-5 py-4 items-center hover:bg-white/5 transition-colors`}
              >
                <div className={`${ACCOUNT_STACK_CELL_CLASS} min-w-0`}>
                  <p className="text-sm font-medium text-white truncate">{account.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">ID: {account.id}</p>
                </div>
                <div className={`${ACCOUNT_CELL_CLASS} gap-1.5 text-sm text-gray-300`}>
                  <Globe2 className="w-3.5 h-3.5 text-gray-500" />
                  {account.country}
                </div>
                <div className={ACCOUNT_CELL_CLASS}>
                  <Badge variant={type.variant} className="w-fit">
                    <TypeIcon className="w-3 h-3" />
                    {type.label}
                  </Badge>
                </div>
                <div className={`${ACCOUNT_CELL_CLASS} gap-1.5 text-sm text-gray-400 whitespace-nowrap`}>
                  <Clock className="w-3.5 h-3.5 shrink-0 text-gray-500" />
                  <span>{account.authorizedAt}</span>
                </div>
                <div className={ACCOUNT_CELL_CLASS}>
                  <Badge variant={status.variant} dot>
                    {status.label}
                  </Badge>
                </div>
                <div className={`${ACCOUNT_CELL_CLASS} min-w-0`}>
                  {account.note.trim() ? (
                    <button
                      type="button"
                      onClick={() => openNoteEditor(account)}
                      className="min-w-0 text-left text-sm text-gray-400 truncate hover:text-purple-300 transition-colors"
                      aria-label={`修改 ${account.name} 的备注`}
                      title="修改备注"
                    >
                      {account.note}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openNoteEditor(account)}
                      className="w-fit inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-white/5 hover:text-purple-300 transition-colors"
                      aria-label={`修改 ${account.name} 的备注`}
                      title="修改备注"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      暂无备注
                    </button>
                  )}
                </div>
                <div className={`${ACCOUNT_CELL_CLASS} justify-end gap-2 whitespace-nowrap`}>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isRevoked}
                    icon={<ShieldOff className="w-3.5 h-3.5" />}
                    onClick={() => setPendingAction({ type: 'revoke', account })}
                    className={isRevoked ? 'opacity-40 whitespace-nowrap' : 'whitespace-nowrap'}
                  >
                    取消授权
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<Trash2 className="w-3.5 h-3.5" />}
                    onClick={() => setPendingAction({ type: 'delete', account })}
                    className="whitespace-nowrap"
                  >
                    删除
                  </Button>
                </div>
              </motion.div>
            );
          })}
        </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-white/10 px-5 py-3">
          <p className="text-xs text-gray-500">
            共 <span className="text-white">{filteredAccounts.length}</span> 个账号，第 <span className="text-white">{safePage}</span> / {totalPages} 页
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage(page => Math.max(1, page - 1))}
              disabled={safePage === 1}
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              aria-label="上一页"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}
              disabled={safePage === totalPages}
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              aria-label="下一页"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </Card>

      <AnimatePresence>
        {isAuthorizeModalOpen && (
          <Dialog
            onClose={() => setIsAuthorizeModalOpen(false)}
            titleId="tiktok-authorize-title"
            panelClassName="max-w-[420px]"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
              className="w-full"
            >
              <Card variant="modal" className="w-full p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 id="tiktok-authorize-title" className="text-lg font-bold text-white">新增授权</h2>
                    <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                      当前为前端预览模式。后续接入 TikTok OAuth 后，可从这里发起账号授权并同步账号信息。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAuthorizeModalOpen(false)}
                    className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                  >
                    <X className="w-4 h-4 text-gray-400" />
                  </button>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setIsAuthorizeModalOpen(false)}>
                    取消
                  </Button>
                  <Button size="sm" onClick={() => setIsAuthorizeModalOpen(false)}>
                    开始授权
                  </Button>
                </div>
              </Card>
            </motion.div>
          </Dialog>
        )}

        {pendingAction && (
          <Dialog
            onClose={() => setPendingAction(null)}
            role="alertdialog"
            titleId="tiktok-account-action-title"
            panelClassName="max-w-[420px]"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
              className="w-full"
            >
              <Card variant="modal" className="w-full p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 id="tiktok-account-action-title" className="text-lg font-bold text-white">
                      {pendingAction.type === 'delete' ? '删除账号' : '取消授权'}
                    </h2>
                    <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                      {pendingAction.type === 'delete'
                        ? `确认删除 ${pendingAction.account.name}？删除后该账号将从列表中移除。`
                        : `确认取消 ${pendingAction.account.name} 的授权？取消后将无法继续发布内容。`
                      }
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingAction(null)}
                    className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                  >
                    <X className="w-4 h-4 text-gray-400" />
                  </button>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setPendingAction(null)}>
                    取消
                  </Button>
                  <Button
                    variant={pendingAction.type === 'delete' ? 'danger' : 'primary'}
                    size="sm"
                    onClick={confirmAction}
                  >
                    {pendingAction.type === 'delete' ? '确认删除' : '确认取消授权'}
                  </Button>
                </div>
              </Card>
            </motion.div>
          </Dialog>
        )}

        {editingNoteAccount && (
          <Dialog
            onClose={() => setEditingNoteAccount(null)}
            titleId="tiktok-account-note-title"
            panelClassName="max-w-[460px]"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
              className="w-full"
            >
              <Card variant="modal" className="w-full p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 id="tiktok-account-note-title" className="text-lg font-bold text-white">修改备注</h2>
                    <p className="text-sm text-gray-400 mt-1">
                      {editingNoteAccount.name}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingNoteAccount(null)}
                    className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                  >
                    <X className="w-4 h-4 text-gray-400" />
                  </button>
                </div>

                <Textarea
                  value={noteDraft}
                  onChange={e => setNoteDraft(e.target.value)}
                  placeholder="输入账号备注..."
                  maxLength={80}
                  counter={{ current: noteDraft.length, max: 80 }}
                  className="mt-5 min-h-[96px]"
                />

                <div className="mt-5 flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditingNoteAccount(null)}>
                    取消
                  </Button>
                  <Button size="sm" onClick={saveNote}>
                    保存备注
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
