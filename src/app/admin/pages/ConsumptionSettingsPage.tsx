import { useEffect,useMemo,useState } from 'react';
import { toast } from 'sonner';
import {
  DEFAULT_VIDEO_MODEL_CAPABILITIES,
  VIDEO_CONSUMPTION_MODELS,
  type ConsumptionSettings,
  type ImageConsumptionSetting,
  type VideoConsumptionSetting,
  type VideoModelCapability,
} from '../../data/consumption';
import { Badge,Button,Card,Input } from '../../ui';

import {
  AdminDataTable,
  ConsumptionCreditsForm,
  FilterChips,
  PageShell,
  Stack,
  VideoConsumptionCreditsForm,
} from '../components/AdminPageShared';
import type { AdminTkPromptEngineSettingsUpdate,ConfirmState,DetailState } from '../types';

const SEEDANCE_25_MODEL_ID = 'seedance-2.5';

export function AdminConsumptionSettingsPage({ consumptionSettings, onConsumptionCreditsChange, onSeedance25AvailabilityChange, onTkPromptEngineSettingsChange, setDetail, setConfirm }: {
  consumptionSettings: ConsumptionSettings;
  onConsumptionCreditsChange: (id: string, payload: { credits?: number; referenceVideoCredits?: number; available?: boolean }) => Promise<void>;
  onSeedance25AvailabilityChange: (available: boolean) => Promise<void>;
  onTkPromptEngineSettingsChange: (payload: AdminTkPromptEngineSettingsUpdate) => Promise<void>;
  setDetail: React.Dispatch<React.SetStateAction<DetailState | null>>;
  setConfirm: (confirm: ConfirmState) => void;
}) {
  const tkPromptEngine = consumptionSettings.tkPromptEngine ?? {
    schemaVersion: 1 as const,
    generationCredits: 1,
    available: false,
    updatedAt: '',
  };
  const [modelFilter, setModelFilter] = useState<'all' | VideoConsumptionSetting['model']>('all');
  const [generationCreditsDraft, setGenerationCreditsDraft] = useState(String(tkPromptEngine.generationCredits));
  const filteredVideoSettings = consumptionSettings.video.filter(item => modelFilter === 'all' || item.model === modelFilter);
  const videoModelOptions = useMemo(() => {
    const options = [...VIDEO_CONSUMPTION_MODELS];
    for (const setting of consumptionSettings.video) {
      if (!options.some(option => option.id === setting.model)) {
        options.push({ id: setting.model, label: setting.modelLabel });
      }
    }
    return options;
  }, [consumptionSettings.video]);
  const seedance25Capability = consumptionSettings.videoModels?.find(
    capability => capability.id === SEEDANCE_25_MODEL_ID,
  ) ?? DEFAULT_VIDEO_MODEL_CAPABILITIES[SEEDANCE_25_MODEL_ID];
  const seedance25Rollout = useMemo(
    () => getSeedance25RolloutState(consumptionSettings.video, seedance25Capability),
    [consumptionSettings.video, seedance25Capability],
  );
  const availableCount = [...consumptionSettings.video, ...consumptionSettings.image].filter(item => item.available).length;
  const unavailableCount = consumptionSettings.video.length + consumptionSettings.image.length - availableCount;
  const generationCredits = useMemo(() => Number(generationCreditsDraft), [generationCreditsDraft]);
  const generationCreditsError = generationCreditsDraft.trim() === ''
    ? '请输入提示词方案生成积分'
    : !Number.isSafeInteger(generationCredits) || generationCredits < 0
      ? '积分必须是大于或等于 0 的整数'
      : undefined;
  const tkPromptEngineDirty = !generationCreditsError && generationCredits !== tkPromptEngine.generationCredits;

  useEffect(() => {
    setGenerationCreditsDraft(String(tkPromptEngine.generationCredits));
  }, [tkPromptEngine.generationCredits]);

  const openVideoCreditsModal = (item: VideoConsumptionSetting) => {
    setDetail({
      title: '修改视频消耗',
      subtitle: `${item.modelLabel} · ${item.duration}s · ${item.resolution}`,
      content: (
        <VideoConsumptionCreditsForm
          rows={[
            ['模型', item.modelLabel],
            ['时长', `${item.duration}s`],
            ['分辨率', item.resolution],
            ['当前状态', item.available ? <Badge variant="success" dot>可用</Badge> : <Badge variant="purple">暂不开放</Badge>],
            ['无参考视频', `${item.credits} 积分`],
            ['含参考视频', `${item.referenceVideoCredits} 积分`],
          ]}
          currentCredits={item.credits}
          currentReferenceVideoCredits={item.referenceVideoCredits}
          onSubmit={(credits, referenceVideoCredits) => {
            setConfirm({
              title: '确认修改视频消耗？',
              description: `${item.modelLabel} ${item.duration}s ${item.resolution}：无参考视频 ${item.credits} → ${credits} 积分；含参考视频 ${item.referenceVideoCredits} → ${referenceVideoCredits} 积分。`,
              confirmLabel: '确认修改',
              onConfirm: async () => {
                try {
                  await onConsumptionCreditsChange(item.id, { credits, referenceVideoCredits });
                  setDetail(null);
                  toast.success('视频消耗已更新');
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : '视频消耗保存失败');
                }
              },
            });
          }}
        />
      ),
    });
  };

  const openImageCreditsModal = (item: ImageConsumptionSetting) => {
    setDetail({
      title: '修改图片消耗',
      subtitle: `${item.modelLabel} · ${item.resolution}`,
      content: (
        <ConsumptionCreditsForm
          rows={[
            ['模型', item.modelLabel],
            ['输出规格', item.resolution],
            ['当前状态', item.available ? <Badge variant="success" dot>可用</Badge> : <Badge variant="purple">暂不开放</Badge>],
            ['当前消耗', `${item.credits} 积分 / 张`],
          ]}
          currentCredits={item.credits}
          onSubmit={credits => {
            setConfirm({
              title: '确认修改图片消耗？',
              description: `${item.modelLabel} ${item.resolution} 的单张消耗将从 ${item.credits} 积分调整为 ${credits} 积分。`,
              confirmLabel: '确认修改',
              onConfirm: async () => {
                try {
                  await onConsumptionCreditsChange(item.id, { credits });
                  setDetail(null);
                  toast.success('图片消耗已更新');
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : '图片消耗保存失败');
                }
              },
            });
          }}
        />
      ),
    });
  };

  const confirmTkPromptEngineSettings = () => {
    if (generationCreditsError) {
      toast.error(generationCreditsError);
      return;
    }
    setConfirm({
      title: '确认修改TK Prompt Engine整批生成积分？',
      description: `每个商品任务的首个成功批次免费；后续每次换一批safe/native/creative三个方案的消耗将从 ${tkPromptEngine.generationCredits} 调整为 ${generationCredits} 积分。`,
      confirmLabel: '确认保存',
      onConfirm: async () => {
        await onTkPromptEngineSettingsChange({ generationCredits });
        toast.success('TK Prompt Engine整批生成积分已更新');
      },
    });
  };

  const confirmSeedance25Availability = () => {
    const nextAvailable = seedance25Rollout.availableCount === 0;
    if (nextAvailable && !seedance25Rollout.structureComplete) {
      toast.error(`Seedance 2.5 的 ${seedance25Rollout.expectedCount} 个积分组合尚未完整，不能批量开放`);
      return;
    }
    if (nextAvailable && !seedance25Rollout.validPrices) {
      toast.error('Seedance 2.5 存在非正整数积分，不能批量开放');
      return;
    }
    setConfirm({
      title: nextAvailable ? '全量开放 Seedance 2.5？' : '全量暂停 Seedance 2.5？',
      description: nextAvailable
        ? `后台将在同一事务中开放 ${seedance25Capability.resolutions.join(' / ')}、${seedance25Capability.durationSeconds.join(' / ')} 秒共 ${seedance25Rollout.expectedCount} 个组合。当前已有 ${seedance25Rollout.availableCount}/${seedance25Rollout.expectedCount} 个开放；普通与含参考视频积分保持不变。`
        : `后台将在同一事务中暂停 Seedance 2.5 的全部 ${seedance25Rollout.expectedCount} 个组合，用户端将不再接受新的 2.5 生成任务；积分配置保持不变。`,
      confirmLabel: nextAvailable ? '确认全量开放' : '确认全量暂停',
      danger: !nextAvailable,
      onConfirm: async () => {
        try {
          await onSeedance25AvailabilityChange(nextAvailable);
          toast.success(nextAvailable ? 'Seedance 2.5 已全量开放' : 'Seedance 2.5 已全量暂停');
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Seedance 2.5 开放状态更新失败');
        }
      },
    });
  };

  return (
    <PageShell title="积分消耗" subtitle="配置 AI Studio 视频、图片生成和 TK Prompt Engine 1.0 的积分规则">
      <Card data-testid="tk-prompt-engine-credits-card" className="p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 lg:max-w-2xl">
            <h2 className="text-base font-semibold text-white">TK Prompt Engine 1.0 整批生成积分</h2>
            <p className="mt-2 text-sm leading-6 text-gray-400">
              首个成功的safe/native/creative三方案批次免费；这里设置后续每次“换一批”的整批积分消耗。
            </p>
          </div>

          <div className="grid w-full gap-4 sm:grid-cols-[minmax(220px,320px)_auto] sm:items-end lg:w-auto">
            <Input
              label="TK Prompt Engine整批生成积分"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={generationCreditsDraft}
              onChange={event => setGenerationCreditsDraft(event.target.value)}
              error={generationCreditsError}
              hint="后续每次换一批三个方案"
              suffix="积分"
            />
            <Button
              variant="primary"
              disabled={!tkPromptEngineDirty || Boolean(generationCreditsError)}
              onClick={confirmTkPromptEngineSettings}
            >
              保存积分
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="p-5">
          <p className="text-xs text-gray-500">视频组合</p>
          <p className="mt-2 text-2xl font-bold text-white">{consumptionSettings.video.length}</p>
          <p className="mt-1 text-xs text-gray-500">模型 × 时长 × 分辨率，每组双档</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-gray-500">当前可用配置</p>
          <p className="mt-2 text-2xl font-bold text-white">{availableCount}</p>
          <p className="mt-1 text-xs text-gray-500">视频与图片合计</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-gray-500">暂不开放</p>
          <p className="mt-2 text-2xl font-bold text-white">{unavailableCount}</p>
          <p className="mt-1 text-xs text-gray-500">不会出现在用户端</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-gray-500">图片规格</p>
          <p className="mt-2 text-2xl font-bold text-white">{consumptionSettings.image.length}</p>
          <p className="mt-1 text-xs text-gray-500">Seedream 1K / 2K 分档</p>
        </Card>
      </div>

      <Card className="p-5">
        <div>
          <h2 className="text-base font-semibold text-white">Seedream 图片单张消耗</h2>
          <p className="mt-1 text-sm text-gray-400">1K 与 2K 分别配置积分和开放状态；这里是站内积分，不等同于供应商人民币列表价。</p>
        </div>
      </Card>

      <AdminDataTable
        items={consumptionSettings.image}
        paginationLabel="图片积分消耗分页导航"
        pageSize={2}
        gridTemplate="1.4fr .7fr .8fr .8fr 1.2fr"
        columns={[
          { header: '模型', render: item => <Stack title={item.modelLabel} subtitle={item.model} /> },
          { header: '输出规格', render: item => item.resolution },
          { header: '状态', render: item => item.available
            ? <Badge variant="success" dot>可用</Badge>
            : <Badge variant="purple">暂不开放</Badge> },
          { header: '单张消耗', render: item => <Stack title={`${item.credits} 积分`} subtitle="每张输出" /> },
          { header: '操作', render: item => (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => openImageCreditsModal(item)}>修改积分</Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setConfirm({
                  title: item.available ? `暂停 ${item.resolution} 图片生成？` : `开放 ${item.resolution} 图片生成？`,
                  description: `${item.modelLabel} ${item.resolution} 将${item.available ? '从用户端下线' : '按当前积分配置向用户开放'}。`,
                  confirmLabel: item.available ? '确认暂停' : '确认开放',
                  onConfirm: async () => {
                    await onConsumptionCreditsChange(item.id, { credits: item.credits, available: !item.available });
                    toast.success(item.available ? '图片规格已暂停' : '图片规格已开放');
                  },
                })}
              >
                {item.available ? '暂停' : '开放'}
              </Button>
            </div>
          ) },
        ]}
      />

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-white">视频单条消耗</h2>
            <p className="mt-1 text-sm text-gray-400">每个模型、时长和分辨率组合分别配置无参考视频与含参考视频积分。</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-400">Seedance 2.5</span>
                {!seedance25Rollout.structureComplete
                  ? <Badge variant="warning">配置 {seedance25Rollout.total}/{seedance25Rollout.expectedCount}</Badge>
                  : !seedance25Rollout.validPrices
                    ? <Badge variant="warning">积分异常 · {seedance25Rollout.availableCount}/{seedance25Rollout.expectedCount} 已开放</Badge>
                    : seedance25Rollout.allAvailable
                      ? <Badge variant="success" dot>{seedance25Rollout.expectedCount}/{seedance25Rollout.expectedCount} 已开放</Badge>
                      : <Badge variant="purple">{seedance25Rollout.availableCount}/{seedance25Rollout.expectedCount} 已开放</Badge>}
                <Button
                  size="sm"
                  variant={seedance25Rollout.availableCount > 0 ? 'secondary' : 'primary'}
                  disabled={seedance25Rollout.availableCount === 0 && (!seedance25Rollout.structureComplete || !seedance25Rollout.validPrices)}
                  onClick={confirmSeedance25Availability}
                >
                  {seedance25Rollout.availableCount > 0 ? '全部暂停' : '一次性开放'}
                </Button>
              </div>
            </div>
            <FilterChips
              label="模型"
              value={modelFilter}
              onChange={setModelFilter}
              options={[
                { value: 'all', label: '全部模型' },
                ...videoModelOptions.map(model => ({ value: model.id, label: model.label })),
              ]}
            />
          </div>
        </div>
      </Card>

      <AdminDataTable
        items={filteredVideoSettings}
        paginationLabel="视频积分消耗分页导航"
        pageSize={40}
        gridTemplate="1.2fr .65fr .75fr .7fr .8fr .8fr .65fr"
        columns={[
          { header: '模型', render: item => <Stack title={item.modelLabel} subtitle={item.model} /> },
          { header: '时长', render: item => `${item.duration}s` },
          { header: '分辨率', render: item => item.resolution },
          { header: '状态', render: item => (
            item.available
              ? <Badge variant="success" dot>可用</Badge>
              : <Badge variant="purple">暂不开放</Badge>
          ) },
          { header: '无参考视频', render: item => (
            <div className="flex items-center gap-1">
              <span className="font-semibold text-white">{item.credits}</span>
              <span className="text-xs text-gray-500">积分</span>
            </div>
          ) },
          { header: '含参考视频', render: item => (
            <div className="flex items-center gap-1">
              <span className="font-semibold text-white">{item.referenceVideoCredits}</span>
              <span className="text-xs text-gray-500">积分</span>
            </div>
          ) },
          { header: '操作', render: item => (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => openVideoCreditsModal(item)}>修改积分</Button>
              {item.model !== SEEDANCE_25_MODEL_ID && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setConfirm({
                    title: item.available ? `暂停 ${item.modelLabel} 当前组合？` : `开放 ${item.modelLabel} 当前组合？`,
                    description: `${item.modelLabel} ${item.duration}s ${item.resolution} 将${item.available ? '从用户端下线' : '按当前普通与含参考视频积分开放'}；其他组合不受影响。`,
                    confirmLabel: item.available ? '确认暂停' : '确认开放',
                    onConfirm: async () => {
                      await onConsumptionCreditsChange(item.id, { available: !item.available });
                      toast.success(item.available ? '视频组合已暂停' : '视频组合已开放');
                    },
                  })}
                >
                  {item.available ? '暂停' : '开放'}
                </Button>
              )}
            </div>
          ) },
        ]}
      />

      <Card className="p-5">
        <div className="grid gap-4 text-sm md:grid-cols-3">
          <div>
            <p className="font-semibold text-white">用户端按钮</p>
            <p className="mt-1 text-xs leading-5 text-gray-400">AI Studio 根据参考素材是否包含视频实时切换档位，数量变化后同步更新合计。</p>
          </div>
          <div>
            <p className="font-semibold text-white">暂不开放组合</p>
            <p className="mt-1 text-xs leading-5 text-gray-400">Seedance 2.5 初始默认关闭，可在完成验证后一次性开放；Fast / Mini 的 1080p 继续只作后台预留。</p>
          </div>
          <div>
            <p className="font-semibold text-white">图片生成</p>
            <p className="mt-1 text-xs leading-5 text-gray-400">Seedream 5.0 Pro 按 1K / 2K 分档配置站内积分；供应商成本看盘使用生成时固化的官网列表价快照。</p>
          </div>
        </div>
      </Card>
    </PageShell>
  );
}

