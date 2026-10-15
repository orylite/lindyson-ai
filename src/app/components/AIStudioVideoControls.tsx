import { useState } from 'react';
import { getApiUrl } from '../api/client';
import {
  Check,
  Clock3,
  Layers3,
  SlidersHorizontal,
  Sparkles,
  UserRoundCheck,
  type LucideIcon,
} from 'lucide-react';
import { getVideoConsumptionParameterOptions } from '../data/consumption';
import type {
  ConsumptionVideoAspectRatio,
  ConsumptionVideoDuration,
  ConsumptionVideoMode,
  ConsumptionVideoModel,
  ConsumptionVideoResolution,
  VideoConsumptionSetting,
  VideoModelCapability,
} from '../data/consumption';
import {
  AIStudioCompactAspectRatioPicker,
  AIStudioCompactGenerateButton,
  AIStudioCompactMenuOption,
  AIStudioCompactMenuPortal,
  AIStudioCompactMenuTitle,
  AIStudioCompactParameterGroup,
  AIStudioCompactParameterOption,
  AIStudioCompactRechargeLink,
  AIStudioCompactTrigger,
  handleListboxMenuKeyDown,
  useAIStudioCompactMenus,
} from './AIStudioCompactControls';
import type { RealPortraitActor,RealPortraitAsset } from '../data/realPortraits';
import type { AIStudioGenerateStatus } from './AIStudioGenerateFeedback';

export type VideoModel = ConsumptionVideoModel;
export type AspectRatio = ConsumptionVideoAspectRatio;
export type Resolution = ConsumptionVideoResolution;
export type Duration = ConsumptionVideoDuration;
export type ReferenceMode = ConsumptionVideoMode;

export interface VideoModelOption {
  id: VideoModel;
  name: string;
  desc: string;
  badge: string;
  icon: LucideIcon;
  from: string;
  to: string;
  badgeColor: string;
  enabled: boolean;
}

interface AIStudioVideoControlsProps {
  referenceMode: ReferenceMode;
  videoModel: VideoModel;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  duration: Duration;
  quantity: number;
  models: VideoModelOption[];
  capability: VideoModelCapability;
  availableCombinations: VideoConsumptionSetting[];
  videoTotalCredits: number;
  availableCredits: number;
  configAvailable: boolean;
  generateBlockReason?: string | null;
  generateStatus: AIStudioGenerateStatus;
  onReferenceModeChange: (value: ReferenceMode) => void;
  onModelChange: (value: VideoModel) => void;
  onAspectRatioChange: (value: AspectRatio) => void;
  onResolutionChange: (value: Resolution) => void;
  onDurationChange: (value: Duration) => void;
  onQuantityChange: (value: number) => void;
  realPortraitActors: RealPortraitActor[];
  realPortraitsLoading: boolean;
  selectedRealPortraitActor: RealPortraitActor | null;
  realPortraitAssets: RealPortraitAsset[];
  selectedRealPortraitAssetId: string | null;
  onRealPortraitSelection: (actorId: string | null, assetId: string | null) => void;
  onRealPortraitLibraryOpen: () => void;
  onGenerate: () => Promise<boolean>;
  onCreditsRecharge: () => void;
  onMenuOpen?: () => void;
}

type MenuId = 'mode' | 'model' | 'parameters' | 'quantity' | 'portrait';

const MENU_WIDTHS: Record<MenuId, number> = {
  mode: 300,
  model: 380,
  parameters: 340,
  quantity: 180,
  portrait: 340,
};
const MENU_HEIGHT_ESTIMATES: Record<MenuId, number> = {
  mode: 188,
  model: 372,
  parameters: 520,
  quantity: 238,
  portrait: 380,
};

const REFERENCE_MODES: Array<{ value: ReferenceMode; label: string; description: string }> = [
  { value: 'general', label: '全能参考', description: '使用提示词与参考素材生成视频' },
  { value: 'first-last', label: '首尾帧', description: '指定视频的开始与结束画面' },
];

