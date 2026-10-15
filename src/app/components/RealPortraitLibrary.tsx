import {
  AlertTriangle,
  Clock3,
  ImagePlus,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
  UserRoundCheck,
  UsersRound,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type {
  PortraitActivationResult,
  RealPortraitActor,
  RealPortraitActorList,
} from '../data/realPortraits';
import {
  canUsePortraitActor,
  formatPortraitLimit,
  occupiesPortraitActiveSlot,
  portraitLifecycleLabels,
  rankPortraitActorsForRetention,
} from '../data/realPortraits';
import { AppPage, Badge, Button, Card, Dialog, EmptyState, Input, LoadingState, PageHeader } from '../ui';

interface RealPortraitLibraryProps {
  data: RealPortraitActorList | null;
  loading: boolean;
  error: Error | null;
  onRefresh: () => Promise<void>;
  onCreate: (alias: string) => Promise<RealPortraitActor>;
  onActivate: (actorId: string) => Promise<PortraitActivationResult>;
  onRevoke: (actorId: string) => Promise<RealPortraitActor>;
  onDelete: (actorId: string) => Promise<void>;
  onUpload: (actorId: string, kind: 'primary' | 'secondary', file: File, onProgress?: (progress: number) => void) => Promise<unknown>;
  onDeleteAsset: (actorId: string, portraitAssetId: string) => Promise<void>;
  onQuotaSelection: (retainedActorIds: string[], activeActorIds: string[]) => Promise<void>;
  onUpgrade: () => void;
}

export function RealPortraitLibrary({
  data,
  loading,
  error,
  onRefresh,
  onCreate,
  onActivate,
  onRevoke,
  onDelete,
  onUpload,
  onDeleteAsset,
  onQuotaSelection,
  onUpgrade,
}: RealPortraitLibraryProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [activationTarget, setActivationTarget] = useState<RealPortraitActor | null>(null);
  const [invitation, setInvitation] = useState<{
    actorAlias: string;
    url: string;
    expiresAt: string | null;
  } | null>(null);
  const actors = data?.items ?? [];
  const capacity = data?.capacity ?? null;
  const graceStatus = capacity?.quotaState?.graceStatus ?? 'none';
  const graceUntil = ['active', 'reconciling'].includes(graceStatus)
    ? capacity?.quotaState?.graceUntil ?? null
    : null;
  const [clock, setClock] = useState(Date.now());
  const graceSelectionOpen = Boolean(
    graceUntil && new Date(graceUntil).getTime() > clock,
  );
  const profileAtLimit = capacity?.entitlements.profileLimit !== null
    && capacity !== null
    && capacity.usage.profiles >= capacity.entitlements.profileLimit;

  useEffect(() => {
    if (!graceUntil) return undefined;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [graceUntil]);

  if (loading && !data) return <LoadingState variant="panel" label="正在加载真人演员库" />;

  return (
    <AppPage width="wide" className="space-y-6">
      <PageHeader
        eyebrow="数字资产"
        title="真人演员库"
        titleTone="solid"
        subtitle="每位真人都需亲自同意并完成活体校验；档案额度和同时可用人数由当前套餐决定。"
        action={(
          <>
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void onRefresh()}>
              刷新
            </Button>
            <Button
              icon={<Plus className="h-4 w-4" />}
              disabled={!capacity?.entitlements.enabled || profileAtLimit}
              title={profileAtLimit ? '真人演员档案额度已满，请删除不再使用的档案或升级套餐' : undefined}
              onClick={() => setCreateOpen(true)}
            >
              创建真人演员
            </Button>
          </>
        )}
      />

      {error && (
        <Card className="border-red-500/25 bg-red-500/[0.07] p-4 text-sm text-red-200">
          真人演员库暂时无法加载：{error.message}
        </Card>
      )}

      {capacity?.entitlements.enabled && profileAtLimit && (
        <Card className="border-amber-400/20 bg-amber-400/[0.06] p-4 text-sm text-amber-100/80">
          真人演员档案额度已满。删除不再使用的档案，或升级套餐后才能继续创建；套餐锁定的档案也计入用量。
        </Card>
      )}

      {capacity && (
        <>
          <QuotaSummary data={data!} onUpgrade={onUpgrade} />
          {graceUntil && (
            <Card className="border-amber-400/25 bg-amber-400/[0.07] p-5">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                  <div>
                    <p className="font-semibold text-amber-100">
                      {graceSelectionOpen
                        ? graceStatus === 'reconciling' ? '套餐降级选择已保存' : '套餐降级宽限期'
                        : '套餐额度调整清理中'}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-amber-100/70">
                      {graceSelectionOpen
                        ? `剩余 ${formatGraceCountdown(graceUntil, clock)}。请在 ${formatDateTime(graceUntil)} 前选择额度内保留的演员；截止前可以修改，逾期将按最近成功使用顺序处理。`
                        : '保留名单已经截止，系统正在锁定超额演员并释放远端容量；清理确认前资源仍计入用量。'}
                    </p>
                  </div>
                </div>
                {graceSelectionOpen && (
                  <Button variant="secondary" onClick={() => setQuotaOpen(true)}>
                    {graceStatus === 'reconciling' ? '修改保留演员' : '选择保留演员'}
                  </Button>
                )}
              </div>
            </Card>
          )}
        </>
      )}

      {!capacity?.entitlements.enabled ? (
        <Card className="p-8">
          <EmptyState
            icon={<ShieldCheck className="h-12 w-12" />}
            title="当前套餐未开通真人演员库"
            subtitle="升级支持真人演员库的主套餐后即可创建。"
            action={<Button onClick={onUpgrade}>查看套餐</Button>}
          />
        </Card>
      ) : actors.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            icon={<UsersRound className="h-12 w-12" />}
            title="还没有真人演员"
            subtitle="创建档案不会直接占用火山资源；邀请本人认证后才可上传主图。"
            action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>创建第一位演员</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {actors.map(actor => (
            <PortraitActorCard
              key={actor.id}
              actor={actor}
              activeLimitReached={Boolean(
                capacity
                && capacity.usage.active >= capacity.entitlements.activeLimit
                && actor.lifecycleStatus !== 'waiting',
              )}
              onActivate={onActivate}
              onNeedRelease={() => setActivationTarget(actor)}
              onInvitationReady={(url, expiresAt) => setInvitation({
                actorAlias: actor.alias,
                url,
                expiresAt,
              })}
              onRevoke={onRevoke}
              onDelete={onDelete}
              assetsPerActor={capacity?.entitlements.assetsPerActor ?? 0}
              onUpload={onUpload}
              onDeleteAsset={onDeleteAsset}
            />
          ))}
        </div>
      )}

      <CreatePortraitDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={async alias => {
          await onCreate(alias);
          setCreateOpen(false);
        }}
      />
      {capacity && (
        <QuotaSelectionDialog
          open={quotaOpen}
          actors={actors}
          profileLimit={capacity.entitlements.profileLimit}
          activeLimit={capacity.entitlements.activeLimit}
          initialRetained={capacity.quotaState?.retainedActorIds ?? []}
          initialActive={capacity.quotaState?.activeActorIds ?? []}
          onClose={() => setQuotaOpen(false)}
          onSave={async (retained, active) => {
            await onQuotaSelection(retained, active);
            setQuotaOpen(false);
          }}
        />
      )}
      {capacity && activationTarget && (
        <ReplaceActiveActorDialog
          open
          target={activationTarget}
          candidates={actors.filter(actor => actor.id !== activationTarget.id && occupiesPortraitActiveSlot(actor))}
          activeLimit={capacity.entitlements.activeLimit}
          onClose={() => setActivationTarget(null)}
          onRelease={async actorId => {
            await onRevoke(actorId);
            setActivationTarget(null);
          }}
        />
      )}
      {invitation && (
        <PortraitInvitationDialog
          invitation={invitation}
          onClose={() => setInvitation(null)}
        />
      )}
    </AppPage>
  );
}

