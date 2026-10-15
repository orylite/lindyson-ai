import { CreditCard,KeyRound,Save } from 'lucide-react';
import { useEffect,useState } from 'react';
import { toast } from 'sonner';
import type { AdminPaymentChannel } from '../../data/admin';
import { Badge,Button,Card,Input,Toggle } from '../../ui';
import { PageShell } from '../components/AdminPageShared';
import type { ConfirmState } from '../types';

export function AdminPaymentChannelPage({ channel, onSave, setConfirm }: {
  channel: AdminPaymentChannel;
  onSave: (payload: Omit<AdminPaymentChannel, 'hasApiKey' | 'updatedAt'> & { apiKey?: string }) => Promise<AdminPaymentChannel>;
  setConfirm: (confirm: ConfirmState) => void;
}) {
  const [enabled, setEnabled] = useState(channel.enabled);
  const [apiBase, setApiBase] = useState(channel.apiBase);
  const [mchNo, setMchNo] = useState(channel.mchNo);
  const [appId, setAppId] = useState(channel.appId);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(channel.enabled);
    setApiBase(channel.apiBase);
    setMchNo(channel.mchNo);
    setAppId(channel.appId);
    setApiKey('');
  }, [channel]);

  const save = async () => {
    if (saving) return;
    if (enabled && (!apiBase.trim() || !mchNo.trim() || !appId.trim() || (!channel.hasApiKey && !apiKey.trim()))) {
      toast.error('启用支付通道前请填写完整配置');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        enabled,
        apiBase: apiBase.trim(),
        mchNo: mchNo.trim(),
        appId: appId.trim(),
        apiKey: apiKey.trim() || undefined,
        desktopWayCode: 'ALI_WAP',
        mobileWayCode: 'ALI_WAP',
      });
      setApiKey('');
      toast.success(enabled ? '支付通道已保存并启用' : '支付通道配置已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '支付通道保存失败');
    } finally {
      setSaving(false);
    }
  };

  const requestSave = () => {
    if (!enabled) {
      void save();
      return;
    }
    setConfirm({
      title: '确认启用支付通道？',
      description: '启用后，用户新建订阅订单将使用当前配置发起在线支付。',
      confirmLabel: '保存并启用',
      onConfirm: save,
    });
  };

  return (
    <PageShell
      title="支付通道"
      subtitle="配置用户订阅与积分加购使用的在线支付接口"
      action={<Badge variant={enabled ? 'success' : 'purple'} dot>{enabled ? '已启用' : '未启用'}</Badge>}
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-500/[0.12] text-violet-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                <CreditCard className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-white">在线支付</h2>
                <p className="mt-1 text-xs text-gray-500">桌面扫码与移动网页支付</p>
              </div>
            </div>
            <Toggle enabled={enabled} disabled={saving} onChange={setEnabled} ariaLabel="启用在线支付" />
          </div>

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <div className="md:col-span-2">
              <Input
                label="API 基础地址"
                value={apiBase}
                onChange={event => setApiBase(event.target.value)}
                placeholder="请输入支付接口基础地址"
                autoComplete="off"
              />
            </div>
            <Input label="商户号" value={mchNo} onChange={event => setMchNo(event.target.value)} autoComplete="off" />
            <Input label="应用 ID" value={appId} onChange={event => setAppId(event.target.value)} autoComplete="off" />
            <div className="md:col-span-2">
              <Input
                label="API 密钥"
                type="password"
                value={apiKey}
                onChange={event => setApiKey(event.target.value)}
                placeholder={channel.hasApiKey ? '已配置，留空表示不修改' : '请输入 API 密钥'}
                icon={<KeyRound className="h-4 w-4" />}
                autoComplete="new-password"
                hint="密钥加密保存且不可回显。"
              />
            </div>
            <Input label="桌面支付方式" value="支付宝扫码支付" readOnly />
            <Input label="移动支付方式" value="支付宝手机网页" readOnly />
          </div>

          <div className="mt-6 flex justify-end border-t border-white/10 pt-5">
            <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} onClick={requestSave}>
              {saving ? '正在保存...' : '保存配置'}
            </Button>
          </div>
        </Card>

        <Card className="h-fit p-5">
          <h2 className="text-sm font-semibold text-white">配置状态</h2>
          <div className="mt-4 space-y-3 text-sm">
            <StatusRow label="接口地址" ready={Boolean(channel.apiBase)} />
            <StatusRow label="商户信息" ready={Boolean(channel.mchNo && channel.appId)} />
            <StatusRow label="API 密钥" ready={channel.hasApiKey} />
            <StatusRow label="支付方式" ready />
          </div>
          <p className="mt-5 rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-5 text-gray-400">
            停用只会阻止新订单发起支付，已创建订单的状态通知与退款确认仍会继续处理。
          </p>
          {channel.updatedAt && <p className="mt-3 text-xs text-gray-600">最近更新：{channel.updatedAt}</p>}
        </Card>
      </div>
    </PageShell>
  );
}

function StatusRow({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
      <span className="text-gray-400">{label}</span>
      <span className={ready ? 'text-green-400' : 'text-gray-500'}>{ready ? '已配置' : '未配置'}</span>
    </div>
  );
}