export function getSeedance25RolloutState(
  settings: VideoConsumptionSetting[],
  capability: VideoModelCapability = DEFAULT_VIDEO_MODEL_CAPABILITIES[SEEDANCE_25_MODEL_ID],
) {
  const rows = settings.filter(item => item.model === SEEDANCE_25_MODEL_ID);
  const expectedCombinations = new Set(capability.resolutions.flatMap(resolution => (
    capability.durationSeconds.map(duration => `${duration}:${resolution}`)
  )));
  const combinationKeys = new Set(rows.map(item => `${item.duration}:${item.resolution}`));
  const structureComplete = rows.length === expectedCombinations.size
    && combinationKeys.size === expectedCombinations.size
    && [...expectedCombinations].every(key => combinationKeys.has(key));
  const validPrices = rows.every(item => (
    Number.isSafeInteger(item.credits)
    && item.credits > 0
    && Number.isSafeInteger(item.referenceVideoCredits)
    && item.referenceVideoCredits > 0
  ));
  const complete = structureComplete && validPrices;
  const availableCount = rows.filter(item => item.available).length;
  return {
    total: rows.length,
    expectedCount: expectedCombinations.size,
    availableCount,
    structureComplete,
    validPrices,
    complete,
    allAvailable: complete && availableCount === expectedCombinations.size,
  };
}