function QuotaSummary({ data, onUpgrade }: { data: RealPortraitActorList; onUpgrade: () => void }) {
  const { sourcePlanName, entitlements, usage } = data.capacity;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <QuotaCard label="演员档案" value={`${usage.profiles} / ${formatPortraitLimit(entitlements.profileLimit)}`} hint="未删除档案均计入" />
      <QuotaCard
        label="同时激活"
        value={`${usage.active} / ${entitlements.activeLimit}`}
        hint={usage.queued > 0 ? `含等待、认证和处理中；${usage.queued} 个申请排队中` : '含等待、认证和处理中'}
      />
      <Card className="p-5" accent="violet">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">套餐权益</p>
        <p className="mt-3 text-lg font-bold text-white">{sourcePlanName}</p>
        <p className="mt-1 text-xs text-[var(--product-text-secondary)]">每人最多 {entitlements.assetsPerActor} 张图片</p>
        <button type="button" className="mt-3 text-xs font-semibold text-violet-300 hover:text-violet-200" onClick={onUpgrade}>
          查看或升级套餐 →
        </button>
      </Card>
    </div>
  );
}

function QuotaCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs text-[var(--product-text-muted)]">{label}</p>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
      <p className="mt-2 text-xs text-[var(--product-text-secondary)]">{hint}</p>
    </Card>
  );
}

