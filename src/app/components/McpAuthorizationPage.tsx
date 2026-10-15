import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { getMcpInteraction, MCP_SCOPE_LABELS, submitMcpInteraction } from '../api/mcp';
import { Button, Card, LoadingState } from '../ui';

export function McpAuthorizationPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const id = new URLSearchParams(window.location.search).get('interaction') ?? '';
  const [data, setData] = useState<Awaited<ReturnType<typeof getMcpInteraction>> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(id)) {
      setError('授权地址无效，请从 ChatGPT 或 Codex 重新连接。');
      return;
    }
    getMcpInteraction(id)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : '授权请求已过期，请从 ChatGPT 或 Codex 重新连接。',
          );
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function submit(allow: boolean) {
    if (!data?.csrfToken) return;
    setBusy(true);
    setError('');
    try {
      const result = await submitMcpInteraction(id, allow, data.csrfToken);
      const target = new URL(result.redirectUrl);
      if (target.origin !== window.location.origin || !target.pathname.startsWith('/oauth/'))
        throw new Error('授权回跳地址无效');
      window.location.assign(target.href);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '授权失败');
      setBusy(false);
    }
  }
  return (
    <main className="relative flex min-h-screen items-center justify-center p-5">
      <Card className="w-full max-w-lg p-6 sm:p-8 space-y-5">
        <ShieldCheck className="h-9 w-9 text-violet-300" />
        <h1 className="text-2xl font-semibold">连接 Lindyson 与 {data?.clientName ?? 'MCP 客户端'}</h1>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        {!data && !error ? (
          <LoadingState label="正在读取授权请求" />
        ) : data?.loginRequired ? (
          <>
            <p className="text-sm text-white/65">
              请先登录 Lindyson，再查看并确认 {data.clientName} 的访问权限。
            </p>
            <Button
              variant="primary"
              onClick={() => onNavigate(`/login?mcp_interaction=${encodeURIComponent(id)}`)}
            >
              登录 Lindyson
            </Button>
          </>
        ) : data ? (
          <>
            <p className="text-sm text-white/65">当前账号：{data.email}</p>
            <ul className="space-y-3 rounded-xl bg-white/5 p-4 text-sm">
              {data.scopes.map((scope) => (
                <li key={scope}>{MCP_SCOPE_LABELS[scope] ?? scope}</li>
              ))}
            </ul>
            <p className="text-sm text-amber-200/90">
              生成图片和视频将消耗你的 Lindyson 积分，价格与网站一致。你可以随时在账户中心撤销授权。
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" disabled={busy} onClick={() => void submit(false)}>
                拒绝
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => void submit(true)}>
                {busy ? '处理中…' : '同意并连接'}
              </Button>
            </div>
          </>
        ) : null}
      </Card>
    </main>
  );
}
