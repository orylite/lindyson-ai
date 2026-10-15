import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Maximize2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card, Dialog } from '../ui';

const highlights = [
  { left: 72.5, top: 17.5, width: 17, height: 3.3, side: 'right' },
  { left: 9.8, top: 39.9, width: 78.4, height: 3.6, side: 'left' },
  { left: 78.3, top: 45.5, width: 9.5, height: 2.9, side: 'right' },
  { left: 9.8, top: 54.3, width: 78.4, height: 3.7, side: 'left' },
  { left: 8.4, top: 58.9, width: 81.2, height: 33.9, side: 'left' },
  { left: 84.7, top: 93.4, width: 5, height: 2.8, side: 'right' },
];

function AnnotatedScreenshot() {
  return (
    <div className="overflow-hidden rounded-xl bg-white px-7 sm:px-8">
      <div className="relative">
        <img
          src="/tutorials/codex-mcp-setup.png"
          alt="Codex 添加 MCP 服务器界面，紫色编号 1 至 6 对应下方填写说明"
          width={1790}
          height={1976}
          className="block h-auto w-full"
          loading="lazy"
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {highlights.map(({ left, top, width, height, side }, index) => {
            const center = `${top + height / 2}%`;
            return (
              <div key={index}>
                <div
                  className="absolute rounded border-2 border-violet-600"
                  style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
                />
                <span
                  className="absolute h-px bg-violet-600"
                  style={{ top: center, left: `${side === 'left' ? 0 : left + width}%`, width: `${side === 'left' ? left : 100 - left - width}%` }}
                />
                <span
                  className="absolute flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white sm:h-6 sm:w-6"
                  style={{ top: center, [side === 'left' ? 'right' : 'left']: 'calc(100% + 3px)' }}
                >
                  {index + 1}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function CodexConnectionGuide({ url }: { url: string }) {
  const [expanded, setExpanded] = useState(false);
  const steps = [
    { title: '添加入口', description: '在 Codex 打开「插件」，点击右上角「添加 → 添加 MCP 服务器」。' },
    { title: '名称', description: <>填写 <code className="text-violet-200">lindyson</code>。</> },
    { title: '类型', description: '选择「流式 HTTP」（Streamable HTTP）。' },
    {
      title: 'URL',
      description: <>
        <span>粘贴账户中心提供的 MCP 地址：</span>
        <span className="mt-1 flex items-center gap-1">
          <code className="min-w-0 break-all text-violet-200">{url}</code>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 !p-1"
            aria-label="复制图解中的 MCP 地址"
            title="复制链接"
            onClick={() => void navigator.clipboard.writeText(url)
              .then(() => toast.success('MCP 地址已复制'))
              .catch(() => toast.error('复制失败，请手动复制地址'))}
          >
            <Copy aria-hidden="true" className="h-4 w-4" />
          </Button>
        </span>
      </>,
    },
    { title: '以下字段全部留空', description: 'Bearer 令牌环境变量、标头、来自环境变量的标头均不需要填写。连接通过 Lindyson 登录授权。' },
    { title: '保存并授权', description: '点击「保存」，随后按提示点击「认证 / Authenticate」，登录 Lindyson 并确认权限。若提示重启服务器，先完成重启。' },
  ];
  return (
    <Card className="p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Codex 接入图解</h2>
          <p className="mt-1 text-sm text-white/60">按图中编号填写，点击 URL 旁的图标即可复制地址。</p>
        </div>
        <Button size="sm" variant="secondary" icon={<Maximize2 className="h-4 w-4" />} onClick={() => setExpanded(true)}>
          放大查看
        </Button>
      </div>
      <figure className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <AnnotatedScreenshot />
        <figcaption>
          <ol className="space-y-5" aria-label="Codex 截图标注说明">
            {steps.map((step, index) => (
              <li key={step.title} className="flex min-w-0 gap-3">
                <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 text-sm font-semibold text-white">{index + 1}</span>
                <div className="min-w-0 space-y-1">
                  <h3 className="text-sm font-medium">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-white/65">{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-xs leading-relaxed text-white/45">截图用于定位入口和字段；实际界面可能随 Codex 版本略有变化。</p>
        </figcaption>
      </figure>
      {expanded && createPortal(
        <Dialog onClose={() => setExpanded(false)} ariaLabel="Codex 接入图解大图" className="max-w-4xl rounded-2xl bg-[#141522] p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Codex 接入图解 · 编号对应页面中的填写说明</p>
            <Button size="sm" variant="ghost" aria-label="关闭大图" icon={<X className="h-4 w-4" />} onClick={() => setExpanded(false)}>关闭</Button>
          </div>
          <div className="max-h-[75vh] overflow-auto rounded-xl">
            <div className="min-w-[640px]"><AnnotatedScreenshot /></div>
          </div>
        </Dialog>,
        document.body,
      )}
    </Card>
  );
}
