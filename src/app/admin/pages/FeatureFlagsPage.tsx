import { toast } from 'sonner';
import type { ConsumptionSettings } from '../../data/consumption';
import type { FeatureFlags } from '../../data/featureFlags';
import { Badge,Card,Toggle } from '../../ui';

import {
  PageShell
} from '../components/AdminPageShared';
import type { AdminTkPromptEngineSettingsUpdate,ConfirmState } from '../types';

export function AdminFeatureFlagsPage({ featureFlags, tkPromptEngine, onFeatureFlagsChange, onTkPromptEngineSettingsChange, setConfirm }: {
  featureFlags: FeatureFlags;
  tkPromptEngine: ConsumptionSettings['tkPromptEngine'];
  onFeatureFlagsChange: (flags: FeatureFlags) => Promise<void>;
  onTkPromptEngineSettingsChange: (payload: AdminTkPromptEngineSettingsUpdate) => Promise<void>;
  setConfirm: (confirm: ConfirmState) => void;
}) {
  const flagItems: Array<{
    key: keyof FeatureFlags;
    title: string;
    description: string;
  }> = [
    {
      key: 'tiktokAccounts',
      title: '管理 TikTok 账号',
      description: '控制普通用户端「管理TikTok账号」右侧工作区是否显示账号授权管理页面；管理员账号始终可见。',
    },
    {
      key: 'tiktokPublish',
      title: '发布至 TikTok 账号',
      description: '控制普通用户端「发布至TikTok账号」右侧工作区是否显示内容发布页面；管理员账号始终可见。',
    },
  ];

  const updateFlag = (key: keyof FeatureFlags, enabled: boolean) => {
    void onFeatureFlagsChange({ ...featureFlags, [key]: enabled })
      .then(() => toast.success(enabled ? '功能已开启' : '功能已切换为升级中'))
      .catch(error => toast.error(error instanceof Error ? error.message : '功能开关保存失败'));
  };

  const tkPromptEngineLoaded = Boolean(tkPromptEngine?.updatedAt);
  const tkPromptEngineReady = tkPromptEngineLoaded && tkPromptEngine?.schemaVersion === 1;

  const confirmTkPromptEngineChange = (available: boolean) => {
    if (!tkPromptEngineLoaded) return;
    if (available) {
      toast.error('TK Prompt Engine 1.0 只能在后端、付费 Canary 与双站静态验收完成后由受审计终结器开放');
      return;
    }
    setConfirm({
      title: `确认${available ? '开放' : '关闭'} TK Prompt Engine 1.0？`,
      description: available
        ? '开放后，所有账号都可以在 AI Studio 全能参考模式下新建TK1.0任务。'
        : '关闭后，所有账号都无法新建TK1.0任务；历史V6任务与已生成结果保持只读，不会删除。',
      confirmLabel: available ? '确认开放' : '确认关闭',
      onConfirm: async () => {
        await onTkPromptEngineSettingsChange({ available });
        toast.success(available ? 'TK Prompt Engine 1.0已开放' : 'TK Prompt Engine 1.0已关闭');
      },
    });
  };

  return (
    <PageShell title="功能开关" subtitle="管理用户端工作区与 AI Studio 功能的开放状态">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {flagItems.map(item => {
          const enabled = featureFlags[item.key];
          return (
            <Card key={item.key} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-white">{item.title}</h2>
                    <Badge variant={enabled ? 'success' : 'purple'} dot>{enabled ? '已开启' : '升级中'}</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-gray-400">{item.description}</p>
                </div>
                <Toggle enabled={enabled} onChange={(next) => updateFlag(item.key, next)} />
              </div>

              <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs text-gray-500">关闭后的用户端展示</p>
                <p className="mt-2 text-sm font-medium text-white">此功能正在升级优化，请您耐心等待。</p>
              </div>
            </Card>
          );
        })}

        <Card data-testid="tk-prompt-engine-feature-card" className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-white">TK Prompt Engine 1.0</h2>
                <Badge variant={tkPromptEngineReady && tkPromptEngine?.available ? 'success' : 'purple'} dot={tkPromptEngineLoaded}>
                  {tkPromptEngineLoaded
                    ? (!tkPromptEngineReady ? '未就绪' : (tkPromptEngine?.available ? '已开放' : '已关闭'))
                    : '加载中'}
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-gray-400">
                控制 AI Studio 全能参考模式下的TK1.0入口；关闭后不接受新任务。
              </p>
            </div>
            <Toggle
              enabled={tkPromptEngineLoaded && tkPromptEngine?.available === true}
              disabled={!tkPromptEngineLoaded || !tkPromptEngineReady || tkPromptEngine?.available !== true}
              onChange={confirmTkPromptEngineChange}
              ariaLabel="开放 TK Prompt Engine 1.0"
            />
          </div>

          <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-gray-500">生成引擎</p>
            <p className="mt-1 text-sm font-medium text-white">
              {tkPromptEngineReady ? '当前固定 schemaVersion 1' : 'TK Prompt Engine 1.0设置未就绪'}
            </p>
            <p className="mt-3 text-xs leading-5 text-gray-500">
              {tkPromptEngineReady
                ? (tkPromptEngine?.available
                    ? '所有新任务均先确认商品事实，再按市场、口播语言和生产条件原子生成safe/native/creative三个方案；管理端只允许前向关闭。'
                    : '首次开放必须完成后端、付费 Canary 与双站静态验收，并由受审计终结器执行；管理页面不能绕过发布门禁。')
                : '当前仅保留历史V6数据的只读边界，不会回退为新任务入口。'}
            </p>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
