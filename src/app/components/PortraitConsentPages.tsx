import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, ShieldCheck, UserRoundCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type {
  PublicPortraitAuthorization,
  PublicPortraitConsentResult,
  PublicPortraitInvite,
  PublicPortraitVerificationStart,
} from '../data/realPortraits';
import { Badge, Button, Card, Dialog, LoadingState } from '../ui';

interface PortraitInviteConsentPageProps {
  token: string;
  onLoad: (token: string) => Promise<PublicPortraitInvite>;
  onRespond: (token: string, accepted: boolean) => Promise<PublicPortraitConsentResult>;
  onStartVerification: (token: string) => Promise<PublicPortraitVerificationStart>;
  onReadStatus: (token: string) => Promise<{ status: string; authorizationExpiresAt: string | null }>;
}

export function PortraitInviteConsentPage({
  token,
  onLoad,
  onRespond,
  onStartVerification,
  onReadStatus,
}: PortraitInviteConsentPageProps) {
  const [invite, setInvite] = useState<PublicPortraitInvite | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState(false);
  const [starting, setStarting] = useState(false);
  const [verificationStarted, setVerificationStarted] = useState(false);
  const [verified, setVerified] = useState(false);
  const manageStorageKey = `lindyson:portrait-manage-url:${token.slice(-12)}`;
  const [manageUrl, setManageUrl] = useState<string | null>(() => window.sessionStorage.getItem(manageStorageKey));
  const [checks, setChecks] = useState({ adult: false, portrait: false, sensitive: false, commercial: false });
  const allChecked = Object.values(checks).every(Boolean);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setInvite(await onLoad(token));
    } catch (loadError) {
      setError(messageOf(loadError, '授权邀请不存在、已失效或暂时无法读取'));
    } finally {
      setLoading(false);
    }
  }, [onLoad, token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!verificationStarted || verified) return;
    let stopped = false;
    const poll = window.setInterval(() => {
      void onReadStatus(token).then(result => {
        if (stopped) return;
        if (['verified', 'active', 'awaiting_upload'].includes(result.status)) {
          setVerified(true);
          window.clearInterval(poll);
        }
      }).catch(() => undefined);
    }, 3_000);
    return () => {
      stopped = true;
      window.clearInterval(poll);
    };
  }, [onReadStatus, token, verificationStarted, verified]);

  if (loading) return <LoadingState variant="fullscreen" label="正在读取真人肖像授权邀请" />;
  if (!invite || error) return <PortraitPublicError title="无法打开授权邀请" message={error} onRetry={() => void load()} />;

  const canRespond = invite.status === 'pending';
  const canVerify = invite.status === 'accepted' || invite.canStartVerification;

  return (
    <PortraitPublicShell>
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-200">
            <UserRoundCheck className="h-7 w-7" />
          </span>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">本人操作</p>
          <h1 className="mt-2 text-3xl font-bold text-white">真人肖像与人脸信息授权</h1>
          <p className="mt-3 text-sm leading-6 text-gray-400">Lindyson 不采集身份证、活体帧或人脸模板；活体校验由火山方舟官方 H5 完成。</p>
        </div>

        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">本次授权范围</h2>
            <Badge variant={invite.status === 'pending' ? 'warning' : invite.status === 'accepted' ? 'success' : 'default'}>
              {inviteStatusLabel(invite.status)}
            </Badge>
          </div>
          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            <Info label="个人信息处理者" value={invite.controllerName} />
            <Info label="受托处理方" value={invite.processorName} />
            <Info label="商业用途" value={invite.commercialUse ? '商品宣传、品牌营销、广告投放与商业展示' : '不包含商业用途'} />
            <Info label="用途" value={invite.purpose} />
            <Info
              label={invite.status === 'pending' ? '授权期限' : '授权截止'}
              value={invite.status === 'pending' ? '本人同意之日起 90 天' : formatDateTime(invite.validUntil)}
            />
            <Info label="隐私联系人" value={invite.privacyContact} />
          </dl>
          {invite.commercialUse && <CommercialUseDisclosure />}
          <div className="mt-5 space-y-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4 text-sm leading-6 text-gray-400">
            <p><span className="font-medium text-gray-200">处理范围：</span>{invite.processingScope}</p>
            <p><span className="font-medium text-gray-200">保留与删除：</span>{invite.retentionRule}</p>
            <a
              className="inline-flex items-center gap-1 font-medium text-violet-300 hover:text-violet-200"
              href={invite.privacyPolicyUrl}
              target="_blank"
              rel="noreferrer"
            >
              查看隐私政策 <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </Card>

        {canRespond && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-white">请逐项确认</h2>
            <p className="mt-2 text-sm leading-6 text-gray-400">你可以拒绝；拒绝不会启动活体认证或建立远端真人素材。</p>
            <div className="mt-5 space-y-3">
              <ConsentCheck checked={checks.adult} onChange={adult => setChecks(value => ({ ...value, adult }))}>我已年满 18 周岁，并且正在为本人操作。</ConsentCheck>
              <ConsentCheck checked={checks.portrait} onChange={portrait => setChecks(value => ({ ...value, portrait }))}>我同意在上述用途和期限内处理并使用本人的肖像。</ConsentCheck>
              <ConsentCheck checked={checks.sensitive} onChange={sensitive => setChecks(value => ({ ...value, sensitive }))}>我单独同意为活体校验和真人一致性校验处理敏感人脸信息。</ConsentCheck>
              <ConsentCheck checked={checks.commercial} onChange={commercial => setChecks(value => ({ ...value, commercial }))}>我已阅读上述商业传播渠道、必要编辑范围和明确禁止用途，并同意本次商业用途授权。</ConsentCheck>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                loading={responding}
                onClick={() => {
                  setResponding(true);
                  void onRespond(token, false)
                    .then(() => load())
                    .finally(() => setResponding(false));
                }}
              >
                拒绝授权
              </Button>
              <Button
                disabled={!allChecked}
                loading={responding}
                onClick={() => {
                  setResponding(true);
                  void onRespond(token, true)
                    .then(result => {
                      toast.success('授权已记录，请继续完成官方活体校验');
                      if (result.manageUrl) {
                        setManageUrl(result.manageUrl);
                        window.sessionStorage.setItem(manageStorageKey, result.manageUrl);
                      }
                      return load();
                    })
                    .finally(() => setResponding(false));
                }}
              >
                同意并继续
              </Button>
            </div>
          </Card>
        )}

        {manageUrl && (
          <Card className="border-amber-400/25 bg-amber-400/[0.07] p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
              <div>
                <h2 className="font-semibold text-amber-100">请立即保存你的授权管理链接</h2>
                <p className="mt-2 text-sm leading-6 text-amber-100/75">
                  这是本人以后查看或撤回授权的唯一入口。请勿转发给创建者或其他人；关闭本次浏览会话后，系统不会再次展示该链接。
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  const copy = navigator.clipboard?.writeText(manageUrl);
                  if (!copy) {
                    toast.error('当前浏览器不支持复制，请打开管理页后收藏');
                    return;
                  }
                  void copy
                    .then(() => toast.success('授权管理链接已复制'))
                    .catch(() => toast.error('复制失败，请打开管理页后收藏'));
                }}
              >
                复制撤回链接
              </Button>
              <Button
                icon={<ExternalLink className="h-4 w-4" />}
                onClick={() => window.open(manageUrl, '_blank', 'noopener,noreferrer')}
              >
                打开授权管理页
              </Button>
            </div>
          </Card>
        )}

        {canVerify && !verified && (
          <Card className="border-violet-400/20 p-6">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" />
              <div>
                <h2 className="font-semibold text-white">前往火山方舟官方 H5</h2>
                <p className="mt-2 text-sm leading-6 text-gray-400">认证链接有效期很短，将在新窗口打开。完成后回到本页，系统会只查询认证结果与 Group 状态。</p>
              </div>
            </div>
            <Button
              className="mt-5"
              icon={starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
              loading={starting}
              onClick={() => {
                setStarting(true);
                const verificationWindow = window.open('about:blank', '_blank');
                if (verificationWindow) verificationWindow.opener = null;
                void onStartVerification(token)
                  .then(result => {
                    setVerificationStarted(true);
                    if (result.verificationUrl) {
                      if (verificationWindow) verificationWindow.location.replace(result.verificationUrl);
                      else window.location.assign(result.verificationUrl);
                    } else if (result.queuePosition) {
                      verificationWindow?.close();
                      toast.info(`共享资源暂满，已排队（本账号队内第 ${result.queuePosition} 个申请）`);
                    }
                  })
                  .catch(error => {
                    verificationWindow?.close();
                    toast.error(messageOf(error, '暂时无法启动官方活体认证，请稍后重试'));
                  })
                  .finally(() => setStarting(false));
              }}
            >
              开始本人认证
            </Button>
          </Card>
        )}

        {verified && (
          <Card className="border-emerald-400/20 bg-emerald-400/[0.05] p-6 text-center">
            <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-300" />
            <h2 className="mt-3 text-lg font-semibold text-white">本人认证已完成</h2>
            <p className="mt-2 text-sm text-gray-400">创建者现在可以上传用于一致性校验的主图。确认已经保存授权管理链接后，你可以关闭此页面。</p>
          </Card>
        )}
      </div>
    </PortraitPublicShell>
  );
}

