import {
  Gauge,
  Layers3,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import type {
  ImageGenerationAspectRatio,
  ImageGenerationOptimizePromptMode,
  ImageGenerationResolution,
} from '../data/admin';
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
import type { AIStudioGenerateStatus } from './AIStudioGenerateFeedback';

type ImageMenuId = 'model' | 'parameters' | 'optimization' | 'quantity';

export interface AIStudioImageControlsProps {
  aspectRatio: ImageGenerationAspectRatio;
  resolution: ImageGenerationResolution;
  optimizePromptMode: ImageGenerationOptimizePromptMode;
  quantity: number;
  totalCredits: number;
  availableCredits: number;
  configAvailable: boolean;
  generateStatus: AIStudioGenerateStatus;
  onAspectRatioChange: (value: ImageGenerationAspectRatio) => void;
  onResolutionChange: (value: ImageGenerationResolution) => void;
  onOptimizePromptModeChange: (value: ImageGenerationOptimizePromptMode) => void;
  onQuantityChange: (value: number) => void;
  onGenerate: () => Promise<boolean>;
  onCreditsRecharge: () => void;
  onMenuOpen?: () => void;
}

const MODEL_NAME = 'Seedream 5.0 Pro';
const ASPECT_RATIOS: ImageGenerationAspectRatio[] = [
  '1:1',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '3:2',
  '2:3',
  '21:9',
];
const RESOLUTIONS: ImageGenerationResolution[] = ['1K', '2K'];
const OPTIMIZATION_MODES: Array<{
  value: ImageGenerationOptimizePromptMode;
  label: string;
  description: string;
}> = [
  { value: 'standard', label: '标准', description: '兼顾提示词理解与生成质量' },
  { value: 'fast', label: '极速', description: '更快完成提示词优化' },
];
const QUANTITIES = [1, 2, 3, 4];
const MENU_WIDTHS: Record<ImageMenuId, number> = {
  model: 360,
  parameters: 360,
  optimization: 300,
  quantity: 180,
};
const MENU_HEIGHT_ESTIMATES: Record<ImageMenuId, number> = {
  model: 132,
  parameters: 430,
  optimization: 188,
  quantity: 238,
};

export function AIStudioImageControls({
  aspectRatio,
  resolution,
  optimizePromptMode,
  quantity,
  totalCredits,
  availableCredits,
  configAvailable,
  generateStatus,
  onAspectRatioChange,
  onResolutionChange,
  onOptimizePromptModeChange,
  onQuantityChange,
  onGenerate,
  onCreditsRecharge,
  onMenuOpen,
}: AIStudioImageControlsProps) {
  const contentKey = [aspectRatio, resolution, optimizePromptMode, quantity].join('::');
  const {
    closeMenu,
    menuPosition,
    openMenu,
    panelRef,
    setTriggerRef,
    toggleMenu,
  } = useAIStudioCompactMenus<ImageMenuId>({
    widths: MENU_WIDTHS,
    heightEstimates: MENU_HEIGHT_ESTIMATES,
    contentKey,
    onMenuOpen,
  });
  const creditDeficit = Math.max(0, totalCredits - availableCredits);
  const insufficientCredits = configAvailable && totalCredits > 0 && creditDeficit > 0;
  const generateDisabled = generateStatus !== 'idle' || !configAvailable || totalCredits <= 0 || insufficientCredits;
  const generateLabel = generateStatus === 'queued'
    ? '已加入队列 ✓'
    : generateStatus === 'submitting'
      ? '提交中...'
      : !configAvailable || totalCredits <= 0
        ? '当前组合暂不可用'
        : insufficientCredits
          ? `积分不足 · 还差 ${creditDeficit}`
          : `生成图片 · ${totalCredits} 积分`;
  const optimizationLabel = optimizePromptMode === 'standard' ? '标准' : '极速';

  const selectAndClose = <T,>(onChange: (value: T) => void, value: T) => {
    onChange(value);
    closeMenu(true);
  };

  const menu = openMenu ? (
    <AIStudioCompactMenuPortal
      id={`ai-studio-image-${openMenu}-menu`}
      testId={`ai-studio-image-${openMenu}-menu`}
      dataUi="ai-studio-image-menu"
      panelRef={panelRef}
      position={menuPosition}
      role={openMenu === 'parameters' ? 'dialog' : 'listbox'}
      label={openMenu === 'model' ? 'AI 模型' : openMenu === 'parameters' ? '图片参数' : openMenu === 'optimization' ? '提示词优化' : '生成数量'}
      onKeyDown={openMenu === 'parameters' ? undefined : handleListboxMenuKeyDown}
    >
      {openMenu === 'model' && (
        <div className="space-y-1">
          <AIStudioCompactMenuTitle>选择模型</AIStudioCompactMenuTitle>
          <AIStudioCompactMenuOption
            selected
            label={MODEL_NAME}
            description="文生图、多参考图融合和坐标精准编辑"
            badge="固定模型"
            icon={Sparkles}
            tone="image"
            onClick={() => closeMenu(true)}
          />
        </div>
      )}

      {openMenu === 'parameters' && (
        <div className="space-y-4 p-2">
          <div>
            <p className="text-sm font-semibold text-white">图片参数</p>
            <p className="mt-1 text-xs text-gray-500">设置输出画幅与清晰度</p>
          </div>
          <AIStudioCompactAspectRatioPicker
            value={aspectRatio}
            options={ASPECT_RATIOS.map(value => ({ value, label: value }))}
            tone="image"
            columns={4}
            testIdPrefix="ai-studio-image"
            onChange={onAspectRatioChange}
          />
          <AIStudioCompactParameterGroup label="分辨率" columns={2}>
            {RESOLUTIONS.map(value => (
              <AIStudioCompactParameterOption
                key={value}
                tone="image"
                selected={resolution === value}
                onClick={() => onResolutionChange(value)}
              >
                {value}
              </AIStudioCompactParameterOption>
            ))}
          </AIStudioCompactParameterGroup>
        </div>
      )}

      {openMenu === 'optimization' && (
        <div className="space-y-1">
          <AIStudioCompactMenuTitle>提示词优化</AIStudioCompactMenuTitle>
          {OPTIMIZATION_MODES.map(option => (
            <AIStudioCompactMenuOption
              key={option.value}
              selected={optimizePromptMode === option.value}
              label={option.label}
              description={option.description}
              tone="image"
              onClick={() => selectAndClose(onOptimizePromptModeChange, option.value)}
            />
          ))}
        </div>
      )}

      {openMenu === 'quantity' && (
        <div className="space-y-1">
          <AIStudioCompactMenuTitle>生成数量</AIStudioCompactMenuTitle>
          {QUANTITIES.map(value => (
            <AIStudioCompactMenuOption
              key={value}
              selected={quantity === value}
              label={`${value} 张`}
              tone="image"
              onClick={() => selectAndClose(onQuantityChange, value)}
            />
          ))}
        </div>
      )}
    </AIStudioCompactMenuPortal>
  ) : null;

  return (
    <div className="mt-4 border-t border-white/[0.08] pt-4" data-testid="ai-studio-image-controls">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-1.5">
        <AIStudioCompactTrigger
          idPrefix="ai-studio-image"
          menu="model"
          label="AI 模型"
          value={MODEL_NAME}
          icon={Sparkles}
          tone="image"
          open={openMenu === 'model'}
          onClick={() => toggleMenu('model')}
          setRef={element => setTriggerRef('model', element)}
          className="sm:min-w-[156px]"
        />
        <AIStudioCompactTrigger
          idPrefix="ai-studio-image"
          menu="parameters"
          label="图片参数"
          value={`${aspectRatio} · ${resolution}`}
          icon={SlidersHorizontal}
          popup="dialog"
          tone="image"
          open={openMenu === 'parameters'}
          onClick={() => toggleMenu('parameters')}
          setRef={element => setTriggerRef('parameters', element)}
          className="sm:min-w-[132px]"
        />
        <AIStudioCompactTrigger
          idPrefix="ai-studio-image"
          menu="optimization"
          label="提示词优化"
          value={optimizationLabel}
          icon={Gauge}
          tone="image"
          open={openMenu === 'optimization'}
          onClick={() => toggleMenu('optimization')}
          setRef={element => setTriggerRef('optimization', element)}
          className="sm:min-w-[112px]"
        />
        <AIStudioCompactTrigger
          idPrefix="ai-studio-image"
          menu="quantity"
          label="生成数量"
          value={`${quantity} 张`}
          icon={Layers3}
          tone="image"
          open={openMenu === 'quantity'}
          onClick={() => toggleMenu('quantity')}
          setRef={element => setTriggerRef('quantity', element)}
          className="sm:min-w-[82px]"
        />
        <AIStudioCompactGenerateButton
          tone="image"
          label={generateLabel}
          status={generateStatus}
          disabled={generateDisabled}
          title={insufficientCredits ? `当前还差 ${creditDeficit} 积分` : undefined}
          onClick={() => void onGenerate()}
        />
        {insufficientCredits && (
          <AIStudioCompactRechargeLink tone="image" onClick={onCreditsRecharge} />
        )}
      </div>
      {menu}
    </div>
  );
}
