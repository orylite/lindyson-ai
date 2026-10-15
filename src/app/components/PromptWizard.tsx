import type {
  AIStudioVideoDraft,
  TkPromptCreativeInput,
  TkPromptEvidenceProfile,
  TkPromptEvidenceReview,
  TkPromptGeneration,
  TkPromptLanguage,
  TkPromptOption,
  TkPromptPlanSlot,
  TkPromptRun,
  TkPromptSource,
  TkPromptVideoConfig,
} from '@lindyson/api-contracts';
import {
  AlertTriangle,
  Check,
  Film,
  Info,
  Loader2,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { createTkPromptGeneration, createTkPromptRun } from '../api/mutations';
import { getTkPromptGeneration, getTkPromptRun, resumeTkPromptEngine } from '../api/queries';
import {
  IdempotencyKeyRegistry,
  runIdempotentMutation,
} from '../api/idempotency';
import type { AssetReferenceAsset } from '../data/assets';
import {
  getVideoConsumptionCredits,
  isTkPromptEngineAvailable,
  type ConsumptionSettings,
} from '../data/consumption';
import { Select } from '../ui';

export interface TkPromptApplyDraft extends AIStudioVideoDraft {
  source: TkPromptSource;
}

interface Props {
  images: AssetReferenceAsset[];
  initialConfig: TkPromptVideoConfig;
  hasReferenceVideo: boolean;
  consumptionSettings: ConsumptionSettings;
  availableCredits: number;
  onPickImages: () => void;
  onRemoveImage: (assetId: string) => void;
  onConsumptionSettingsRefresh: () => Promise<ConsumptionSettings>;
  onCreditsChanged: () => Promise<void>;
  onClose: () => void;
  onApply: (draft: TkPromptApplyDraft) => void;
}

type WizardStep = 1 | 2 | 3;
type GenerationIntent = 'initial' | 'refresh';
type AppearanceChoice = TkPromptCreativeInput['appearance'];

export function buildEmptyTkPromptProductState() {
  return {
    productName: '',
    category: '',
    acceptedFactIds: new Set<string>(),
    userFacts: '',
    forbiddenClaims: '',
    targetAudience: '',
    verifiedOffer: '',
    appearance: { mode: 'auto' as const },
    selectedSlot: 'safe' as const,
  };
}

export const TK_PROMPT_LANGUAGES = [
  '英语', '西班牙语', '葡萄牙语', '法语', '印尼语',
  '意大利语', '日语', '马来语', '泰语', '越南语',
  '普通话', '德语', '荷兰语', '波兰语',
] as const;

export const TK_PROMPT_MARKET_OPTIONS = [
  ['美国', '美国'], ['英国', '英国'],
  ['西班牙', '西班牙'], ['墨西哥', '墨西哥'], ['葡萄牙', '葡萄牙'], ['巴西', '巴西'],
  ['法国', '法国'], ['印度尼西亚', '印度尼西亚'], ['意大利', '意大利'],
  ['日本', '日本'], ['马来西亚', '马来西亚'], ['泰国', '泰国'],
  ['越南', '越南'], ['德国', '德国'],
  ['荷兰', '荷兰'], ['波兰', '波兰'], ['中国大陆', '中国大陆'],
] as const;

const TK_PROMPT_ENUM_LABELS: Readonly<Record<string, string>> = {
  drama: '剧情',
  product: '商品展示',
  presenter: '人物讲解',
  scene: '场景演示',
  reversal: '反转',
  interview: '访谈',
  story: '故事',
  unboxing: '开箱',
  product_pov: '商品视角',
  comparison: '对比',
  talking_head: '人物口播',
  pain_point: '痛点切入',
  product_closeup: '商品特写',
  scene_demo: '真实场景演示',
  live_presenter: '人物出镜',
  visual_shock: '视觉中断',
  sound_hook: '声音触发',
  pain_strike: '痛点直击',
  identity: '身份点名',
  suspense_question: '悬念提问',
  unexpected: '意外开场',
  contrast: '可见反差',
  before_after: '前后对照',
  elimination_haul: '真实淘汰清单',
  number_benefit: '数字利益',
  cost_math: '成本换算',
  challenge_doubt: '挑战疑问',
  honest_flaw: '真实缺点',
  comment_reply: '真实评论回复',
  hype_confirm: '热度验证',
  confession: '真实坦白',
};

const STEPS = ['确认商品事实', '设置市场与创作条件', '三个提示词方案'] as const;
const SLOT_ORDER: TkPromptPlanSlot[] = ['safe', 'native', 'creative'];
const SLOT_META: Record<TkPromptPlanSlot, {
  label: string;
  eyebrow: string;
  description: string;
  accent: string;
}> = {
  safe: {
    label: '最稳', eyebrow: '方案 A',
    description: '直接解决痛点，用可见结构或操作过程证明价值。',
    accent: 'border-emerald-400/30 bg-emerald-500/[0.06]',
  },
  native: {
    label: '最原生', eyebrow: '方案 B',
    description: '贴近真实 TikTok 内容，用场景、POV 或教程降低广告感。',
    accent: 'border-blue-400/30 bg-blue-500/[0.06]',
  },
  creative: {
    label: '最抓眼', eyebrow: '方案 C',
    description: '通过悬念、声音或结构揭秘制造更强的开场注意力。',
    accent: 'border-pink-400/30 bg-pink-500/[0.06]',
  },
};

const LANGUAGE_OPTIONS = TK_PROMPT_LANGUAGES.map(language => ({ value: language, label: language }));
const TARGET_MARKET_OPTIONS = TK_PROMPT_MARKET_OPTIONS.map(([value, label]) => ({ value, label }));
const PROMPT_WIZARD_SCROLL_LOCK_CLASS = 'prompt-wizard-scroll-locked';
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function getTkPromptAudioMode(durationSeconds: TkPromptVideoConfig['durationSeconds']) {
  return durationSeconds === 5 ? 'sound-design-only' as const : 'voiceover' as const;
}

type TkPromptGenerationMutationPayload = Omit<
  Parameters<typeof createTkPromptGeneration>[1],
  'idempotencyKey'
>;

/**
 * 网络中断可能发生在服务端提交之后。同一组图片的显式重试必须沿用原键，
 * 否则会创建第二个事实分析 run，并重复触发 Provider。
 */
export function createTkPromptRunIdempotently(
  registry: IdempotencyKeyRegistry,
  imageAssetIds: string[],
  execute: typeof createTkPromptRun = createTkPromptRun,
) {
  return runIdempotentMutation(
    registry,
    `tk-prompt-run:${imageAssetIds.join('|')}`,
    'tk-prompt-run',
    idempotencyKey => execute({ idempotencyKey, imageAssetIds }),
  );
}

/**
 * generation intent 绑定发起时的来源批次。响应不确定时复用同一键；上一批
 * 已明确完成并成为新的来源批次后，下一次“换一批”自然获得新键。
 */
export function createTkPromptGenerationIdempotently(input: {
  registry: IdempotencyKeyRegistry;
  runId: string;
  intent: GenerationIntent;
  sourceGenerationId: string | null;
  payload: TkPromptGenerationMutationPayload;
  execute?: typeof createTkPromptGeneration;
}) {
  const execute = input.execute ?? createTkPromptGeneration;
  return runIdempotentMutation(
    input.registry,
    `tk-prompt-generation:${input.runId}:${input.intent}:${input.sourceGenerationId ?? 'none'}`,
    'tk-prompt-generation',
    idempotencyKey => execute(input.runId, { ...input.payload, idempotencyKey }),
  );
}

export function sortTkPromptOptions(options: TkPromptOption[]) {
  return [...options].sort((left, right) => SLOT_ORDER.indexOf(left.slot) - SLOT_ORDER.indexOf(right.slot));
}

export function isTkPromptGenerationComplete(generation: TkPromptGeneration | null | undefined) {
  if (generation?.status !== 'completed' || generation.options.length !== 3) return false;
  return SLOT_ORDER.every(slot => generation.options.some(option => (
    option.slot === slot && option.status === 'completed' && option.plan !== null
  )));
}

export function buildTkPromptCreativeInput(input: {
  durationSeconds: TkPromptVideoConfig['durationSeconds'];
  targetMarket: string;
  targetAudience: string;
  spokenLanguage: TkPromptLanguage;
  verifiedOffer: string;
  appearance: AppearanceChoice;
  availableScenes: string[];
  availableAssets: string[];
}): TkPromptCreativeInput {
  return {
    targetMarket: input.targetMarket.trim(),
    targetAudience: input.targetAudience.trim(),
    ...(input.durationSeconds === 5 ? {} : { spokenLanguage: input.spokenLanguage }),
    verifiedOffer: input.durationSeconds === 5 ? '' : input.verifiedOffer.trim(),
    appearance: { mode: input.appearance.mode },
    availableScenes: uniqueNonempty(input.availableScenes).slice(0, 20),
    availableAssets: uniqueNonempty(input.availableAssets).slice(0, 30),
  };
}

export function buildTkPromptSource(runId: string, generationId: string, optionId: string): TkPromptSource {
  return { runId, generationId, optionId, schemaVersion: 1, editBucket: 'none' };
}

export function getPromptEditBucket(original: string, edited: string): 'none' | 'minor' | 'material' {
  const left = original.trim().replace(/\s+/gu, ' ');
  const right = edited.trim().replace(/\s+/gu, ' ');
  if (left === right) return 'none';
  let prefixLength = 0;
  const sharedLength = Math.min(left.length, right.length);
  while (prefixLength < sharedLength && left[prefixLength] === right[prefixLength]) prefixLength += 1;
  let suffixLength = 0;
  while (
    suffixLength < sharedLength - prefixLength
    && left[left.length - 1 - suffixLength] === right[right.length - 1 - suffixLength]
  ) suffixLength += 1;
  const changedSpan = Math.max(left.length, right.length) - prefixLength - suffixLength;
  return changedSpan / Math.max(1, left.length) <= 0.12 ? 'minor' : 'material';
}

export function tkPromptVideoConfigEquals(
  left: TkPromptVideoConfig | null | undefined,
  right: TkPromptVideoConfig | null | undefined,
) {
  return Boolean(
    left && right
    && left.model === right.model
    && left.aspectRatio === right.aspectRatio
    && left.resolution === right.resolution
    && left.durationSeconds === right.durationSeconds,
  );
}

/**
 * 恢复必须以已持久化 generation 为准，不能用 AI Studio 当前控件覆盖。
 * 保持为纯函数，便于对 resume/apply 的同一快照做合同测试。
 */
export function buildTkPromptGenerationRestoreSnapshot(
  generation: TkPromptGeneration,
  profile: TkPromptEvidenceProfile,
) {
  const review = generation.evidenceReview;
  const creative = generation.creativeInput;
  const rejected = new Set(review.rejectedVisibleFactIds);
  const restoredSpokenLanguage = creative.spokenLanguage ?? '英语';
  return {
    productName: review.productName,
    category: review.category,
    acceptedFactIds: profile.visibleFacts
      .filter(fact => !rejected.has(fact.factId))
      .map(fact => fact.factId),
    userFacts: review.userConfirmedFacts.map(fact => fact.text).join('\n'),
    forbiddenClaims: review.forbiddenClaims.join('\n'),
    targetMarket: creative.targetMarket,
    targetAudience: creative.targetAudience,
    spokenLanguage: restoredSpokenLanguage,
    verifiedOffer: creative.verifiedOffer,
    appearance: creative.appearance,
    videoConfig: generation.videoConfig,
  };
}

export function resolveTkPromptGenerationSnapshots(input: {
  intent: GenerationIntent;
  generation: TkPromptGeneration | null;
  evidenceReview: TkPromptEvidenceReview;
  creativeInput: TkPromptCreativeInput;
  videoConfig: TkPromptVideoConfig;
}) {
  return {
    evidenceReview: input.evidenceReview,
    creativeInput: input.creativeInput,
    videoConfig: input.videoConfig,
  };
}

export function lockPromptWizardDocumentScroll(targetDocument: Document) {
  const { body, documentElement } = targetDocument;
  const targetWindow = targetDocument.defaultView;
  if (!body || !documentElement || !targetWindow) return () => undefined;
  const previous = {
    bodyOverflow: body.style.overflow,
    bodyOverscroll: body.style.overscrollBehavior,
    bodyPaddingRight: body.style.paddingRight,
    rootOverflow: documentElement.style.overflow,
    rootOverscroll: documentElement.style.overscrollBehavior,
  };
  const scrollX = targetWindow.scrollX;
  const scrollY = targetWindow.scrollY;
  const scrollbarWidth = Math.max(0, targetWindow.innerWidth - documentElement.clientWidth);
  if (scrollbarWidth > 0) {
    const padding = Number.parseFloat(targetWindow.getComputedStyle(body).paddingRight) || 0;
    body.style.paddingRight = `${padding + scrollbarWidth}px`;
  }
  body.style.overflow = 'hidden';
  body.style.overscrollBehavior = 'none';
  documentElement.style.overflow = 'hidden';
  documentElement.style.overscrollBehavior = 'none';
  body.classList.add(PROMPT_WIZARD_SCROLL_LOCK_CLASS);
  documentElement.classList.add(PROMPT_WIZARD_SCROLL_LOCK_CLASS);
  return () => {
    body.classList.remove(PROMPT_WIZARD_SCROLL_LOCK_CLASS);
    documentElement.classList.remove(PROMPT_WIZARD_SCROLL_LOCK_CLASS);
    body.style.overflow = previous.bodyOverflow;
    body.style.overscrollBehavior = previous.bodyOverscroll;
    body.style.paddingRight = previous.bodyPaddingRight;
    documentElement.style.overflow = previous.rootOverflow;
    documentElement.style.overscrollBehavior = previous.rootOverscroll;
    if (targetWindow.scrollX !== scrollX || targetWindow.scrollY !== scrollY) targetWindow.scrollTo(scrollX, scrollY);
  };
}

function uniqueNonempty(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function lines(value: string) {
  return uniqueNonempty(value.split(/\r?\n/u));
}

function wait(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function formatTkPromptFailureReason(reason: string | null | undefined, fallback: string) {
  const normalized = reason?.trim() ?? '';
  if (!normalized) return fallback;
  const upper = normalized.toUpperCase();
  if (/EAI_AGAIN|ENOTFOUND|DNS|CONNECTION|FETCH FAILED|NETWORK/u.test(upper)) {
    return '提示词服务网络暂时不稳定，请稍后重新生成。';
  }
  if (/TIMEOUT|TIMED OUT|INCOMPLETE_STREAM/u.test(upper)) {
    return '提示词服务响应超时，请稍后重新生成。';
  }
  if (/INVALID_JSON|FACT_ANALYSIS_INVALID|JSON PARSE/u.test(upper)) {
    return '提示词服务返回格式异常，请重新生成。';
  }
  const coded = /^([A-Z][A-Z0-9_]{2,100}):\s*/u.exec(normalized);
  if (!coded) return /[\p{Script=Han}]/u.test(normalized) ? normalized : fallback;
  const code = coded[1]!;
  if (code.includes('LANGUAGE')) return '方案语言未达到中文执行要求，请重新生成。';
  return fallback;
}

function errorMessage(error: unknown, fallback: string) {
  return formatTkPromptFailureReason(
    error instanceof Error && error.message.trim() ? error.message : null,
    fallback,
  );
}

export function tkPromptDisplayLabel(value: string) {
  return TK_PROMPT_ENUM_LABELS[value] ?? value;
}

export function stripTkPromptTimePrefix(value: string | undefined, range: '0-1' | '1-3') {
  const [start, end] = range.split('-');
  return (value ?? '').replace(new RegExp(`^\\s*${start}\\s*(?:[-–—~～至到])\\s*${end}\\s*秒(?:内)?\\s*[:：]?\\s*`), '');
}

function sameSequence(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function getTkPromptGenerationResumeDisposition(
  value: TkPromptGeneration | null | undefined,
) {
  if (!value) return 'none' as const;
  if (isTkPromptGenerationComplete(value)) return 'completed-history' as const;
  if (['queued', 'strategizing', 'expanding'].includes(value.status)) return 'active' as const;
  if (value.status === 'failed') return 'failed-history' as const;
  return 'none' as const;
}

function normalizeInitialConfig(config: TkPromptVideoConfig): TkPromptVideoConfig {
  const next = { ...config, aspectRatio: '9:16' as const };
  return next.resolution === '1080p'
    && (next.model === 'seedance-2.0-fast' || next.model === 'seedance-2.0-mini')
    ? { ...next, resolution: '720p' }
    : next;
}

function validatePromptForApply(prompt: string, imageCount: number) {
  const normalized = prompt.trim();
  if (!normalized) return '提示词不能为空';
  if (normalized.length > 3_800) return '提示词不能超过 3,800 个字符';
  if (/@(?:视频|音频)/u.test(normalized)) return '方案只能引用当前商品图片';
  const starts = normalized.match(/@图片/gu)?.length ?? 0;
  const references = Array.from(normalized.matchAll(/@图片([1-9]\d*)/gu));
  if (starts !== references.length) return '存在无法识别的图片引用，请使用 @图片1 这类格式';
  if (references.some(match => Number(match[1]) > imageCount)) return `提示词只能引用当前的 @图片1 至 @图片${imageCount}`;
  return null;
}

function Field({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return <label className="block">
    <span className="mb-1.5 block text-xs text-gray-400">{label}</span>
    <input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder}
      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-gray-600 focus:border-purple-500/60" />
  </label>;
}

function TextAreaField({ label, value, onChange, placeholder, help }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  help?: string;
}) {
  return <label className="block">
    <span className="mb-1.5 block text-xs text-gray-400">{label}</span>
    <textarea value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} rows={3}
      className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm leading-6 text-white outline-none placeholder:text-gray-600 focus:border-purple-500/60" />
    {help ? <span className="mt-1 block text-[11px] leading-4 text-gray-500">{help}</span> : null}
  </label>;
}

function ProductEvidenceEditor({ profile, productName, category, acceptedFactIds, userFacts, forbiddenClaims,
  onProductName, onCategory, onFactToggle, onUserFacts, onForbiddenClaims }: {
  profile: TkPromptEvidenceProfile;
  productName: string;
  category: string;
  acceptedFactIds: Set<string>;
  userFacts: string;
  forbiddenClaims: string;
  onProductName: (value: string) => void;
  onCategory: (value: string) => void;
  onFactToggle: (factId: string) => void;
  onUserFacts: (value: string) => void;
  onForbiddenClaims: (value: string) => void;
}) {
  return <div className="space-y-5">
    <section className="rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.05] p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-emerald-300"><PackageCheck className="h-4 w-4" />商品事实已识别</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="商品名称" value={productName} onChange={onProductName} />
        <Field label="商品品类" value={category} onChange={onCategory} />
      </div>
      <p className="mt-3 text-[11px] text-gray-500">请取消不准确的事实。只有保留的图片事实和你确认的信息可以进入带货文案。</p>
    </section>
    <section>
      <h4 className="text-sm font-medium text-white">图片可见事实</h4>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {profile.visibleFacts.map(fact => {
          const checked = acceptedFactIds.has(fact.factId);
          return <label key={fact.factId} className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-xs leading-5 ${checked ? 'border-emerald-400/20 bg-emerald-500/[0.04] text-gray-200' : 'border-white/10 bg-black/10 text-gray-500'}`}>
            <input type="checkbox" checked={checked} onChange={() => onFactToggle(fact.factId)} className="mt-1" />
            <span>{fact.text}</span>
          </label>;
        })}
      </div>
    </section>
    {profile.inferredContexts.length > 0 ? <section className="rounded-xl border border-blue-400/15 bg-blue-500/[0.04] p-3">
      <p className="flex items-center gap-2 text-xs font-medium text-blue-200"><Info className="h-4 w-4" />AI推测 · 仅用于选择人群和场景</p>
      <p className="mt-1 text-[11px] text-gray-500">这些内容不会被当作商品功能或效果写入口播。</p>
      <div className="mt-2 flex flex-wrap gap-1.5">{profile.inferredContexts.map(item => <span key={item.contextId} className="rounded-full border border-blue-400/15 px-2 py-1 text-[11px] text-blue-100/80">{item.text}</span>)}</div>
    </section> : null}
    <div className="grid gap-3 sm:grid-cols-2">
      <TextAreaField label="你确认的商品事实（可选）" value={userFacts} onChange={onUserFacts} placeholder="每行一条，例如：容量为 2L" help="价格、规格、认证和功效只有在这里由你确认后才能使用。" />
      <TextAreaField label="禁止出现的说法（可选）" value={forbiddenClaims} onChange={onForbiddenClaims} placeholder="每行一条，例如：不要提医疗功效" />
    </div>
  </div>;
}

function Storyboard({ option, spokenLanguage }: { option: TkPromptOption; spokenLanguage: string }) {
  const plan = option.plan!;
  return <div className="space-y-3">
    {plan.beats.map((beat, index) => <article key={`${beat.startSeconds}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-purple-500/15 px-2.5 py-1 text-[11px] text-purple-200">{beat.startSeconds}–{beat.endSeconds} 秒</span>
        <span className="text-[11px] text-gray-500">镜头 {index + 1}</span>
      </div>
      <div className={`mt-3 grid gap-3 ${plan.audioMode === 'voiceover' ? 'lg:grid-cols-[1.2fr_1fr]' : ''}`}>
        <div className="space-y-1.5 text-xs leading-5 text-gray-300">
          <p><span className="text-gray-500">画面：</span>{beat.environment}，{beat.subject}，{beat.action}</p>
          <p><span className="text-gray-500">镜头：</span>{beat.shotSize} · {beat.cameraMovement}</p>
          <p><span className="text-gray-500">声音：</span>{beat.soundDesign}</p>
        </div>
        {plan.audioMode === 'voiceover' ? <div className="rounded-xl border border-purple-400/15 bg-purple-500/[0.05] p-3">
          <p className="text-[11px] text-purple-300">目标口播 · {spokenLanguage}</p>
          <p className="mt-1 text-sm leading-6 text-white">{beat.voiceoverTarget || '本镜头无口播'}</p>
          {beat.voiceoverZh ? <div className="mt-2 border-t border-white/10 pt-2">
            <p className="text-xs leading-5 text-gray-400">{beat.voiceoverZh}</p>
          </div> : null}
        </div> : null}
      </div>
    </article>)}
  </div>;
}

function PlanDetails({ option, spokenLanguage }: { option: TkPromptOption; spokenLanguage: string }) {
  const plan = option.plan!;
  const strategy = option.strategyBlueprint;
  return <div className="space-y-5 border-t border-white/10 p-4 sm:p-5">
    <section className="grid gap-3 lg:grid-cols-2">
      <article className="rounded-2xl border border-purple-400/15 bg-purple-500/[0.05] p-4">
        <p className="text-[11px] text-purple-300">为什么适合</p><p className="mt-2 text-sm leading-6 text-gray-200">{plan.whyItFits}</p>
      </article>
      <article className="rounded-2xl border border-pink-400/15 bg-pink-500/[0.04] p-4">
        <p className="text-[11px] text-pink-300">黄金三秒</p>
        <p className="mt-2 text-sm font-medium leading-6 text-white">0–1秒：{stripTkPromptTimePrefix(strategy?.firstFrame, '0-1')}</p>
        <p className="mt-1 text-xs leading-5 text-gray-400">1–3秒：{stripTkPromptTimePrefix(strategy?.relevanceBeat, '1-3')}</p>
        <p className="mt-1 text-xs leading-5 text-gray-400">商品连接：{strategy?.productBridge}</p>
      </article>
    </section>
    {strategy ? <section className="flex flex-wrap gap-2 text-[11px]">
      {[strategy.labelZh, strategy.styleForm, strategy.style, strategy.videoMode, strategy.hookPatternId].map(value => <span key={value} className="rounded-full border border-white/10 bg-black/15 px-2.5 py-1 text-gray-400">{tkPromptDisplayLabel(value)}</span>)}
    </section> : null}
    <section>
      <div className="mb-3 flex items-center justify-between"><div><h4 className="text-sm font-medium text-white">{plan.audioMode === 'sound-design-only' ? '镜头与声音设计' : '镜头与口播'}</h4>
        <p className="mt-1 text-[11px] text-gray-500">{plan.audioMode === 'sound-design-only' ? '5秒方案不包含口播或中文翻译。' : '中文翻译仅供审核，不会进入Seedance执行提示词。'}</p></div><Film className="h-5 w-5 text-purple-300" /></div>
      <Storyboard option={option} spokenLanguage={spokenLanguage} />
    </section>
    <section>
      <article className="rounded-xl border border-white/10 bg-black/15 p-3"><p className="text-xs font-medium text-white">制作边界</p><p className="mt-2 text-xs leading-5 text-gray-400">所需素材：{plan.requiredMaterials.join('、') || '现有商品图片'}</p>{plan.warnings.length > 0 ? <p className="mt-1 text-xs leading-5 text-amber-200">注意：{plan.warnings.join('；')}</p> : null}</article>
    </section>
    <details className="rounded-xl border border-white/10 bg-black/15 p-3"><summary className="cursor-pointer text-xs text-gray-300">查看Seedance执行提示词</summary><textarea readOnly value={plan.executionPrompt} rows={8} className="mt-3 w-full resize-none rounded-lg border border-white/10 bg-black/30 p-3 text-xs leading-5 text-gray-400 outline-none" /></details>
  </div>;
}

export function PromptWizard({
  images, initialConfig, hasReferenceVideo, consumptionSettings, availableCredits,
  onPickImages, onRemoveImage, onConsumptionSettingsRefresh, onCreditsChanged, onClose, onApply,
}: Props) {
  const imageIds = useMemo(() => images.map(image => image.id), [images]);
  const imageKey = imageIds.join('|');
  const [step, setStep] = useState<WizardStep>(1);
  const [run, setRun] = useState<TkPromptRun | null>(null);
  const [profile, setProfile] = useState<TkPromptEvidenceProfile | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [productName, setProductName] = useState('');
  const [category, setCategory] = useState('');
  const [acceptedFactIds, setAcceptedFactIds] = useState<Set<string>>(new Set());
  const [userFacts, setUserFacts] = useState('');
  const [forbiddenClaims, setForbiddenClaims] = useState('');
  const [targetMarket, setTargetMarket] = useState('美国');
  const [targetAudience, setTargetAudience] = useState('');
  const [spokenLanguage, setSpokenLanguage] = useState<TkPromptLanguage>('英语');
  const [verifiedOffer, setVerifiedOffer] = useState('');
  const [appearance, setAppearance] = useState<AppearanceChoice>({ mode: 'auto' });
  const [videoConfig, setVideoConfig] = useState<TkPromptVideoConfig>(() => normalizeInitialConfig(initialConfig));
  const [generation, setGeneration] = useState<TkPromptGeneration | null>(null);
  const [sourceGeneration, setSourceGeneration] = useState<TkPromptGeneration | null>(null);
  const [pendingGeneration, setPendingGeneration] = useState<TkPromptGeneration | null>(null);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const scrollRegionRef = useRef<HTMLElement>(null);
  const [selectedSlot, setSelectedSlot] = useState<TkPromptPlanSlot>('safe');
  const initializeTokenRef = useRef(0);
  const generationTokenRef = useRef(0);
  const mutationKeysRef = useRef(new IdempotencyKeyRegistry());

  const resetProductScopedInputs = useCallback(() => {
    const empty = buildEmptyTkPromptProductState();
    setProductName(empty.productName);
    setCategory(empty.category);
    setAcceptedFactIds(empty.acceptedFactIds);
    setUserFacts(empty.userFacts);
    setForbiddenClaims(empty.forbiddenClaims);
    setTargetAudience(empty.targetAudience);
    setVerifiedOffer(empty.verifiedOffer);
    setAppearance(empty.appearance);
    setSelectedSlot(empty.selectedSlot);
  }, []);

  const engineAvailable = isTkPromptEngineAvailable(consumptionSettings.tkPromptEngine);
  const options = isTkPromptGenerationComplete(generation) ? sortTkPromptOptions(generation!.options) : [];
  const selectedOption = options.find(option => option.slot === selectedSlot) ?? options[0] ?? null;
  useBrowserLayoutEffect(() => {
    if (step === 3 && selectedOption) scrollRegionRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [step, generation?.id, selectedOption?.id]);

  const generationCredits = consumptionSettings.tkPromptEngine?.generationCredits ?? 1;
  const hasCompletedGeneration = isTkPromptGenerationComplete(sourceGeneration)
    || isTkPromptGenerationComplete(generation);
  const videoCredits = getVideoConsumptionCredits(consumptionSettings, videoConfig.model, String(videoConfig.durationSeconds) as '5' | '10' | '15', videoConfig.resolution, hasReferenceVideo);
  const configAvailable = consumptionSettings.video.some(setting => (
    setting.available && setting.model === videoConfig.model
    && setting.duration === String(videoConfig.durationSeconds) && setting.resolution === videoConfig.resolution
  ));

  useBrowserLayoutEffect(() => lockPromptWizardDocumentScroll(document), []);

  const hydrateReadyRun = (nextRun: TkPromptRun) => {
    setRun(nextRun);
    if (nextRun.status !== 'ready' || !nextRun.evidenceProfile) return false;
    // ready run 是商品事实的新真源。先清空上一商品的人工确认，再由同一
    // generation 的持久化快照（若存在）在后续 hydrate 中精确回填。
    resetProductScopedInputs();
    const nextProfile = nextRun.evidenceProfile;
    setProfile(nextProfile);
    setProductName(nextProfile.productIdentity.name);
    setCategory(nextProfile.productIdentity.category);
    setAcceptedFactIds(new Set(nextProfile.visibleFacts.map(fact => fact.factId)));
    setForbiddenClaims(nextProfile.forbiddenClaims.join('\n'));
    return true;
  };

  const hydrateGenerationSnapshot = (
    nextGeneration: TkPromptGeneration,
    nextProfile: TkPromptEvidenceProfile,
  ) => {
    const snapshot = buildTkPromptGenerationRestoreSnapshot(nextGeneration, nextProfile);
    setProductName(snapshot.productName);
    setCategory(snapshot.category);
    setAcceptedFactIds(new Set(snapshot.acceptedFactIds));
    setUserFacts(snapshot.userFacts);
    setForbiddenClaims(snapshot.forbiddenClaims);
    setTargetMarket(snapshot.targetMarket);
    setTargetAudience(snapshot.targetAudience);
    setSpokenLanguage(snapshot.spokenLanguage);
    setVerifiedOffer(snapshot.verifiedOffer);
    setVideoConfig(snapshot.videoConfig);
    setAppearance({ mode: snapshot.appearance.mode });
  };

  const pollRun = async (initialRun: TkPromptRun, token: number) => {
    let nextRun = initialRun;
    while (nextRun.status === 'analyzing' && token === initializeTokenRef.current) {
      await wait(700);
      nextRun = await getTkPromptRun(nextRun.id);
      if (token === initializeTokenRef.current) setRun(nextRun);
    }
    if (token !== initializeTokenRef.current) return;
    if (nextRun.status === 'failed') {
      throw new Error(formatTkPromptFailureReason(nextRun.failureReason, '商品事实识别失败，请重试'));
    }
    if (!hydrateReadyRun(nextRun)) throw new Error('商品事实识别结果不完整');
  };

  useEffect(() => {
    const token = ++initializeTokenRef.current;
    const generationToken = ++generationTokenRef.current;
    setStep(1);
    setRun(null);
    setProfile(null);
    setGeneration(null);
    setSourceGeneration(null);
    setPendingGeneration(null);
    setAnalysisBusy(false);
    setGenerationBusy(false);
    setAnalysisError(null);
    setGenerationError(null);
    resetProductScopedInputs();
    setVideoConfig(normalizeInitialConfig(initialConfig));
    if (!engineAvailable || imageIds.length === 0) return;
    setAnalysisBusy(true);
    void (async () => {
      try {
        const snapshot = await resumeTkPromptEngine();
        if (token !== initializeTokenRef.current) return;
        if (snapshot.run && sameSequence(snapshot.run.imageAssetIds, imageIds) && snapshot.run.status !== 'archived') {
          setRun(snapshot.run);
          if (snapshot.run.status === 'analyzing') await pollRun(snapshot.run, token);
          else if (!hydrateReadyRun(snapshot.run)) throw new Error(snapshot.run.failureReason || '商品事实识别失败');
          if (snapshot.generation && snapshot.generation.runId === snapshot.run.id) {
            const nextProfile = snapshot.run.evidenceProfile;
            if (!nextProfile) throw new Error('恢复任务缺少商品事实快照');
            hydrateGenerationSnapshot(snapshot.generation, nextProfile);
            const disposition = getTkPromptGenerationResumeDisposition(snapshot.generation);
            if (disposition === 'completed-history') {
              // 已完成方案只作为事实、创作设置、计费历史和下一次幂等来源。
              // 再次进入同一组图片时不展示旧三案，避免用户误以为重新生成了内容。
              setSourceGeneration(snapshot.generation);
              setGeneration(null);
              setStep(2);
            } else if (disposition === 'active') {
              setSourceGeneration(snapshot.generation);
              setPendingGeneration(snapshot.generation);
              setGenerationBusy(true);
              try {
                await pollGeneration(snapshot.generation, generationToken);
              } catch (error) {
                if (generationToken === generationTokenRef.current) {
                  setGenerationError(errorMessage(error, '三个方案恢复失败，请重试'));
                  setStep(2);
                }
              } finally {
                if (generationToken === generationTokenRef.current) setGenerationBusy(false);
              }
            } else if (disposition === 'failed-history') {
              setSourceGeneration(snapshot.generation);
              setGeneration(null);
              setGenerationError(formatTkPromptFailureReason(
                snapshot.generation.failureReason,
                '上一批三个方案生成失败，请重新生成',
              ));
              setStep(2);
            }
          }
          return;
        }
        const created = await createTkPromptRunIdempotently(
          mutationKeysRef.current,
          imageIds,
        );
        if (token !== initializeTokenRef.current) return;
        setRun(created);
        await pollRun(created, token);
      } catch (error) {
        if (token === initializeTokenRef.current) setAnalysisError(errorMessage(error, '商品事实识别失败，请重试'));
      } finally {
        if (token === initializeTokenRef.current) setAnalysisBusy(false);
      }
    })();
    return () => { initializeTokenRef.current += 1; };
  }, [engineAvailable, imageKey, resetProductScopedInputs]);

  const retryAnalysis = async () => {
    if (imageIds.length === 0 || analysisBusy) return;
    const token = ++initializeTokenRef.current;
    setAnalysisBusy(true);
    setAnalysisError(null);
    try {
      if (run?.status === 'analyzing' && sameSequence(run.imageAssetIds, imageIds)) {
        await pollRun(run, token);
        return;
      }
      resetProductScopedInputs();
      setProfile(null);
      setGeneration(null);
      setSourceGeneration(null);
      setPendingGeneration(null);
      const created = await createTkPromptRunIdempotently(
        mutationKeysRef.current,
        imageIds,
      );
      setRun(created);
      await pollRun(created, token);
    } catch (error) {
      if (token === initializeTokenRef.current) setAnalysisError(errorMessage(error, '商品事实识别失败，请重试'));
    } finally {
      if (token === initializeTokenRef.current) setAnalysisBusy(false);
    }
  };

  const evidenceReview = (): TkPromptEvidenceReview | null => {
    if (!profile || !productName.trim() || !category.trim()) return null;
    const accepted = profile.visibleFacts.filter(fact => acceptedFactIds.has(fact.factId));
    if (accepted.length === 0) return null;
    return {
      productName: productName.trim(),
      category: category.trim(),
      rejectedVisibleFactIds: profile.visibleFacts.filter(fact => !acceptedFactIds.has(fact.factId)).map(fact => fact.factId),
      userConfirmedFacts: lines(userFacts).slice(0, 40).map((text, index) => ({
        factId: `confirmed-${String(index + 1).padStart(3, '0')}`,
        text,
      })),
      forbiddenClaims: lines(forbiddenClaims).slice(0, 40),
    };
  };

  async function pollGeneration(initial: TkPromptGeneration, token: number) {
    let next = initial;
    while (['queued', 'strategizing', 'expanding'].includes(next.status) && token === generationTokenRef.current) {
      await wait(800);
      next = await getTkPromptGeneration(next.id);
      if (token === generationTokenRef.current) setPendingGeneration(next);
    }
    if (token !== generationTokenRef.current) return;
    if (next.status === 'failed') {
      setSourceGeneration(next);
      setPendingGeneration(null);
      throw new Error(formatTkPromptFailureReason(next.failureReason, '三个方案生成失败'));
    }
    if (!isTkPromptGenerationComplete(next)) {
      setPendingGeneration(null);
      throw new Error('三个方案未完整交付，请重试');
    }
    setGeneration(next);
    setSourceGeneration(next);
    setPendingGeneration(null);
    setStep(3);
    await onCreditsChanged();
  }

  const launchGeneration = async (intent: GenerationIntent) => {
    if (!run || generationBusy) return;
    const activePendingGeneration = pendingGeneration?.runId === run.id
      && ['queued', 'strategizing', 'expanding'].includes(pendingGeneration.status)
      ? pendingGeneration
      : null;
    if (activePendingGeneration) {
      const token = ++generationTokenRef.current;
      setGenerationBusy(true);
      setGenerationError(null);
      try {
        await pollGeneration(activePendingGeneration, token);
      } catch (error) {
        if (token === generationTokenRef.current) {
          const message = errorMessage(error, '三个方案恢复失败，请重试');
          setGenerationError(message);
          toast.error(message);
        }
      } finally {
        if (token === generationTokenRef.current) setGenerationBusy(false);
      }
      return;
    }
    const review = intent === 'refresh' && generation
      ? generation.evidenceReview
      : evidenceReview();
    if (!profile || !review || !configAvailable) {
      if (!review) toast.error('请确认商品名称、品类，并至少保留一条图片事实');
      return;
    }
    const token = ++generationTokenRef.current;
    setGenerationBusy(true);
    setGenerationError(null);
    try {
      const fresh = await onConsumptionSettingsRefresh();
      if (!isTkPromptEngineAvailable(fresh.tkPromptEngine)) throw new Error('TK Prompt Engine当前不可用');
      const expectedCredits = fresh.tkPromptEngine?.generationCredits ?? 1;
      const requiresCredits = intent === 'refresh' || hasCompletedGeneration;
      if (requiresCredits && availableCredits < expectedCredits) {
        throw new Error(`积分不足，重新生成需要 ${expectedCredits} 积分`);
      }
      const creativeInput = buildTkPromptCreativeInput({
        durationSeconds: videoConfig.durationSeconds,
        targetMarket,
        targetAudience,
        spokenLanguage,
        verifiedOffer,
        appearance,
        // inferredContexts 是模型的内部策略假设，不是用户已经拥有或确认的拍摄场景。
        // 1.0 尚未提供显式场景素材输入，因此这里必须保持为空，避免假设获得证据资格。
        availableScenes: [],
        availableAssets: [
          ...images.map((_, index) => `产品参考图片${index + 1}`),
          ...profile.availableMaterials,
        ],
      });
      const snapshots = resolveTkPromptGenerationSnapshots({
        intent,
        generation,
        evidenceReview: review,
        creativeInput,
        videoConfig,
      });
      const created = await createTkPromptGenerationIdempotently({
        registry: mutationKeysRef.current,
        runId: run.id,
        intent,
        sourceGenerationId: generation?.id ?? sourceGeneration?.id ?? null,
        payload: {
          expectedGenerationCredits: expectedCredits,
          ...snapshots,
        },
      });
      setPendingGeneration(created);
      await pollGeneration(created, token);
    } catch (error) {
      if (token === generationTokenRef.current) {
        const message = errorMessage(error, '三个方案生成失败，请重试');
        setGenerationError(message);
        toast.error(message);
      }
    } finally {
      if (token === generationTokenRef.current) setGenerationBusy(false);
    }
  };

  const applySelected = () => {
    if (!run || !generation || !selectedOption?.plan || generationBusy) return;
    const validation = validatePromptForApply(selectedOption.plan.executionPrompt, imageIds.length);
    if (validation) return toast.error(validation);
    onApply({
      prompt: selectedOption.plan.executionPrompt,
      videoConfig: generation.videoConfig,
      referenceImageAssetIds: imageIds,
      source: buildTkPromptSource(run.id, generation.id, selectedOption.id),
    });
    toast.success(`已采用「${SLOT_META[selectedOption.slot].label}」方案`);
  };

  const factToggle = (factId: string) => setAcceptedFactIds(current => {
    const next = new Set(current);
    if (next.has(factId)) next.delete(factId); else next.add(factId);
    return next;
  });

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3 sm:p-6" data-testid="prompt-wizard-backdrop">
    <motion.div role="dialog" aria-modal="true" aria-label="TK Prompt Engine 1.0"
      initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 8 }}
      className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#111120] shadow-2xl">
      <header className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-7">
        <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-purple-300">TikTok Shop</p><h2 className="mt-1 text-xl font-semibold text-white">TK Prompt Engine 1.0</h2><p className="mt-1 text-xs text-gray-500">从商品事实出发，生成最稳、最原生、最抓眼三套可执行方案。</p></div>
        <button type="button" onClick={onClose} aria-label="关闭提示词向导" className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button>
      </header>
      <nav className="flex flex-shrink-0 items-center gap-2 overflow-x-auto border-b border-white/10 px-4 py-3 sm:px-7" aria-label="生成步骤">
        {STEPS.map((label, index) => {
          const number = index + 1;
          const active = step === number;
          const completed = step > number;
          return <div key={label} className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs ${active ? 'border-purple-400/40 bg-purple-500/10 text-purple-100' : completed ? 'border-emerald-400/20 text-emerald-300' : 'border-white/10 text-gray-500'}`}><span>{completed ? <Check className="h-3 w-3" /> : number}</span>{label}</div>;
        })}
      </nav>
      {step === 3 && options.length === 3 ? <div role="radiogroup" aria-label="提示词方案" className="grid flex-shrink-0 grid-cols-3 gap-2 border-b border-white/10 bg-[#111120] px-4 py-3 sm:gap-3 sm:px-7">
        {options.map(option => {
          const meta = SLOT_META[option.slot];
          const selected = option.id === selectedOption?.id;
          return <label key={option.id} data-testid={`tk-prompt-plan-${option.slot}`} className="relative min-w-0 cursor-pointer">
            <input type="radio" name="tk-prompt-plan" value={option.slot} aria-label={`${meta.eyebrow} · ${meta.label}`} checked={selected} onChange={() => setSelectedSlot(option.slot)} className="peer sr-only" />
            <div className={`h-full rounded-xl border p-2.5 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-purple-400 sm:p-3 ${selected ? `${meta.accent} ring-1 ring-purple-400/30` : 'border-white/10 bg-white/[0.025] hover:border-white/20'}`}>
              <div className="flex flex-wrap items-center justify-between gap-1 text-xs font-medium sm:text-sm">
                <span className={selected ? 'text-white' : 'text-gray-300'}>{meta.eyebrow} · {meta.label}</span>
                {selected ? <Check aria-hidden="true" className="hidden h-4 w-4 text-purple-300 sm:block" /> : null}
              </div>
              <p title={option.plan!.title} className="mt-2 hidden truncate text-xs text-gray-400 sm:block">{option.plan!.title}</p>
            </div>
          </label>;
        })}
      </div> : null}
      <main ref={scrollRegionRef} data-testid="prompt-wizard-scroll-region" className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        <AnimatePresence mode="wait">
          {step === 1 ? <motion.section key="facts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5 p-4 sm:p-7">
            {images.length === 0 ? <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center"><p className="text-sm text-gray-300">请先选择1–9张商品图片</p><button type="button" onClick={onPickImages} className="mt-4 rounded-xl bg-purple-600 px-4 py-2 text-sm text-white">选择商品图片</button></div>
              : <div className="flex flex-wrap gap-2">{images.map((image, index) => <div key={image.id} className="relative h-20 w-20 overflow-hidden rounded-xl border border-white/10 bg-black/20"><img src={image.thumbnailUrl || image.publicUrl || image.thumbnail} alt={`图片${index + 1}`} className="h-full w-full object-cover" /><button type="button" onClick={() => onRemoveImage(image.id)} aria-label={`删除图片${index + 1}`} className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"><X className="h-3 w-3" /></button></div>)}</div>}
            {analysisBusy ? <div className="flex min-h-60 items-center justify-center gap-2 text-sm text-purple-200"><Loader2 className="h-5 w-5 animate-spin" />正在分析商品事实…</div> : null}
            {analysisError ? <div className="rounded-xl border border-red-400/20 bg-red-500/[0.05] p-4 text-sm text-red-200"><AlertTriangle className="mr-2 inline h-4 w-4" />{analysisError}</div> : null}
            {!analysisBusy && profile ? <ProductEvidenceEditor profile={profile} productName={productName} category={category} acceptedFactIds={acceptedFactIds} userFacts={userFacts} forbiddenClaims={forbiddenClaims} onProductName={setProductName} onCategory={setCategory} onFactToggle={factToggle} onUserFacts={setUserFacts} onForbiddenClaims={setForbiddenClaims} /> : null}
          </motion.section> : null}
          {step === 2 && profile ? <motion.section key="creative-input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6 p-4 sm:p-7">
            <section className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><h3 className="text-sm font-medium text-white">市场与受众</h3><Select label="目标市场" value={targetMarket} options={TARGET_MARKET_OPTIONS} onValueChange={setTargetMarket} size="sm" maxVisibleOptions={8} /><Field label="目标人群（可选）" value={targetAudience} onChange={setTargetAudience} placeholder="例如：首次养猫、居住空间有限的用户" />{videoConfig.durationSeconds === 5 ? <div data-testid="tk-prompt-five-second-no-offer" className="rounded-xl border border-amber-400/15 bg-amber-500/[0.04] px-3 py-2.5"><p className="text-xs font-medium text-amber-100">5秒方案不使用优惠信息</p><p className="mt-1 text-[11px] text-gray-500">切换到5秒时会清空价格、折扣、库存和限时活动。</p></div> : <TextAreaField label="当前真实优惠（可选）" value={verifiedOffer} onChange={setVerifiedOffer} placeholder="例如：店铺当前满30美元减5美元" help="留空时不会生成价格、折扣、库存或限时活动。" />}</div>
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><h3 className="text-sm font-medium text-white">视频参数与声音</h3><div className="grid gap-3 sm:grid-cols-2">
                <Select label="模型" value={videoConfig.model} options={[{ value: 'seedance-2.0', label: 'Seedance 2.0' }, { value: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast' }, { value: 'seedance-2.0-mini', label: 'Seedance 2.0 Mini' }]} onValueChange={value => setVideoConfig(current => normalizeInitialConfig({ ...current, model: value as TkPromptVideoConfig['model'] }))} size="sm" />
                <Select label="时长" value={String(videoConfig.durationSeconds)} options={['5', '10', '15'].map(value => ({ value, label: `${value}秒` }))} onValueChange={value => {
                  const durationSeconds = Number(value) as 5 | 10 | 15;
                  if (durationSeconds === 5) setVerifiedOffer('');
                  setVideoConfig(current => ({ ...current, durationSeconds }));
                }} size="sm" />
                <Select label="分辨率" value={videoConfig.resolution} options={(videoConfig.model === 'seedance-2.0' ? ['480p', '720p', '1080p'] : ['480p', '720p']).map(value => ({ value, label: value }))} onValueChange={value => setVideoConfig(current => ({ ...current, resolution: value as TkPromptVideoConfig['resolution'] }))} size="sm" />
                {getTkPromptAudioMode(videoConfig.durationSeconds) === 'voiceover' ? <Select label="口播语言" value={spokenLanguage} options={LANGUAGE_OPTIONS} onValueChange={value => {
                  const language = value as TkPromptLanguage;
                  setSpokenLanguage(language);
                }} size="sm" maxVisibleOptions={7} /> : <div data-testid="prompt-wizard-sound-design-only" className="flex min-h-16 flex-col justify-center rounded-xl border border-emerald-400/15 bg-emerald-500/[0.04] px-3"><p className="text-xs font-medium text-emerald-200">无口播 · 纯声音设计</p><p className="mt-1 text-[11px] text-gray-500">仅音乐、环境声与商品操作拟音</p></div>}
              </div><p className="text-[11px] text-gray-500">10/15秒使用所选口播语言，5秒仅生成音乐、环境声与拟音。固定9:16全能参考模式；后续视频生成预计 {videoCredits} 积分。</p></div>
            </section>
            <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <div><h3 className="text-sm font-medium text-white">人物与画面方式</h3><p className="mt-1 text-[11px] leading-5 text-gray-500">选择人物出镜时，Seedance会按目标市场与口播语言生成成年虚构非名人，并在单条视频中保持人物身份一致；5秒方案可以出镜，但全程无对白、口播或其他人声。</p></div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{([['auto', 'AI自动选择', '根据商品事实选择最合适的可执行画面'], ['product_closeup', '只拍商品', '商品特写、结构与操作动作'], ['scene_demo', '真实场景演示', '手部、POV与生活场景'], ['live_presenter', '人物出镜', '自动生成符合目标市场与语言的成年虚构非名人']] as const).map(([mode, label, description]) => <button key={mode} type="button" onClick={() => setAppearance({ mode })} className={`rounded-xl border p-3 text-left ${appearance.mode === mode ? 'border-purple-400/50 bg-purple-500/10' : 'border-white/10 bg-black/10 hover:border-white/20'}`}><p className="text-sm text-white">{label}</p><p className="mt-1 text-[11px] leading-4 text-gray-500">{description}</p></button>)}</div>
            </section>
            {generationError ? <div className="rounded-xl border border-red-400/20 bg-red-500/[0.05] p-3 text-sm text-red-200">{generationError}</div> : null}
          </motion.section> : null}
          {step === 3 && options.length === 3 ? <motion.section key="options" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5 p-4 sm:p-7">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-lg font-semibold text-white">三个提示词方案</h3><p className="mt-1 text-sm text-gray-500">三套方案共享同一商品事实，但使用不同Hook、第一画面、证明方式和叙事结构。</p></div><span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">3/3 已完成</span></div>
            {selectedOption ? <article data-testid="tk-prompt-selected-details" aria-label="当前方案详情" className={`overflow-hidden rounded-2xl border ${SLOT_META[selectedOption.slot].accent}`}>
              <div className="p-4 sm:p-5">
                <p className="text-xs text-purple-300">{SLOT_META[selectedOption.slot].eyebrow} · {SLOT_META[selectedOption.slot].label}</p>
                <h4 className="mt-2 text-base font-semibold text-white">{selectedOption.plan!.title}</h4>
                <p className="mt-2 text-xs leading-5 text-gray-400">{SLOT_META[selectedOption.slot].description}</p>
              </div>
              <PlanDetails key={selectedOption.id} option={selectedOption} spokenLanguage={generation?.creativeInput.spokenLanguage ?? spokenLanguage} />
            </article> : null}
            {generationBusy ? <div className="rounded-xl border border-purple-400/20 bg-purple-500/[0.05] p-3 text-sm text-purple-100"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />正在生成新一批，当前三个方案会保留到成功替换。</div> : null}
            {generationError ? <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.05] p-3 text-sm text-amber-200">{generationError} 当前三个方案已保留。</div> : null}
          </motion.section> : null}
        </AnimatePresence>
      </main>
      <footer className="flex min-h-[72px] flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-[#0f0f1e] px-4 py-4 sm:px-7">
        <div className="text-xs text-gray-500">{step === 3 && selectedOption ? <p className="mb-1 font-medium text-purple-200">当前选择：{SLOT_META[selectedOption.slot].eyebrow} · {SLOT_META[selectedOption.slot].label}</p> : null}{step === 1 ? '先确认事实，再由专家角色设计创意' : step === 2 ? hasCompletedGeneration ? `重新生成三个方案需要 ${generationCredits} 积分` : '首次生成免费；换整批按当前积分设置计费' : '采用方案只写回AI Studio，不会立即生成视频'}</div>
        <div data-testid="prompt-wizard-footer-actions" className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {step === 1 && analysisError ? <button type="button" disabled={analysisBusy} onClick={() => void retryAnalysis()} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-gray-200"><RefreshCw className="h-4 w-4" />重新识别</button> : null}
          {step === 1 && profile ? <button type="button" disabled={!evidenceReview()} onClick={() => setStep(2)} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"><ShieldCheck className="h-4 w-4" />确认事实并继续</button> : null}
          {step === 2 ? <><button type="button" disabled={generationBusy} onClick={() => setStep(1)} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-gray-300">返回</button><button type="button" disabled={generationBusy || !configAvailable || !targetMarket.trim()} onClick={() => void launchGeneration('initial')} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{generationBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}{generationBusy ? '生成中…' : hasCompletedGeneration ? `重新生成 · ${generationCredits}积分` : '生成三个方案'}</button></> : null}
          {step === 3 ? <><button type="button" disabled={generationBusy} onClick={() => void launchGeneration('refresh')} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${generationBusy ? 'animate-spin' : ''}`} />换一批 · {generationCredits}积分</button><button type="button" disabled={generationBusy || !selectedOption} onClick={applySelected} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"><Sparkles className="h-4 w-4" />采用此方案</button></> : null}
        </div>
      </footer>
    </motion.div>
  </div>;
}
