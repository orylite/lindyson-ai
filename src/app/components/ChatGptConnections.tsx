import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, RefreshCw, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { getMcpConnections, MCP_SCOPE_LABELS, revokeMcpConnection } from '../api/mcp';
import { getSessionEpoch } from '../api/client';
import { privateQueryKey } from '../api/queryClient';
import { Badge, Button, Card, EmptyState, LoadingState } from '../ui';
import { CodexConnectionGuide } from './CodexConnectionGuide';

export function ChatGptConnections() {
  const queryClient = useQueryClient();
  const sessionEpoch = getSessionEpoch();
  const queryKey = useMemo(() => privateQueryKey(sessionEpoch, 'account', 'mcp'), [sessionEpoch]);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { data, error, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: ({ signal }) => getMcpConnections(signal),
    enabled: busy === null,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const isCurrentSession = useCallback(
    () => mountedRef.current && getSessionEpoch() === sessionEpoch,
    [sessionEpoch],
  );
  const clearRefreshTimer = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = undefined;
  }, []);
  const refresh = useCallback(() => {
    clearRefreshTimer();
    if (isCurrentSession() && busyRef.current === null) {
      // 复用尚未完成的查询，避免焦点、可见性和手动刷新互相取消。
      void refetch({ cancelRefetch: false });
    }
  }, [clearRefreshTimer, isCurrentSession, refetch]);
  useEffect(() => {
    mountedRef.current = true;
    const scheduleRefresh = () => {
      clearRefreshTimer();
      if (document.visibilityState === 'visible' && busyRef.current === null) {
        refreshTimer.current = setTimeout(refresh, 200);
      }
    };
    window.addEventListener('focus', scheduleRefresh);
    document.addEventListener('visibilitychange', scheduleRefresh);
    return () => {
      mountedRef.current = false;
      clearRefreshTimer();
      window.removeEventListener('focus', scheduleRefresh);
      document.removeEventListener('visibilitychange', scheduleRefresh);
      // 查询消费 AbortSignal，最后一个观察者卸载时由 React Query 取消请求。
    };
  }, [clearRefreshTimer, refresh]);
  async function revoke(id: string) {
    if (!isCurrentSession() || busyRef.current !== null) return;
    busyRef.current = id;
    clearRefreshTimer();
    setBusy(id);
    try {
      await queryClient.cancelQueries({ queryKey, exact: true });
      if (!isCurrentSession()) return;
      await revokeMcpConnection(id);
      if (!isCurrentSession()) return;
      queryClient.setQueryData<Awaited<ReturnType<typeof getMcpConnections>>>(queryKey, (current) =>
        current && {
          ...current,
          connections: current.connections.map((connection) =>
            connection.id === id ? { ...connection, active: false } : connection,
          ),
        },
      );
      toast.success('已撤销 MCP 连接');
    } catch (reason) {
      if (isCurrentSession()) toast.error(reason instanceof Error ? reason.message : '撤销失败');
    } finally {
      if (isCurrentSession()) {
        busyRef.current = null;
        // 重新启用已过期查询，成功或失败后均核对一次服务端状态。
        setBusy(null);
      }
    }
  }
  if (error && !data)
    return (
      <Card className="p-6 space-y-4" aria-busy={isFetching}>
        <p role="alert">{error instanceof Error ? error.message : '连接加载失败'}</p>
        <Button
          onClick={refresh}
          disabled={isFetching}
          icon={<RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />}
        >
          {isFetching ? '刷新中…' : '重试'}
        </Button>
      </Card>
    );
  if (!data) return <LoadingState label="正在加载 MCP 连接" />;
  if (!data.enabled)
    return (
      <Card className="p-6">
        <EmptyState
          icon={<Unplug className="h-8 w-8" />}
          title="MCP 连接尚未开放"
          subtitle="开放后，你可以连接 ChatGPT 或 Codex，使用本人素材和积分生成图片与视频。"
        />
      </Card>
    );
  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">在 ChatGPT / Codex 中使用 Lindyson</h2>
          <Badge variant="purple">MCP</Badge>
        </div>
        <p className="text-sm text-white/60">
          两种客户端共用下方地址。生成价格与网站一致，任务和成品会同步到 AI Studio 与数字资产。
          授权后，客户端可以按你的要求消耗账号积分。
        </p>
        <div className="flex flex-col sm:flex-row gap-3 rounded-xl bg-white/5 p-3">
          <code className="min-w-0 flex-1 break-all self-center text-sm">{data.url}</code>
          <Button
            size="sm"
            icon={<Copy className="h-4 w-4" />}
            onClick={() =>
              void navigator.clipboard
                .writeText(data.url!)
                .then(() => toast.success('MCP 地址已复制'))
                .catch(() => toast.error('复制失败，请手动复制地址'))
            }
          >
            复制地址
          </Button>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-white/10 p-4 space-y-3" aria-label="ChatGPT 接入步骤">
            <h3 className="font-medium">ChatGPT</h3>
            <ol className="list-decimal pl-5 space-y-2 text-sm text-white/70">
              <li>打开「设置 → 安全与登录」，开启开发者模式，再到「插件」点击加号添加连接。</li>
              <li>填写名称 Lindyson 和上方 MCP 地址，使用 OAuth 登录 Lindyson，确认访问权限。</li>
              <li>在新对话中启用 Lindyson，即可查询素材、估算积分并生成图片或视频。</li>
            </ol>
            <p className="text-xs text-white/45">自定义连接入口受 ChatGPT 账号和工作区策略影响。</p>
          </section>
          <section className="rounded-xl border border-white/10 p-4 space-y-3" aria-label="Codex 接入步骤">
            <h3 className="font-medium">Codex</h3>
            <ol className="list-decimal pl-5 space-y-2 text-sm text-white/70">
              <li>打开 Codex「插件 → 添加 → 添加 MCP 服务器」。</li>
              <li>名称填写 lindyson，类型选择「流式 HTTP」，URL 粘贴上方 MCP 地址；令牌和标头字段留空。</li>
              <li>保存后按提示完成认证，登录 Lindyson 并确认权限；具体字段见下方图解。</li>
              <li>新建对话，让 Codex 使用 lindyson 查询模型、素材或提交生成。</li>
            </ol>
            <details className="text-sm text-white/70">
              <summary className="cursor-pointer text-violet-300">使用 Codex 命令行接入</summary>
              <pre className="mt-3 whitespace-pre-wrap break-all rounded-lg bg-black/20 p-3 text-xs">
                <code>{`codex mcp add lindyson --url ${data.url}\ncodex mcp login lindyson`}</code>
              </pre>
              <p className="mt-2 text-xs text-white/45">添加时若已完成授权，可跳过第二条命令。</p>
            </details>
          </section>
        </div>
        <p className="text-sm text-white/60">
          生成前先查询所需积分。ChatGPT 聊天附件需先导入；Codex 的本地图片可先上传到网站「数字资产」，
          再让 Codex 查询并选用该素材。
        </p>
      </Card>
      {data.url && <CodexConnectionGuide url={data.url} />}
      <Card className="p-5 sm:p-6 space-y-4" aria-busy={isFetching}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">已授权连接</h2>
          <Button
            size="sm"
            variant="secondary"
            disabled={isFetching || busy !== null}
            icon={<RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />}
            onClick={refresh}
          >
            {isFetching ? '刷新中…' : '刷新连接'}
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-red-300">连接刷新失败，请重试。</p>}
        {!data.connections.length ? (
          <EmptyState
            icon={<Unplug className="h-8 w-8" />}
            title="暂无连接"
            subtitle="完成 ChatGPT 或 Codex 授权后，连接会显示在这里。"
          />
        ) : (
          data.connections.map((connection) => (
            <div key={connection.id} className="rounded-xl border border-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{connection.clientName}</span>
                  <Badge variant={connection.active ? 'success' : 'default'}>
                    {connection.active ? '已连接' : '已失效'}
                  </Badge>
                </div>
                {connection.active && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    icon={<Unplug className="h-4 w-4" />}
                    onClick={() => void revoke(connection.id)}
                  >
                    {busy === connection.id ? '撤销中…' : '撤销授权'}
                  </Button>
                )}
              </div>
              <p className="text-xs text-white/45">
                授权时间：{new Date(connection.createdAt).toLocaleString()} · 最近使用：
                {connection.lastUsedAt
                  ? new Date(connection.lastUsedAt).toLocaleString()
                  : '尚未使用'}
              </p>
              <ul className="space-y-1 text-sm text-white/60">
                {connection.scopes.map((scope) => (
                  <li key={scope}>{MCP_SCOPE_LABELS[scope] ?? scope}</li>
                ))}
              </ul>
            </div>
          ))
        )}
        <p className="text-xs text-white/45">
          撤销会阻止后续访问；已经提交的生成任务继续处理，并按现有规则结算。
        </p>
      </Card>
    </div>
  );
}