const QUANTITIES = [1, 2, 3, 4];
const VIDEO_RECHARGE_LABEL = '充值 / 查看套餐';

export function isLimitedResolutionModel(model: VideoModel) {
  return model === 'seedance-2.0-fast' || model === 'seedance-2.0-mini';
}

export function AIStudioVideoControls({
  referenceMode,
  videoModel,
  aspectRatio,
  resolution,
  duration,
  quantity,
  models,
  capability,
  availableCombinations,
  videoTotalCredits,
  availableCredits,
  configAvailable,
  generateBlockReason,
  generateStatus,
  onReferenceModeChange,
  onModelChange,
  onAspectRatioChange,
  onResolutionChange,
  onDurationChange,
  onQuantityChange,
  realPortraitActors,
  realPortraitsLoading,
  selectedRealPortraitActor,
  realPortraitAssets,
  selectedRealPortraitAssetId,
  onRealPortraitSelection,
  onRealPortraitLibraryOpen,
  onGenerate,
  onCreditsRecharge,
  onMenuOpen,
}: AIStudioVideoControlsProps) {
  const selectedModel = models.find(model => model.id === videoModel) ?? models[0];
  const availableAspectRatios = referenceMode === 'first-last'
    ? capability.aspectRatios.firstLast
    : capability.aspectRatios.general;
  const parameterOptions = getVideoConsumptionParameterOptions(
    capability,
    availableCombinations,
    resolution,
  );
  const availableResolutions = parameterOptions.resolutions;
  const availableDurations = parameterOptions.durationSeconds.map(value => String(value) as Duration);
  const portraitUnavailableReason = !capability.supportsRealPortrait
    ? `${capability.label} 的真人演员功能正在适配中。切换至 Seedance 2.0 系列后可使用。`
    : referenceMode !== 'general' ? '真人演员只支持“全能参考”模式。' : null;
  const portraitSelectionDisabled = Boolean(portraitUnavailableReason) || realPortraitsLoading;
  const portraitLabel = selectedRealPortraitActor
    ? `${selectedRealPortraitActor.alias}${portraitUnavailableReason ? '（当前不可用）' : ''}`
    : '不使用真人演员';
  const menuContentKey = [
    referenceMode,
    videoModel,
    aspectRatio,
    resolution,
    duration,
    quantity,
    portraitLabel,
    realPortraitsLoading,
    selectedRealPortraitAssetId,
    realPortraitActors.map(actor => `${actor.id}:${actor.alias}`).join('|'),
    realPortraitAssets.map(asset => `${asset.id}:${asset.kind}`).join('|'),
    availableAspectRatios.join(','),
    availableResolutions.join(','),
    availableDurations.join(','),
    models.map(model => `${model.id}:${model.enabled}:${model.badge}:${model.desc}`).join('|'),
  ].join('::');
  const {
    closeMenu,
    menuPosition,
    openMenu,
    panelRef,
    setTriggerRef,
    toggleMenu,
  } = useAIStudioCompactMenus<MenuId>({
    widths: MENU_WIDTHS,
    heightEstimates: MENU_HEIGHT_ESTIMATES,
    contentKey: menuContentKey,
    onMenuOpen,
  });
  const creditDeficit = Math.max(0, videoTotalCredits - availableCredits);
  const insufficientCredits = configAvailable && videoTotalCredits > 0 && creditDeficit > 0;
  const generateDisabled = generateStatus !== 'idle' || !configAvailable || videoTotalCredits <= 0 || insufficientCredits || Boolean(generateBlockReason);
  const generateLabel = generateStatus === 'queued'
    ? '已加入队列 ✓'
    : generateStatus === 'submitting'
      ? '提交中...'
      : generateBlockReason
        ? '请调整参考素材'
        : !configAvailable || videoTotalCredits <= 0
          ? '当前组合暂不可用'
          : insufficientCredits
            ? `积分不足 · 还差 ${creditDeficit}`
            : `生成视频 · ${videoTotalCredits} 积分`;

  const selectAndClose = <T,>(onChange: (value: T) => void, value: T) => {
    onChange(value);
    closeMenu(true);
  };

  const menu = openMenu ? (
    <AIStudioCompactMenuPortal
      id={`ai-studio-video-${openMenu}-menu`}
      testId={`ai-studio-video-${openMenu}-menu`}
      dataUi="ai-studio-video-menu"
      panelRef={panelRef}
      position={menuPosition}
      role={openMenu === 'parameters' || openMenu === 'portrait' ? 'dialog' : 'listbox'}
      label={openMenu === 'mode' ? '参考模式' : openMenu === 'model' ? 'AI 模型' : openMenu === 'quantity' ? '生成数量' : openMenu === 'portrait' ? '真人演员' : '视频参数'}
      onKeyDown={openMenu === 'parameters' || openMenu === 'portrait' ? undefined : handleListboxMenuKeyDown}
    >
          {openMenu === 'mode' && (
            <div className="space-y-1">
              <AIStudioCompactMenuTitle>选择参考模式</AIStudioCompactMenuTitle>
              {REFERENCE_MODES.map(option => (
                <AIStudioCompactMenuOption
                  key={option.value}
                  selected={referenceMode === option.value}
                  label={option.label}
                  description={option.description}
                  tone="video"
                  onClick={() => selectAndClose(onReferenceModeChange, option.value)}
                />
              ))}
            </div>
          )}

          {openMenu === 'model' && (
            <div className="space-y-1">
              <AIStudioCompactMenuTitle>选择模型</AIStudioCompactMenuTitle>
              {models.map(model => (
                <ModelMenuOption
                  key={model.id}
                  model={model}
                  selected={videoModel === model.id}
                  onClick={() => selectAndClose(onModelChange, model.id)}
                />
              ))}
            </div>
          )}

          {openMenu === 'parameters' && (
            <div className="space-y-4 p-2">
              <div>
                <p className="text-sm font-semibold text-white">视频参数</p>
                <p className="mt-1 text-xs text-gray-500">设置输出画幅、清晰度与时长</p>
              </div>
              <AIStudioCompactAspectRatioPicker
                value={aspectRatio}
                options={availableAspectRatios.map(value => ({
                  value,
                  label: value === 'adaptive' ? '跟随首帧' : value,
                  adaptive: value === 'adaptive',
                }))}
                tone="video"
                columns={2}
                testIdPrefix="ai-studio-video"
                onChange={onAspectRatioChange}
              />
              <AIStudioCompactParameterGroup label="分辨率">
                {availableResolutions.map(value => (
                  <AIStudioCompactParameterOption key={value} tone="video" selected={resolution === value} onClick={() => onResolutionChange(value)}>
                    {value}
                  </AIStudioCompactParameterOption>
                ))}
              </AIStudioCompactParameterGroup>
              {!capability.resolutions.includes('1080p') && (
                <p className="-mt-2 text-[11px] text-amber-300/80">当前模型最高支持 720p</p>
              )}
              <AIStudioCompactParameterGroup label="视频时长">
                {availableDurations.map(value => (
                  <AIStudioCompactParameterOption key={value} tone="video" selected={duration === value} onClick={() => onDurationChange(value)}>
                    {value}s
                  </AIStudioCompactParameterOption>
                ))}
              </AIStudioCompactParameterGroup>
              <p className="-mt-2 text-[11px] text-gray-500">
                {capability.generateAudio ? '生成有声视频' : '静音视频'} · {capability.outputFormat.toUpperCase()} 输出
              </p>
            </div>
          )}

          {openMenu === 'quantity' && (
            <div className="space-y-1">
              <AIStudioCompactMenuTitle>生成数量</AIStudioCompactMenuTitle>
              {QUANTITIES.map(value => (
                <AIStudioCompactMenuOption
                  key={value}
                  selected={quantity === value}
                  label={`${value} 条`}
                  tone="video"
                  onClick={() => selectAndClose(onQuantityChange, value)}
                />
              ))}
            </div>
          )}
          {openMenu === 'portrait' && (
            <div className="space-y-3 [overflow-wrap:anywhere]">
              {portraitUnavailableReason && <p role="status" className="px-3 text-xs leading-5 text-amber-200">{portraitUnavailableReason}{selectedRealPortraitActor && ` 已保留：${selectedRealPortraitActor.alias}（当前不可用）。`}</p>}
              <div role="listbox" aria-label="选择真人演员图片" onKeyDown={handleListboxMenuKeyDown} className="space-y-1">
                <AIStudioCompactMenuOption selected={!selectedRealPortraitActor} label="不使用真人演员" tone="video" onClick={() => onRealPortraitSelection(null, null)} />
                {realPortraitActors.map(actor => (
                  <div key={actor.id} role="group" aria-label={actor.alias} className="flex min-w-0 items-center gap-3 rounded-xl px-3 py-2" data-testid="portrait-actor-row">
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-200" title={actor.alias}>{actor.alias}</span>
                    <div className="flex w-[108px] shrink-0 gap-3">
                      {actor.assets.filter(asset => asset.status === 'active' && asset.consistencyStatus === 'passed')
                        .sort((a, b) => Number(a.kind === 'secondary') - Number(b.kind === 'secondary'))
                        .map(asset => (
                          <PortraitPictureOption key={asset.id} actor={actor} asset={asset}
                            selected={selectedRealPortraitActor?.id === actor.id && selectedRealPortraitAssetId === asset.id}
                            disabled={portraitSelectionDisabled}
                            onSelect={() => onRealPortraitSelection(actor.id, asset.id)} />
                        ))}
                    </div>
                  </div>
                ))}
              </div>
              {realPortraitsLoading ? (
                <p role="status" className="px-3 text-xs text-gray-400">正在读取可用真人演员…</p>
              ) : realPortraitActors.length === 0 && (
                <p className="px-3 text-xs leading-5 text-gray-400">暂无可用真人演员</p>
              )}
              <div className="border-t border-white/10 px-3 py-2">
                <button type="button" onClick={() => { closeMenu(); onRealPortraitLibraryOpen(); }} className="rounded text-xs font-semibold text-violet-300 hover:text-violet-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400">管理演员库 →</button>
              </div>
            </div>
          )}
    </AIStudioCompactMenuPortal>
  ) : null;

  return (
    <div className="mt-4 border-t border-white/[0.08] pt-4" data-testid="ai-studio-video-controls">
      <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:items-center sm:[&>button]:shrink-0">
        <AIStudioCompactTrigger
          idPrefix="ai-studio-video"
          menu="mode"
          label="参考模式"
          value={referenceMode === 'general' ? '全能参考' : '首尾帧'}
          icon={Layers3}
          tone="video"
          open={openMenu === 'mode'}
          onClick={() => toggleMenu('mode')}
          setRef={element => setTriggerRef('mode', element)}
          valueDisplay="full"
        />
        <AIStudioCompactTrigger
          idPrefix="ai-studio-video"
          menu="model"
          label="AI 模型"
          value={selectedModel?.name ?? 'Seedance 2.0'}
          icon={selectedModel?.icon ?? Sparkles}
          tone="video"
          open={openMenu === 'model'}
          onClick={() => toggleMenu('model')}
          setRef={element => setTriggerRef('model', element)}
          valueDisplay="full"
        />
        <AIStudioCompactTrigger
          idPrefix="ai-studio-video"
          menu="parameters"
          label="视频参数"
          value={`${aspectRatio === 'adaptive' ? '跟随首帧' : aspectRatio} · ${resolution} · ${duration}s`}
          icon={SlidersHorizontal}
          popup="dialog"
          tone="video"
          open={openMenu === 'parameters'}
          onClick={() => toggleMenu('parameters')}
          setRef={element => setTriggerRef('parameters', element)}
          valueDisplay="full"
        />
        <AIStudioCompactTrigger
          idPrefix="ai-studio-video"
          menu="quantity"
          label="生成数量"
          value={`${quantity} 条`}
          icon={Clock3}
          tone="video"
          open={openMenu === 'quantity'}
          onClick={() => toggleMenu('quantity')}
          setRef={element => setTriggerRef('quantity', element)}
          valueDisplay="full"
        />
        <AIStudioCompactTrigger
          idPrefix="ai-studio-video"
          menu="portrait"
          label="真人演员"
          value={portraitLabel}
          title={selectedRealPortraitActor ? `${portraitLabel} · 图片${selectedRealPortraitActor.assets.find(asset => asset.id === selectedRealPortraitAssetId)?.kind === 'secondary' ? 2 : 1}` : portraitLabel}
          icon={UserRoundCheck}
          popup="dialog"
          tone="video"
          open={openMenu === 'portrait'}
          onClick={() => toggleMenu('portrait')}
          setRef={element => setTriggerRef('portrait', element)}
          className="col-span-2 max-w-full sm:max-w-[220px] sm:!flex-none"
        />
        <AIStudioCompactGenerateButton
          tone="video"
          onClick={() => void onGenerate()}
          disabled={generateDisabled}
          title={generateBlockReason ?? (insufficientCredits ? `当前还差 ${creditDeficit} 积分` : undefined)}
          label={generateLabel}
          status={generateStatus}
        />
      </div>
      {insufficientCredits && (
        <div className="mt-2 flex justify-end">
          <AIStudioCompactRechargeLink
            tone="video"
            label={VIDEO_RECHARGE_LABEL}
            onClick={onCreditsRecharge}
          />
        </div>
      )}
      {generateBlockReason && <p role="status" className="product-field-error mt-2">{generateBlockReason}</p>}
      {menu}
    </div>
  );
}