interface PortraitAuthorizationPageProps {
  manageToken: string;
  onLoad: (manageToken: string) => Promise<PublicPortraitAuthorization>;
  onRevoke: (manageToken: string) => Promise<PublicPortraitAuthorization>;
}

export function PortraitVerificationCompletePage() {
  const callbackStatus = new URLSearchParams(
    window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash,
  ).get('status');
  const verified = callbackStatus === 'verified';

  return (
    <PortraitPublicShell>
      <Card className="mx-auto max-w-md p-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
          <CheckCircle2 className="h-7 w-7" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">官方 H5 已返回</p>
        <h1 className="mt-2 text-2xl font-bold text-white">
          {verified ? '本人认证已完成' : '真人认证结果已提交'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-gray-400">
          {verified
            ? '系统已通过火山方舟官方接口确认认证结果。请关闭本页并回到原授权页面。'
            : '系统正在通过火山方舟官方接口确认最终结果。请关闭本页并回到原授权页面稍候。'}
        </p>
        <Button className="mt-6" onClick={() => window.close()}>关闭本页</Button>
        <p className="mt-4 text-xs leading-5 text-gray-500">如果浏览器没有自动关闭，请手动关闭此标签页。</p>
      </Card>
    </PortraitPublicShell>
  );
}

export function PortraitAuthorizationPage({ manageToken, onLoad, onRevoke }: PortraitAuthorizationPageProps) {
  const [authorization, setAuthorization] = useState<PublicPortraitAuthorization | null>(null);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);
  const [revokeError, setRevokeError] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setAuthorization(await onLoad(manageToken));
    } catch (loadError) {
      setError(messageOf(loadError, '授权管理链接不存在、已失效或暂时无法读取'));
    } finally {
      setLoading(false);
    }
  }, [manageToken, onLoad]);

  useEffect(() => {
    void load();
  }, [load]);

  const isRevoked = authorization?.status === 'revoked';
  const canRevoke = authorization && !['revoked', 'expired', 'rejected'].includes(authorization.status);
  const cleanupLabel = useMemo(() => cleanupStatusLabel(authorization?.cleanupStatus), [authorization?.cleanupStatus]);

  const handleRevoke = async () => {
    setRevoking(true);
    setRevokeError('');
    try {
      const result = await onRevoke(manageToken);
      setAuthorization(result);
      setRevokeConfirmOpen(false);
      toast.success('授权已撤回，远端清理已进入队列');
    } catch (revokeFailure) {
      const message = messageOf(revokeFailure, '撤回授权失败，请稍后重试');
      setRevokeError(message);
      toast.error(message);
    } finally {
      setRevoking(false);
    }
  };

  if (loading) return <LoadingState variant="fullscreen" label="正在读取真人肖像授权" />;
  if (!authorization || error) return <PortraitPublicError title="无法打开授权管理页" message={error} onRetry={() => void load()} />;

  return (
    <PortraitPublicShell>
      <Card className="mx-auto max-w-2xl p-7">
        <div className="flex items-start gap-4">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${isRevoked ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
            {isRevoked ? <AlertTriangle className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">本人授权管理</p>
            <h1 className="mt-2 text-2xl font-bold text-white">真人肖像使用授权</h1>
            <p className="mt-2 text-sm leading-6 text-gray-400">撤回后会立即阻止新的生成；系统内相关历史视频不再展示、下载或复用，不能继续使用套餐保留期。</p>
          </div>
        </div>
        <dl className="mt-7 grid gap-4 rounded-2xl bg-white/[0.035] p-5 text-sm sm:grid-cols-2">
          <Info label="状态" value={authorizationStatusLabel(authorization.status)} />
          <Info label="个人信息处理者" value={authorization.controllerName} />
          <Info label="受托处理方" value={authorization.processorName} />
          <Info label="授权用途" value={authorization.purpose} />
          <Info label="授权截止" value={formatDateTime(authorization.validUntil)} />
          <Info label="商业用途" value={authorization.commercialUse ? '已授权' : '未授权'} />
          <Info label="远端清理" value={cleanupLabel} />
          <Info label="隐私联系人" value={authorization.privacyContact} />
        </dl>
        {authorization.commercialUse && <CommercialUseDisclosure />}
        <div className="mt-5 space-y-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 text-sm leading-6 text-gray-400">
          <p><span className="font-medium text-gray-200">处理范围：</span>{authorization.processingScope}</p>
          <p><span className="font-medium text-gray-200">保留与删除：</span>{authorization.retentionRule}</p>
          <a
            className="inline-flex items-center gap-1 font-medium text-violet-300 hover:text-violet-200"
            href={authorization.privacyPolicyUrl}
            target="_blank"
            rel="noreferrer"
          >
            查看隐私政策 <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        {canRevoke && (
          <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/[0.05] p-5">
            <h2 className="font-semibold text-red-100">撤回后续使用授权</h2>
            <div className="mt-2 space-y-2 text-sm leading-6 text-red-100/70">
              <p>撤回后，系统内相关历史视频不再展示、下载或复用；已提交给供应商的任务按终态处理，但不会继续向创建者交付。</p>
              <p>撤回前已经合法发布到第三方渠道的内容不会自动召回；撤回生效后不得新增投放、转载、编辑或再次发布，平台将对合理的投诉和下架请求提供协助。</p>
              <p>撤回不可由管理员绕过。若以后重新使用，需要你重新同意并再次完成官方活体认证。</p>
            </div>
            <Button
              className="mt-4"
              variant="danger"
              loading={revoking}
              onClick={() => {
                setRevokeError('');
                setRevokeConfirmOpen(true);
              }}
            >
              撤回授权
            </Button>
          </div>
          )}
      </Card>
      {revokeConfirmOpen && (
        <Dialog
          role="alertdialog"
          titleId="portrait-authorization-revoke-title"
          descriptionId="portrait-authorization-revoke-description"
          closeDisabled={revoking}
          onClose={() => setRevokeConfirmOpen(false)}
          panelClassName="max-w-md"
        >
          <Card variant="modal" className="p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-300">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div>
                <h2 id="portrait-authorization-revoke-title" className="text-lg font-bold text-white">确认撤回真人肖像授权</h2>
                <p id="portrait-authorization-revoke-description" className="mt-2 text-sm leading-6 text-gray-400">
                  撤回后将立即停止新的真人生成，系统内相关历史视频也会停止展示、下载和复用。以后重新使用必须再次同意并完成官方活体认证。
                </p>
              </div>
            </div>
            {revokeError && (
              <p className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
                {revokeError}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <Button
                data-dialog-initial-focus
                variant="secondary"
                disabled={revoking}
                onClick={() => setRevokeConfirmOpen(false)}
              >
                取消
              </Button>
              <Button variant="danger" loading={revoking} disabled={revoking} onClick={() => void handleRevoke()}>
                确认撤回
              </Button>
            </div>
          </Card>
        </Dialog>
      )}
    </PortraitPublicShell>
  );
}

function CommercialUseDisclosure() {
  return (
    <div className="mt-5 space-y-3 rounded-xl border border-violet-400/15 bg-violet-400/[0.045] p-4 text-sm leading-6 text-gray-400">
      <h3 className="font-semibold text-violet-100">商业传播范围与限制</h3>
      <p>
        <span className="font-medium text-gray-200">允许渠道：</span>
        合法的商品宣传、品牌营销、广告投放和商业展示，可发布至品牌官网、电商平台、TikTok、抖音、小红书、微信视频号等短视频或社交媒体、数字广告平台及线下展示渠道。
      </p>
      <p>
        <span className="font-medium text-gray-200">必要编辑：</span>
        可为适配上述渠道进行必要的剪辑、裁切、字幕、配音、画幅和版式调整。
      </p>
      <p>
        <span className="font-medium text-gray-200">明确禁止：</span>
        不得出售、转授权真人肖像，不得用于模型训练、身份冒用、虚假代言或其他违法违规用途。
      </p>
    </div>
  );
}

function PortraitPublicShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#08080c] px-4 py-10 text-white sm:px-6">
      <div className="mx-auto mb-8 flex max-w-3xl items-center justify-center gap-3 text-sm font-semibold text-gray-200">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-500/15 text-violet-200">L</span>
        Lindyson AI
      </div>
      {children}
      <p className="mx-auto mt-8 max-w-3xl text-center text-xs leading-5 text-gray-600">请勿转发本页面链接。链接只用于真人本人处理本次授权。</p>
    </main>
  );
}

function PortraitPublicError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <PortraitPublicShell>
      <Card className="mx-auto max-w-md p-8 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-300" />
        <h1 className="mt-4 text-xl font-bold text-white">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-gray-400">{message}</p>
        <Button className="mt-6" variant="secondary" onClick={onRetry}>重新加载</Button>
      </Card>
    </PortraitPublicShell>
  );
}

function ConsentCheck({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-4 text-sm leading-6 text-gray-300">
      <input className="mt-1" type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-1 break-words font-medium text-gray-200">{value}</dd>
    </div>
  );
}

function inviteStatusLabel(status: PublicPortraitInvite['status']) {
  return ({ pending: '待决定', accepted: '已同意', consumed: '已完成', expired: '已过期', cancelled: '已取消' } as const)[status];
}

function authorizationStatusLabel(status: PublicPortraitAuthorization['status']) {
  return ({
    none: '未建立',
    draft: '待本人同意',
    pending: '待认证',
    verified: '已认证',
    active: '授权有效',
    rejected: '已拒绝',
    revoked: '已撤回',
    expired: '已到期',
  } as const)[status];
}

function cleanupStatusLabel(status: PublicPortraitAuthorization['cleanupStatus'] | undefined) {
  if (status === 'pending') return '正在清理';
  if (status === 'completed') return '已完成';
  if (status === 'manual-review') return '需要人工复核';
  return '尚未请求';
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '待确认'
    : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