function PortraitActorCard({
  actor,
  activeLimitReached,
  onActivate,
  onNeedRelease,
  onInvitationReady,
  onRevoke,
  onDelete,
  assetsPerActor,
  onUpload,
  onDeleteAsset,
}: {
  actor: RealPortraitActor;
  activeLimitReached: boolean;
  onActivate: (actorId: string) => Promise<PortraitActivationResult>;
  onNeedRelease: () => void;
  onInvitationReady: (url: string, expiresAt: string | null) => void;
  onRevoke: (actorId: string) => Promise<RealPortraitActor>;
  onDelete: (actorId: string) => Promise<void>;
  assetsPerActor: 0 | 1 | 2;
  onUpload: (actorId: string, kind: 'primary' | 'secondary', file: File, onProgress?: (progress: number) => void) => Promise<unknown>;
  onDeleteAsset: (actorId: string, portraitAssetId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<'activate' | 'revoke' | 'delete' | null>(null);
  const [confirmAction, setConfirmAction] = useState<'revoke' | 'delete' | null>(null);
  const [actionError, setActionError] = useState('');
  const usable = canUsePortraitActor(actor);
  const occupiesActiveSlot = occupiesPortraitActiveSlot(actor);
  const canActivate = actor.planAccessStatus !== 'plan_locked'
    && !['active', 'invited', 'verifying', 'awaiting_upload', 'processing', 'deleting'].includes(actor.lifecycleStatus);
  const canUpload = actor.planAccessStatus !== 'plan_locked'
    && ['awaiting_upload', 'processing', 'active'].includes(actor.lifecycleStatus);
  const primaryAsset = actor.assets.find(asset => asset.kind === 'primary');
  const secondaryAsset = actor.assets.find(asset => asset.kind === 'secondary');

  const activate = async () => {
    setBusy('activate');
    try {
      const result = await onActivate(actor.id);
      if (result.invitationUrl) {
        onInvitationReady(result.invitationUrl, result.invitationExpiresAt);
        toast.success('本人认证邀请已创建，请发送给真人本人');
      } else if (result.queuePosition) {
        toast.info(`共享资源暂满，已进入队列（本账号队内第 ${result.queuePosition} 个申请）`);
      } else {
        toast.success('激活申请已提交');
      }
    } finally {
      setBusy(null);
    }
  };

  const runConfirmedAction = async () => {
    if (!confirmAction) return;
    const releaseBeforeDelete = confirmAction === 'delete' && occupiesActiveSlot;
    const action = releaseBeforeDelete ? 'revoke' : confirmAction;
    setBusy(action);
    setActionError('');
    try {
      if (action === 'revoke') {
        await onRevoke(actor.id);
        toast.success(releaseBeforeDelete
          ? '已停止使用；远端清理完成后即可删除档案'
          : '已停止新生成，远端容量进入异步清理');
      } else {
        await onDelete(actor.id);
        toast.success('真人演员档案已删除，远端素材进入异步清理');
      }
      setConfirmAction(null);
    } catch (actionFailure) {
      const message = messageOf(actionFailure, action === 'revoke' ? '释放容量失败，请稍后重试' : '删除档案失败，请稍后重试');
      setActionError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Card variant="interactive" className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${usable ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.06] text-gray-400'}`}>
            {usable ? <UserRoundCheck className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-white">{actor.alias}</h2>
            <p className="mt-1 text-xs text-gray-500">建立于 {formatDate(actor.createdAt)}</p>
          </div>
        </div>
        <Badge variant={statusVariant(actor)} dot>{actor.planAccessStatus === 'plan_locked' ? '套餐已锁定' : portraitLifecycleLabels[actor.lifecycleStatus]}</Badge>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
        <div className="rounded-xl bg-white/[0.035] p-3">
          <dt className="text-gray-500">本人授权</dt>
          <dd className="mt-1 font-medium text-gray-200">{portraitAuthorizationStatusLabel(actor.authorizationStatus)}</dd>
        </div>
        <div className="rounded-xl bg-white/[0.035] p-3">
          <dt className="text-gray-500">授权到期</dt>
          <dd className="mt-1 font-medium text-gray-200">{formatDate(actor.authorizationExpiresAt)}</dd>
        </div>
        <div className="rounded-xl bg-white/[0.035] p-3">
          <dt className="text-gray-500">最近成功使用</dt>
          <dd className="mt-1 font-medium text-gray-200">{formatDate(actor.lastSuccessfulGenerationAt)}</dd>
        </div>
      </dl>

      {actor.lifecycleStatus === 'eviction_warning' && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-400/[0.08] p-3 text-xs leading-5 text-amber-200">
          <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          已连续 30 天未成功生成，容量需要时会释放；再次使用需本人重新认证。
        </p>
      )}

      {actor.assets.length > 0 && (
        <div className="mt-4 space-y-2">
          {actor.assets.map(asset => (
            <div key={asset.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-xs">
              <span className="text-gray-300">{asset.kind === 'primary' ? '必选主图' : '弹性第二张图'} · {portraitAssetStatusLabel(asset.status, asset.consistencyStatus)}</span>
              <button
                type="button"
                className="text-gray-500 hover:text-red-300"
                aria-label={`删除${asset.kind === 'primary' ? '主图' : '第二张图'}`}
                onClick={() => void onDeleteAsset(actor.id, asset.id).then(() => toast.success('真人素材已进入清理'))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {canActivate && (
          <Button
            size="sm"
            variant={activeLimitReached ? 'secondary' : 'primary'}
            loading={busy === 'activate'}
            onClick={() => activeLimitReached ? onNeedRelease() : void activate()}
          >
            {activeLimitReached
              ? '选择释放名额'
              : actor.lifecycleStatus === 'waiting'
              ? '检查资源并继续'
              : actor.lifecycleStatus === 'evicted'
                ? '重新邀请认证'
                : '邀请本人认证'}
          </Button>
        )}
        {canUpload && !primaryAsset && (
          <PortraitUploadButton actorId={actor.id} kind="primary" label="上传必选主图" onUpload={onUpload} />
        )}
        {canUpload && assetsPerActor >= 2 && primaryAsset?.status === 'active' && !secondaryAsset && (
          <PortraitUploadButton actorId={actor.id} kind="secondary" label="上传第二张图" onUpload={onUpload} />
        )}
        {occupiesActiveSlot && (
          <Button
            size="sm"
            variant="secondary"
            loading={busy === 'revoke'}
            onClick={() => {
              setActionError('');
              setConfirmAction('revoke');
            }}
          >
            释放容量
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          loading={busy === 'delete'}
          icon={<Trash2 className="h-3.5 w-3.5" />}
          onClick={() => {
            setActionError('');
            setConfirmAction('delete');
          }}
        >
          删除档案
        </Button>
      </div>
      </Card>
      {confirmAction && (
        <Dialog
          role="alertdialog"
          titleId={`portrait-${confirmAction}-title-${actor.id}`}
          descriptionId={`portrait-${confirmAction}-description-${actor.id}`}
          closeDisabled={busy !== null}
          onClose={() => setConfirmAction(null)}
          panelClassName="max-w-md"
          zIndexClass="z-[70]"
        >
          <Card variant="modal" className="p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-300">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div>
                <h2 id={`portrait-${confirmAction}-title-${actor.id}`} className="text-lg font-bold text-white">
                  {confirmAction === 'revoke'
                    ? '停止使用并释放容量'
                    : occupiesActiveSlot ? '先停止使用再删除' : '删除真人演员档案'}
                </h2>
                <p id={`portrait-${confirmAction}-description-${actor.id}`} className="mt-2 text-sm leading-6 text-gray-400">
                  {confirmAction === 'revoke'
                    ? `确定停止使用“${actor.alias}”并释放远端容量吗？再次使用必须由真人本人重新同意并完成认证。`
                    : occupiesActiveSlot
                      ? `“${actor.alias}”仍在占用同时激活名额。请先停止使用并释放远端容量，清理完成后再删除档案。`
                      : `确定删除“${actor.alias}”吗？档案会立即移除，仍存在的远端真人素材将进入异步清理。`}
                </p>
              </div>
            </div>
            {actionError && (
              <p className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
                {actionError}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <Button
                data-dialog-initial-focus
                variant="secondary"
                disabled={busy !== null}
                onClick={() => setConfirmAction(null)}
              >
                取消
              </Button>
              <Button
                variant="danger"
                loading={busy !== null}
                disabled={busy !== null}
                onClick={() => void runConfirmedAction()}
              >
                {confirmAction === 'delete' && !occupiesActiveSlot ? '确认删除' : '确认释放'}
              </Button>
            </div>
          </Card>
        </Dialog>
      )}
    </>
  );
}

function PortraitInvitationDialog({
  invitation,
  onClose,
}: {
  invitation: { actorAlias: string; url: string; expiresAt: string | null };
  onClose: () => void;
}) {
  const copyInvitation = async () => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard-unavailable');
      await navigator.clipboard.writeText(invitation.url);
      toast.success('邀请链接已复制');
    } catch {
      toast.error('浏览器未允许复制，请手动选中并复制下方链接');
    }
  };

  return (
    <Dialog open onClose={onClose} titleId="portrait-invitation-title" panelClassName="max-w-xl">
      <Card variant="modal" className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="portrait-invitation-title" className="text-xl font-bold text-white">发送给真人本人</h2>
            <p className="mt-2 text-sm leading-6 text-gray-400">
              “{invitation.actorAlias}”的本人授权邀请已创建。链接只用于本人逐项同意和官方 H5 活体认证。
            </p>
          </div>
          <button type="button" aria-label="关闭" className="rounded-lg p-1.5 text-gray-500 hover:bg-white/5 hover:text-white" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="mt-5 block text-xs font-medium text-gray-300" htmlFor="portrait-invitation-url">一次性邀请链接</label>
        <input
          id="portrait-invitation-url"
          readOnly
          value={invitation.url}
          onFocus={event => event.currentTarget.select()}
          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-xs text-gray-200 outline-none focus:border-violet-400/60"
        />
        <p className="mt-2 text-xs text-amber-200/75">
          有效至 {formatDateTime(invitation.expiresAt)}。请只发送给对应真人；过期后需重新发起。
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => void copyInvitation()}>复制链接</Button>
          <a
            href={invitation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
          >
            打开本人页面
          </a>
          <Button variant="ghost" onClick={onClose}>完成</Button>
        </div>
      </Card>
    </Dialog>
  );
}

function ReplaceActiveActorDialog({
  open,
  target,
  candidates,
  activeLimit,
  onClose,
  onRelease,
}: {
  open: boolean;
  target: RealPortraitActor;
  candidates: RealPortraitActor[];
  activeLimit: number;
  onClose: () => void;
  onRelease: (actorId: string) => Promise<void>;
}) {
  const [selectedActorId, setSelectedActorId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelectedActorId('');
    setError('');
  }, [open, target.id]);

  return (
    <Dialog open={open} onClose={onClose} closeDisabled={saving} titleId="replace-active-portrait-title" panelClassName="max-w-xl">
      <Card variant="modal" className="p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div>
            <h2 id="replace-active-portrait-title" className="text-xl font-bold text-white">同时激活名额已满</h2>
            <p className="mt-2 text-sm leading-6 text-gray-400">
              当前套餐最多同时激活 {activeLimit} 人。要继续认证“{target.alias}”，请先选择一位现有演员释放容量。
            </p>
          </div>
        </div>

        {candidates.length === 0 ? (
          <p className="mt-5 rounded-xl border border-white/[0.08] bg-white/[0.035] p-4 text-sm leading-6 text-gray-300">
            当前没有可主动释放的演员，可能已有资源正在清理。请稍后刷新；系统不会突破套餐或火山容量上限。
          </p>
        ) : (
          <div className="mt-5 space-y-2">
            {candidates.map(actor => (
              <label
                key={actor.id}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 transition-colors ${selectedActorId === actor.id ? 'border-violet-400/50 bg-violet-500/10' : 'border-white/[0.08] bg-white/[0.035] hover:border-white/[0.14]'}`}
              >
                <span>
                  <span className="block font-medium text-white">{actor.alias}</span>
                  <span className="mt-1 block text-xs text-gray-500">
                    {portraitLifecycleLabels[actor.lifecycleStatus]} · 最近成功使用 {formatDate(actor.lastSuccessfulGenerationAt)}
                  </span>
                </span>
                <input
                  type="radio"
                  name="released-real-portrait-actor"
                  value={actor.id}
                  checked={selectedActorId === actor.id}
                  onChange={() => setSelectedActorId(actor.id)}
                />
              </label>
            ))}
          </div>
        )}

        <p className="mt-4 text-xs leading-5 text-amber-200/75">
          释放会立即停止该演员的新生成，并异步删除其远端素材。供应商确认删除前仍占用容量；再次使用该演员必须由真人本人重新同意并完成官方 H5 认证。
        </p>
        {error && (
          <p className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button
            loading={saving}
            disabled={!selectedActorId}
            onClick={() => {
              const actor = candidates.find(item => item.id === selectedActorId);
              if (!actor) return;
              setSaving(true);
              setError('');
              void onRelease(actor.id)
                .then(() => toast.success('释放请求已提交，请等待远端清理后再认证新人'))
                .catch(releaseFailure => {
                  const message = messageOf(releaseFailure, '释放容量失败，请稍后重试');
                  setError(message);
                  toast.error(message);
                })
                .finally(() => setSaving(false));
            }}
          >
            确认释放
          </Button>
        </div>
      </Card>
    </Dialog>
  );
}

function CreatePortraitDialog({ open, onClose, onCreate }: {
  open: boolean;
  onClose: () => void;
  onCreate: (alias: string) => Promise<void>;
}) {
  const [alias, setAlias] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog open={open} onClose={onClose} closeDisabled={saving} titleId="create-portrait-title" panelClassName="max-w-lg">
      <Card variant="modal" className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="create-portrait-title" className="text-xl font-bold text-white">创建真人演员</h2>
            <p className="mt-2 text-sm leading-6 text-gray-400">使用便于你识别的角色别名，不要填写身份证号或其他敏感信息。</p>
          </div>
          <button type="button" aria-label="关闭" className="rounded-lg p-1.5 text-gray-500 hover:bg-white/5 hover:text-white" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5">
          <Input
            autoFocus
            label="角色别名"
            value={alias}
            maxLength={120}
            placeholder="例如：品牌主理人 A"
            error={error}
            onChange={event => {
              setAlias(event.target.value);
              setError('');
            }}
          />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button
            loading={saving}
            onClick={() => {
              const value = alias.trim();
              if (!value) {
                setError('请输入角色别名');
                return;
              }
              setSaving(true);
              void onCreate(value)
                .then(() => {
                  setAlias('');
                  toast.success('真人演员档案已创建');
                })
                .finally(() => setSaving(false));
            }}
          >
            创建档案
          </Button>
        </div>
      </Card>
    </Dialog>
  );
}

function QuotaSelectionDialog({
  open,
  actors,
  profileLimit,
  activeLimit,
  initialRetained,
  initialActive,
  onClose,
  onSave,
}: {
  open: boolean;
  actors: RealPortraitActor[];
  profileLimit: number | null;
  activeLimit: number;
  initialRetained: string[];
  initialActive: string[];
  onClose: () => void;
  onSave: (retained: string[], active: string[]) => Promise<void>;
}) {
  const rankedActors = useMemo(() => rankPortraitActorsForRetention(actors), [actors]);
  const defaultRetained = useMemo(
    () => initialRetained.length
      ? initialRetained
      : rankedActors.slice(0, profileLimit ?? actors.length).map(actor => actor.id),
    [actors.length, initialRetained, profileLimit, rankedActors],
  );
  const defaultActive = useMemo(
    () => initialActive.length
      ? initialActive
      : rankedActors.filter(occupiesPortraitActiveSlot).slice(0, activeLimit).map(actor => actor.id),
    [activeLimit, initialActive, rankedActors],
  );
  const [retained, setRetained] = useState<string[]>(defaultRetained);
  const [active, setActive] = useState<string[]>(defaultActive.filter(id => defaultRetained.includes(id)));
  const [saving, setSaving] = useState(false);
  const maxProfiles = profileLimit ?? actors.length;

  useEffect(() => {
    if (!open) return;
    setRetained(defaultRetained);
    setActive(defaultActive.filter(id => defaultRetained.includes(id)));
  }, [defaultActive, defaultRetained, open]);

  return (
    <Dialog open={open} onClose={onClose} closeDisabled={saving} titleId="quota-selection-title" panelClassName="max-w-2xl">
      <Card variant="modal" className="max-h-[85vh] overflow-auto p-6">
        <h2 id="quota-selection-title" className="text-xl font-bold text-white">选择降级后保留的演员</h2>
        <p className="mt-2 text-sm leading-6 text-gray-400">最多保留 {formatPortraitLimit(profileLimit)} 个可用档案，其中最多 {activeLimit} 个继续驻留火山。未选择的档案不会自动删除，但会被锁定并释放远端资源。</p>
        <div className="mt-5 space-y-2">
          {actors.map(actor => {
            const keep = retained.includes(actor.id);
            const stayActive = active.includes(actor.id);
            const canStayActive = occupiesPortraitActiveSlot(actor);
            return (
              <div key={actor.id} className="flex flex-col justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.035] p-3 sm:flex-row sm:items-center">
                <div>
                  <p className="font-medium text-white">{actor.alias}</p>
                  <p className="mt-1 text-xs text-gray-500">{portraitLifecycleLabels[actor.lifecycleStatus]} · 最近使用 {formatDate(actor.lastSuccessfulGenerationAt)}</p>
                </div>
                <div className="flex gap-3 text-xs">
                  <label className="flex items-center gap-2 text-gray-300">
                    <input
                      type="checkbox"
                      checked={keep}
                      onChange={event => {
                        if (event.target.checked && retained.length >= maxProfiles) return;
                        setRetained(values => event.target.checked ? [...values, actor.id] : values.filter(id => id !== actor.id));
                        if (!event.target.checked) setActive(values => values.filter(id => id !== actor.id));
                      }}
                    />
                    保留档案
                  </label>
                  <label className="flex items-center gap-2 text-gray-300">
                    <input
                      type="checkbox"
                      disabled={!keep || !canStayActive}
                      checked={stayActive}
                      onChange={event => {
                        if (event.target.checked && active.length >= activeLimit) return;
                        setActive(values => event.target.checked ? [...values, actor.id] : values.filter(id => id !== actor.id));
                      }}
                    />
                    {canStayActive ? '保持激活' : '当前未驻留'}
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">已选 {retained.length}/{formatPortraitLimit(profileLimit)}，激活 {active.length}/{activeLimit}</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>稍后处理</Button>
            <Button loading={saving} onClick={() => {
              setSaving(true);
              void onSave(retained, active).finally(() => setSaving(false));
            }}>保存选择</Button>
          </div>
        </div>
      </Card>
    </Dialog>
  );
}

function PortraitUploadButton({ actorId, kind, label, onUpload }: {
  actorId: string;
  kind: 'primary' | 'secondary';
  label: string;
  onUpload: (actorId: string, kind: 'primary' | 'secondary', file: File, onProgress?: (progress: number) => void) => Promise<unknown>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.gif,.heic,.heif,image/*"
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          setProgress(0);
          void onUpload(actorId, kind, file, setProgress)
            .then(() => toast.success(kind === 'primary' ? '主图已提交校验' : '第二张图已提交校验'))
            .catch(error => toast.error(error instanceof Error ? error.message : '真人素材上传失败'))
            .finally(() => setProgress(null));
        }}
      />
      <Button
        size="sm"
        variant="secondary"
        icon={<ImagePlus className="h-3.5 w-3.5" />}
        loading={progress !== null}
        onClick={() => inputRef.current?.click()}
      >
        {progress === null ? label : `上传 ${progress}%`}
      </Button>
    </>
  );
}

function portraitAssetStatusLabel(status: RealPortraitActor['assets'][number]['status'], consistency: RealPortraitActor['assets'][number]['consistencyStatus']) {
  if (status === 'active' && consistency === 'passed') return '可用';
  if (consistency === 'failed' || status === 'failed') return '一致性校验失败';
  if (status === 'deleting') return '清理中';
  if (status === 'deleted') return '已删除';
  return '处理中';
}

function portraitAuthorizationStatusLabel(status: RealPortraitActor['authorizationStatus']) {
  return ({
    none: '未建立',
    draft: '待本人同意',
    pending: '待本人认证',
    verified: '认证已通过',
    active: '授权有效',
    rejected: '本人已拒绝',
    revoked: '本人已撤回',
    expired: '授权已到期',
  } as const)[status];
}

function statusVariant(actor: RealPortraitActor): 'default' | 'success' | 'warning' | 'error' | 'blue' {
  if (actor.planAccessStatus === 'plan_locked' || ['revoked', 'expired', 'sync_error'].includes(actor.lifecycleStatus)) return 'error';
  if (actor.lifecycleStatus === 'active') return 'success';
  if (['waiting', 'eviction_warning', 'awaiting_upload'].includes(actor.lifecycleStatus)) return 'warning';
  if (['invited', 'verifying', 'processing'].includes(actor.lifecycleStatus)) return 'blue';
  return 'default';
}

function formatDate(value: string | null) {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '暂无';
  return date.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function formatDateTime(value: string | null) {
  if (!value) return '待系统确认';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '待系统确认';
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

function formatGraceCountdown(value: string | null, now: number) {
  if (!value) return '待系统确认';
  const remainingMs = new Date(value).getTime() - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return '不足 1 分钟';
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