function ModelMenuOption({ model, selected, onClick }: { model: VideoModelOption; selected: boolean; onClick: () => void }) {
  const Icon = model.icon;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={!model.enabled}
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-purple-400/50 disabled:cursor-not-allowed disabled:opacity-50 ${selected ? 'bg-purple-500/15' : 'hover:bg-white/[0.06]'}`}
    >
      <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${model.from} ${model.to}`}>
        <Icon aria-hidden="true" className="h-4 w-4 text-white" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="break-words text-sm font-medium text-white">{model.name}</span>
          <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] ${model.badgeColor}`}>{model.badge}</span>
        </span>
        <span className="mt-0.5 block break-words text-xs leading-5 text-gray-500">{model.desc}</span>
        {!model.enabled && (
          <span className="mt-1 block text-[11px] leading-4 text-amber-300/80">当前未开放或积分配置未完整</span>
        )}
      </span>
      {selected && <Check aria-hidden="true" className="mt-2.5 h-4 w-4 flex-shrink-0 text-violet-300" />}
    </button>
  );
}

function PortraitPictureOption({ actor, asset, selected, disabled, onSelect }: {
  actor: RealPortraitActor;
  asset: RealPortraitAsset;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const label = `图片${asset.kind === 'primary' ? 1 : 2}`;
  return (
    <button type="button" role="option" aria-selected={selected} aria-label={`${actor.alias} ${label}`}
      disabled={disabled} onClick={onSelect} title={`${actor.alias} · ${label}`}
      className="w-12 shrink-0 rounded-lg text-xs text-gray-300 outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-40">
      <span className={`relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border-2 bg-white/5 transition-colors ${selected ? 'border-violet-400' : 'border-white/10 hover:border-violet-300/60'}`}>
        {asset.thumbnailAvailable && !failed ? (
          <img alt="" className="h-full w-full object-cover" onError={() => setFailed(true)}
            src={getApiUrl(`/api/real-portrait-actors/${actor.id}/assets/${asset.id}/thumbnail`)} />
        ) : <UserRoundCheck aria-hidden="true" className="h-5 w-5 text-gray-500" />}
        {selected && <Check aria-hidden="true" className="absolute bottom-0 right-0 h-4 w-4 rounded-tl bg-violet-500 p-0.5 text-white" />}
      </span>
      <span className="mt-1 block">{label}</span>
    </button>
  );
}
