import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { endpointContracts, type EndpointResponse } from '@lindyson/api-contracts';
import { Copy, Gift, RefreshCw, Users, Coins } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiRequest, getSessionEpoch, isPaginationSnapshotChanged, jsonBody } from '../api/client';
import { privateQueryKey } from '../api/queryClient';
import { useCursorPagination } from '../state/useCursorPagination';
import { Badge, Button, Card, Dialog, Input, Select, Toggle } from '../ui';
import { CursorPagination } from './CursorPagination';

type Settings = EndpointResponse<'adminReferralSettings'>;
type RecordItem = EndpointResponse<'adminReferrals'>['items'][number];
const labels: Record<RecordItem['status'], string> = { waiting: '等待首付', rewarded: '奖励已到账', review: '待人工核对', reversing: '等待冻结积分结算', reversed: '奖励已撤销', closed: '核对已结案' };

export function ReferralRewards({ admin = false }: { admin?: boolean }) {
  const client = useQueryClient();
  const epoch = getSessionEpoch();
  const prefix = privateQueryKey(epoch, 'referrals');
  const paging = useCursorPagination(20);
  const [filters, setFilters] = useState({ search: '', status: '', from: '', to: '' });
  const [searchDraft, setSearchDraft] = useState('');
  const [draft, setDraft] = useState<Settings | null>(null);
  const [reason, setReason] = useState('');
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [resolving, setResolving] = useState<RecordItem | null>(null);
  const [resolveReason, setResolveReason] = useState('');
  const [busy, setBusy] = useState(false);
  const keys = useRef(new Map<string, string>());
  const summary = useQuery({ queryKey: [...prefix, 'summary'], enabled: !admin,
    queryFn: () => apiRequest('/api/account/referrals/summary', endpointContracts.accountReferralSummary.response) });
  const settings = useQuery({ queryKey: [...prefix, 'settings'], enabled: admin,
    queryFn: () => apiRequest('/api/admin/referral-settings', endpointContracts.adminReferralSettings.response) });
  const list = useQuery({ queryKey: [...prefix, admin ? 'admin-list' : 'user-list', filters, paging.request], retry: false,
    queryFn: () => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries({ ...filters, ...paging.request })) if (value !== undefined && value !== '' && key !== 'revision') params.set(key, String(value));
      return apiRequest(`${admin ? '/api/admin' : '/api/account'}/referrals?${params}`, endpointContracts.adminReferrals.response);
    },
  });
  useEffect(() => {
    if (list.error && isPaginationSnapshotChanged(list.error)) { paging.reset(); toast.info('邀请记录已更新，已返回第一页'); }
  }, [list.error, paging.reset]);
  const current = draft ?? settings.data;
  const changed = Boolean(current && settings.data && (current.enabled !== settings.data.enabled || current.inviterCredits !== settings.data.inviterCredits || current.inviteeCredits !== settings.data.inviteeCredits));
  const validCredits = (value: number) => Number.isInteger(value) && value >= 1 && value <= 1000000;
  const saveSettings = () => {
    if (busy || !current) return;
    setSaveAttempted(true);
    if (!reason.trim()) { toast.error('请填写修改原因后保存规则'); return; }
    if (!validCredits(current.inviterCredits) || !validCredits(current.inviteeCredits)) { toast.error('奖励积分须为 1 至 1,000,000 的整数'); return; }
    void mutate('/api/admin/referral-settings', { ...current, reason: reason.trim() });
  };
  const filter = (name: keyof typeof filters, value: string) => { setFilters(previous => ({ ...previous, [name]: value })); paging.reset(); };
  const refresh = async () => { paging.reset(); await client.invalidateQueries({ queryKey: prefix }); };
  async function mutate(path: string, body: object, resolve = false) {
    const identity = JSON.stringify([path, body]);
    const key = keys.current.get(identity) ?? crypto.randomUUID();
    keys.current.set(identity, key);
    if (busy) return;
    setBusy(true);
    try {
      let savedSettings: Settings | undefined;
      if (resolve) await apiRequest(path, endpointContracts.adminReferralResolve.response, { method: 'POST', headers: { 'Idempotency-Key': key }, body: jsonBody(body) });
      else {
        savedSettings = await apiRequest(path, endpointContracts.adminReferralSettingsUpdate.response, { method: 'PATCH', headers: { 'Idempotency-Key': key }, body: jsonBody(body) });
        client.setQueryData([...prefix, 'settings'], savedSettings);
      }
      keys.current.delete(identity);
      setDraft(null); setReason(''); setSaveAttempted(false); setResolving(null); setResolveReason('');
      toast.success(resolve ? '核对处理已记录' : `规则已保存，邀约奖励功能已${savedSettings!.enabled ? '打开' : '关闭'}`);
      await refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) keys.current.delete(identity);
      toast.error(error instanceof Error ? error.message : '操作失败，请重试');
    } finally { setBusy(false); }
  }
  const error = list.error ?? (admin ? settings.error : summary.error);
  return <section className="space-y-5" aria-label="邀约奖励">
    <div className={`flex flex-wrap items-center gap-3 ${admin ? 'justify-end' : 'justify-between'}`}>
      {!admin && <div><h2 className="flex items-center gap-2 text-xl font-semibold text-white"><Gift className="h-5 w-5 text-violet-300" />邀约奖励</h2><p className="mt-2 text-sm text-gray-400">邀请好友创作，首次购买付费主套餐后，双方共享积分奖励。</p></div>}
      <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void refresh()}>刷新记录</Button>
    </div>
    {error && !isPaginationSnapshotChanged(error) && <p role="alert" className="text-sm text-red-300">{error.message}，请点击刷新重试。</p>}
    {admin && current && <Card className="p-5"><form className="space-y-4" noValidate onSubmit={event => { event.preventDefault(); saveSettings(); }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3"><h3 className="font-medium text-white">活动规则</h3><Badge variant={settings.data?.enabled ? 'success' : 'default'} dot>{settings.data?.enabled ? '当前已打开' : '当前已关闭'}</Badge></div>
        <Toggle label="接受新邀请" enabled={current.enabled} disabled={busy} onChange={enabled => setDraft({ ...current, enabled })} />
      </div>
      <p role="status" className={`text-xs leading-6 ${changed ? 'text-amber-300' : 'text-gray-400'}`}>{changed ? `尚未保存：保存后功能将${current.enabled ? '打开' : '关闭'}，并使用下方奖励额度。` : '开启后允许新用户绑定邀请；修改开关或奖励额度后，请填写原因并保存规则。'}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="邀请人奖励积分" type="number" min={1} max={1000000} error={saveAttempted && !validCredits(current.inviterCredits) ? '请输入 1 至 1,000,000 的整数' : undefined} value={current.inviterCredits} disabled={busy} onChange={e => setDraft({ ...current, inviterCredits: Number(e.target.value) })} />
        <Input label="新用户奖励积分" type="number" min={1} max={1000000} error={saveAttempted && !validCredits(current.inviteeCredits) ? '请输入 1 至 1,000,000 的整数' : undefined} value={current.inviteeCredits} disabled={busy} onChange={e => setDraft({ ...current, inviteeCredits: Number(e.target.value) })} />
      </div>
      <p className="text-xs leading-6 text-gray-400">规则仅影响之后注册绑定的邀请。关闭活动仍兑现已绑定奖励。仅付费主套餐触发，加购包不计入；每位新人限一次，人数不限。</p>
      <Input label="修改原因" aria-required="true" hint="必填，用于记录本次开关或奖励额度变更。" placeholder="例如：开启新用户邀约活动" error={saveAttempted && !reason.trim() ? '请填写修改原因' : undefined} value={reason} maxLength={500} disabled={busy} onChange={e => setReason(e.target.value)} />
      <Button type="submit" loading={busy}>{busy ? '正在保存规则…' : '保存规则'}</Button>
    </form></Card>}
    {!admin && summary.data && <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5"><Users className="mb-3 h-5 w-5 text-violet-300" /><p className="text-sm text-gray-400">累计邀请</p><p className="mt-2 text-3xl font-semibold text-white">{summary.data.invited}<span className="ml-2 text-sm text-gray-400">人</span></p></Card>
        <Card className="p-5"><Coins className="mb-3 h-5 w-5 text-amber-300" /><p className="text-sm text-gray-400">累计奖励积分（扣除已追回）</p><p className="mt-2 text-3xl font-semibold text-white">{summary.data.earned.toLocaleString()}</p></Card>
      </div>
      <Card variant="raised" className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-white">分享你的专属邀请</h3><Badge variant={summary.data.settings.enabled ? 'success' : 'default'}>{summary.data.settings.enabled ? '活动进行中' : '暂不接受新邀请'}</Badge></div>
        <p className="text-sm leading-7 text-gray-300">好友通过邀请完成注册，首次购买月付或年付主套餐后，你获得 <strong className="text-violet-200">{summary.data.settings.inviterCredits} 积分</strong>，好友获得 <strong className="text-violet-200">{summary.data.settings.inviteeCredits} 积分</strong>。</p>
        <Input label="专属邀请链接" readOnly value={`${window.location.origin}/register?ref=${summary.data.code}`} />
        <div className="flex flex-wrap items-center gap-3"><Button disabled={!summary.data.settings.enabled} icon={<Copy className="h-4 w-4" />} onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/register?ref=${summary.data!.code}`).then(() => toast.success('邀请链接已复制')).catch(() => toast.error('复制失败，请手动复制上方链接')); }}>复制邀请链接</Button><p className="break-all text-xs text-gray-400">邀请码：{summary.data.code}</p></div>
        <p className="text-xs leading-6 text-gray-400">限新用户注册时绑定，每位新用户奖励一次。奖励长期有效。</p>
      </Card>
    </>}
    <Card className="space-y-4 p-5">
      <h3 className="font-medium text-white">{admin ? '邀请与奖励记录' : '我的邀请记录'}{list.data ? ` · 共 ${list.data.pagination.totalItems} 条` : ''}</h3>
      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {admin && <form onSubmit={e => { e.preventDefault(); filter('search', searchDraft.trim()); }}><Input label="用户邮箱" value={searchDraft} maxLength={120} onChange={e => setSearchDraft(e.target.value)} placeholder="输入后回车搜索" /></form>}
        <Select
          label="奖励状态"
          value={filters.status}
          options={[{ value: '', label: '全部状态' }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))]}
          onValueChange={value => filter('status', value)}
        />
        <Input type="date" label="注册开始日期" value={filters.from} onChange={e => filter('from', e.target.value)} />
        <Input type="date" label="注册结束日期" min={filters.from || undefined} value={filters.to} onChange={e => filter('to', e.target.value)} />
      </div>
      {list.isLoading && <p role="status" className="py-8 text-center text-sm text-gray-400">正在加载邀请记录…</p>}
      {list.data?.items.length === 0 && <p className="py-10 text-center text-sm text-gray-400">暂无邀请记录{!admin && '，分享链接邀请好友开始创作吧。'}</p>}
      <div className="divide-y divide-white/10">{list.data?.items.map(row => <div key={row.id} className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="min-w-0 break-all text-sm text-white">{admin ? `${row.inviter} → ${row.invitee}` : row.invitee}</p><Badge variant={row.status === 'rewarded' ? 'success' : row.status === 'review' ? 'warning' : 'default'}>{labels[row.status]}</Badge></div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-400"><span>{new Date(row.createdAt).toLocaleString('zh-CN')}</span><span>邀请人 {row.inviterCredits} / 新人 {row.inviteeCredits} 积分</span>{admin && <><span>已发 {row.granted} · 已追回 {row.reversed}</span><span>冻结 {row.held} · 已用 {row.consumed}</span></>}</div>
        {admin && row.orderId && <p className="break-all text-xs text-gray-500">触发订单：{row.orderId}</p>}
        {admin && row.reviewNote && <p className="text-xs text-gray-400">核对记录：{row.reviewNote}</p>}
        {admin && row.status === 'review' && <Button size="sm" variant="secondary" onClick={() => { setResolving(row); setResolveReason(''); }}>{row.refundedAt ? '核对已用奖励' : '处理待发奖励'}</Button>}
      </div>)}</div>
      {list.data && <CursorPagination pagination={{ ...list.data.pagination, position: paging.request.position }} loading={list.isFetching} onNavigate={position => paging.navigate(position, list.data ? { ...list.data.pagination, position: paging.request.position } : undefined)} />}
    </Card>
    {resolving && <Dialog onClose={() => setResolving(null)} closeDisabled={busy} ariaLabel="奖励人工核对" panelClassName="w-full max-w-lg rounded-2xl border border-white/10 bg-[#11111b] p-6">
      <h3 className="text-lg font-semibold text-white">{resolving.refundedAt ? '核对已消耗奖励' : '补发邀约奖励'}</h3>
      <p className="my-4 text-sm leading-6 text-gray-400">{resolving.refundedAt ? '结案仅确认当前已消耗部分，不扣其他积分。尚被冻结的奖励继续等待任务结算；新产生的消耗仍需核对。' : '双方账号恢复正常且订单未退款时，补发原约定奖励。重复操作不会重复到账。'}</p>
      <Input label="处理说明" maxLength={500} value={resolveReason} disabled={busy} onChange={e => setResolveReason(e.target.value)} />
      <div className="mt-5 flex justify-end gap-3"><Button variant="secondary" disabled={busy} onClick={() => setResolving(null)}>取消</Button><Button disabled={busy || !resolveReason.trim()} onClick={() => void mutate(`/api/admin/referrals/${resolving.id}/resolve`, { action: resolving.refundedAt ? 'close' : 'grant', reason: resolveReason.trim() }, true)}>{resolving.refundedAt ? '确认结案' : '确认补发'}</Button></div>
    </Dialog>}
  </section>;
}
