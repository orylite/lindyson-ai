import { ArrowDown,ArrowUp,AtSign,BookOpen,Image as ImageIcon,Plus,Sparkles,Upload,X } from 'lucide-react';
import { AnimatePresence,motion } from 'motion/react';
import { useEffect,useMemo,useRef,useState,type ChangeEvent,type KeyboardEvent,type MouseEvent } from 'react';
import { toast } from 'sonner';
import type { UploadProgressEvent } from '../api/assetUpload';
import type { ExactCursorPagination as CursorPaginationState,PagePosition } from '../api/cursor';
import type {
  AdminGenerationJob,
  GenerationReserveRequest,
  GenerationReserveResult,
  ImageGenerationAnnotation,
  ImageGenerationAspectRatio,
  ImageGenerationOptimizePromptMode,
  ImageGenerationResolution,
} from '../data/admin';
import type { Asset,AssetFolder,AssetGenerationMeta,AssetReferenceAsset,AssetSource,AssetSummary,ImageAssetGenerationMeta } from '../data/assets';
import { getImageConsumptionCredits,type ConsumptionSettings } from '../data/consumption';
import { buildAIStudioQueueItems,type AIStudioQueueItem } from '../state/aiStudioQueue';
import { AssetThumbnail,Button,Card } from '../ui';
import type { BrowserDownloadResult,DownloadableAsset } from '../utils/assetDownload';
import { AssetPickerModal,getConfirmationViolation,type AssetPickerSelectionRules } from './AssetPickerModal';
import { AssetPreviewModal } from './AssetPreviewModal';
import { AIStudioResults } from './AIStudioResults';
import { ImageAnnotationCanvas,removeAnnotationToken } from './ImageAnnotationCanvas';
import { useAIStudioGenerateFeedback } from './AIStudioGenerateFeedback';
import { AIStudioImageControls } from './AIStudioImageControls';
import {
  AIStudioMentionMenu,
  getMentionMenuHorizontalBounds,
  measureTextareaCaret,
  type MentionMenuGroup,
  type MentionMenuPosition,
} from './AIStudioMentionMenu';
import { SeedreamInteractiveTutorialModal } from './SeedreamInteractiveTutorialModal';

const SEEDREAM_MODEL = 'Seedream 5.0 Pro' as const;
const IMAGE_RATIOS: ImageGenerationAspectRatio[] = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'];
const IMAGE_MENTION_MENU_CARET_GAP = 6;
const SEEDREAM_REFERENCE_SELECTION_RULES: AssetPickerSelectionRules = {
  maxImages: 10,
  maxVideos: 0,
  maxAudios: 0,
  image: {
    supportedExtensions: ['jpeg', 'jpg', 'png', 'webp', 'bmp', 'tif', 'tiff', 'gif', 'heic', 'heif'],
    requireFileSize: true,
    maxSizeBytes: 30 * 1024 * 1024,
    requireDimensions: true,
    minDimensionExclusive: 14,
    maxPixels: 36_000_000,
    minAspectRatio: 1 / 16,
    maxAspectRatio: 16,
  },
};

export interface AIImageStudioProps {
  assets: Asset[];
  folders: AssetFolder[];
  assetSummary: AssetSummary;
  assetPagination?: CursorPaginationState;
  assetPageLoading?: boolean;
  assetPageError?: unknown;
  generationJobs: AdminGenerationJob[];
  generationPagination?: CursorPaginationState;
  generationPageLoading?: boolean;
  reuseDraft?: AssetGenerationMeta | null;
  onReuseDraftConsumed?: () => void;
  onGenerationReserve: (requests: GenerationReserveRequest[]) => Promise<GenerationReserveResult>;
  onAssetsPrepare: () => void;
  onAssetFiltersChange: (filters: { source?: AssetSource; folderId?: string | null; search?: string }) => void;
  onAssetPageNavigate: (position: PagePosition) => void;
  onAssetDetailLoad: (assetId: string) => Promise<Asset>;
  onGenerationPageNavigate: (position: PagePosition) => void;
  onConsumptionSettingsRefresh: () => Promise<ConsumptionSettings>;
  onUploadFile: (file: File, folderId: string | null, onProgress?: (event: UploadProgressEvent) => void) => Promise<Asset>;
  onAssetDownload: (asset: DownloadableAsset) => Promise<BrowserDownloadResult | null>;
  onAssetDelete: (assetId: string) => Promise<void>;
  consumptionSettings: ConsumptionSettings;
  availableCredits: number;
  onCreditsRecharge: () => void;
}

interface ResolvedImageDraft {
  references: AssetReferenceAsset[];
  annotations: ImageGenerationAnnotation[];
  prompt: string;
  unavailableCount: number;
}

interface ImageMentionMenuItem {
  id: string;
  kind: 'reference' | 'annotation';
  token: string;
  label: string;
  description: string;
  searchText: string;
  leading: MentionMenuGroup['options'][number]['leading'];
}

export function reorderImageReferences<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function validateImagePromptAnnotations(prompt: string, annotations: ImageGenerationAnnotation[]) {
  const promptTokens = prompt.match(/@标记\d+/g) ?? [];
  const knownTokens = new Set(annotations.map(annotation => annotation.token));
  const unknownToken = promptTokens.find(token => !knownTokens.has(token as ImageGenerationAnnotation['token']));
  if (unknownToken) return `${unknownToken} 没有对应的画布标记`;
  for (const annotation of annotations) {
    const count = promptTokens.filter(token => token === annotation.token).length;
    if (count !== 1) return `${annotation.token} 必须在提示词中出现且只能出现一次`;
  }
  return null;
}

export function validateImagePromptReferences(
  prompt: string,
  references: readonly Pick<AssetReferenceAsset, 'id'>[],
) {
  const referenceStarts = prompt.match(/@图片/g)?.length ?? 0;
  const referenceTokens = Array.from(prompt.matchAll(/@图片([1-9]\d*)(?!(?:[A-Za-z0-9_]|[.\-+/]\d))/g));
  if (referenceStarts !== referenceTokens.length) {
    return '存在无法识别的图片引用，请使用 @图片1 这类格式';
  }
  const outOfRange = referenceTokens.find(match => Number(match[1]) > references.length);
  if (!outOfRange) return null;
  if (references.length === 0) return '当前没有可引用的参考图片';
  return `提示词只能引用当前的 @图片1 至 @图片${references.length}`;
}

export function validateImagePromptMentions(
  prompt: string,
  annotations: ImageGenerationAnnotation[],
  references: readonly Pick<AssetReferenceAsset, 'id'>[],
) {
  return validateImagePromptReferences(prompt, references)
    ?? validateImagePromptAnnotations(prompt, annotations);
}

export function remapImageReferenceMentions(
  prompt: string,
  previousReferences: readonly Pick<AssetReferenceAsset, 'id'>[],
  nextReferences: readonly Pick<AssetReferenceAsset, 'id'>[],
) {
  const nextIndexByAssetId = new Map(nextReferences.map((reference, index) => [reference.id, index + 1]));
  return prompt
    .replace(/@图片([1-9]\d*)/g, (_token, rawIndex: string) => {
      const previousReference = previousReferences[Number(rawIndex) - 1];
      if (!previousReference) return '';
      const nextIndex = nextIndexByAssetId.get(previousReference.id);
      return nextIndex ? `@图片${nextIndex}` : '';
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([，。！？；：、,.!?;:])/g, '$1')
    .trim();
}

export function syncAnnotationsAfterPromptChange(
  previousPrompt: string,
  nextPrompt: string,
  annotations: ImageGenerationAnnotation[],
) {
  return annotations.filter(annotation => (
    !hasPromptToken(previousPrompt, annotation.token) || hasPromptToken(nextPrompt, annotation.token)
  ));
}

export function insertImageAnnotationToken(
  prompt: string,
  token: ImageGenerationAnnotation['token'],
  triggerIndex: number | null,
  caret: number,
) {
  return insertImagePromptMentionToken(prompt, token, triggerIndex, caret, true);
}

export function insertImagePromptMentionToken(
  prompt: string,
  token: string,
  triggerIndex: number | null,
  caret: number,
  unique = false,
) {
  if (unique && countToken(prompt, token) > 0) {
    return { prompt, caret, inserted: false };
  }
  const start = triggerIndex ?? caret;
  const replaceEnd = triggerIndex === null ? caret : Math.max(caret, start + 1);
  const prefix = start > 0 && !/\s/.test(prompt[start - 1] ?? '') ? ' ' : '';
  const suffix = prompt[replaceEnd] && !/\s/.test(prompt[replaceEnd]) ? ' ' : '';
  const insertedText = `${prefix}${token}${suffix || ' '}`;
  return {
    prompt: `${prompt.slice(0, start)}${insertedText}${prompt.slice(replaceEnd)}`,
    caret: start + insertedText.length,
    inserted: true,
  };
}

export function getImageGenerationCreditSummary(
  settings: ConsumptionSettings,
  resolution: ImageGenerationResolution,
  quantity: number,
) {
  const perImage = getImageConsumptionCredits(settings, resolution);
  return { perImage, total: perImage * quantity };
}

export async function resolveImageGenerationDraft(
  draft: ImageAssetGenerationMeta,
  visibleAssets: Asset[],
  loadAssetDetail: (assetId: string) => Promise<Asset>,
): Promise<ResolvedImageDraft> {
  const source = draft.referenceAssets?.length
    ? draft.referenceAssets.filter(reference => reference.type === 'image')
    : draft.referenceImages.map(reference => ({ ...reference, type: 'image' as const }));
  const visibleById = new Map(visibleAssets.filter(asset => asset.type === 'image').map(asset => [asset.id, asset]));
  const resolved = await Promise.all(source.map(async (reference, index) => {
    const visible = visibleById.get(reference.id);
    if (visible) return { index, reference: assetToImageReference(visible) };
    try {
      const detail = await loadAssetDetail(reference.id);
      if (detail.type !== 'image') throw new Error('参考素材类型不匹配');
      return { index, reference: assetToImageReference(detail) };
    } catch {
      return { index, reference: null };
    }
  }));
  const unavailable = resolved.filter(item => !item.reference);
  const unavailableIds = new Set(unavailable.map(item => source[item.index]?.id).filter(Boolean));
  let prompt = draft.prompt;
  const annotations = (draft.annotations ?? []).filter(annotation => {
    if (!unavailableIds.has(annotation.assetId)) return true;
    prompt = removeAnnotationToken(prompt, annotation.token);
    return false;
  });
  const references = resolved.flatMap(item => item.reference ? [item.reference] : []);
  prompt = remapImageReferenceMentions(prompt, source, references);
  return {
    references,
    annotations,
    prompt,
    unavailableCount: unavailable.length,
  };
}

export function AIImageStudio({
  assets,
  folders,
  assetSummary,
  assetPagination,
  assetPageLoading,
  assetPageError,
  generationJobs,
  generationPagination,
  generationPageLoading,
  reuseDraft,
  onReuseDraftConsumed,
  onGenerationReserve,
  onAssetsPrepare,
  onAssetFiltersChange,
  onAssetPageNavigate,
  onAssetDetailLoad,
  onGenerationPageNavigate,
  onConsumptionSettingsRefresh,
  onUploadFile,
  onAssetDownload,
  onAssetDelete,
  consumptionSettings,
  availableCredits,
  onCreditsRecharge,
}: AIImageStudioProps) {
  const [prompt, setPrompt] = useState('');
  const [references, setReferences] = useState<AssetReferenceAsset[]>([]);
  const [activeReferenceId, setActiveReferenceId] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<ImageGenerationAnnotation[]>([]);
  const [resolution, setResolution] = useState<ImageGenerationResolution>('2K');
  const [aspectRatio, setAspectRatio] = useState<ImageGenerationAspectRatio>('1:1');
  const [optimizePromptMode, setOptimizePromptMode] = useState<ImageGenerationOptimizePromptMode>('standard');
  const [quantity, setQuantity] = useState(1);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tokenMenuIndex, setTokenMenuIndex] = useState<number | null>(null);
  const [tokenMenuQuery, setTokenMenuQuery] = useState('');
  const [tokenMenuActiveIndex, setTokenMenuActiveIndex] = useState(0);
  const [tokenMenuPosition, setTokenMenuPosition] = useState<MentionMenuPosition>({ left: 8, top: 0, width: 320 });
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const {
    status: imageGenerateStatus,
    isLocked: isImageGenerateLocked,
    run: runImageGenerate,
  } = useAIStudioGenerateFeedback();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const referenceSectionRef = useRef<HTMLDivElement>(null);
  const [generationError, setGenerationError] = useState<{ message: string; field: 'prompt' | 'references' | 'submit' } | null>(null);
  const reportGenerationError = (message: string, field: 'prompt' | 'references' | 'submit' = 'submit') => {
    setGenerationError({ message, field });
    if (field === 'prompt') promptRef.current?.focus();
    if (field === 'references') referenceSectionRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  };

  useEffect(() => {
    setGenerationError(current => current?.field === 'references' ? null : current);
  }, [references, annotations]);

  const activeReferenceItemRef = useRef<HTMLDivElement>(null);
  const consumptionRefreshRef = useRef(onConsumptionSettingsRefresh);
  const imageQueue = useMemo(() => buildAIStudioQueueItems(generationJobs, assets, 'image'), [assets, generationJobs]);
  const activeReference = references.find(reference => reference.id === activeReferenceId) ?? references[0] ?? null;
  const { perImage: creditsPerImage, total: totalCredits } = getImageGenerationCreditSummary(
    consumptionSettings,
    resolution,
    quantity,
  );
  const tokenMenuItems = useMemo<ImageMentionMenuItem[]>(() => {
    const query = tokenMenuQuery.trim().toLocaleLowerCase('zh-CN');
    const items: ImageMentionMenuItem[] = [
      ...references.map((reference, index) => ({
        id: `reference-${reference.id}`,
        kind: 'reference' as const,
        token: `@图片${index + 1}`,
        label: `@图片${index + 1}`,
        description: reference.name,
        searchText: `图片${index + 1} ${index + 1} ${reference.name}`.toLocaleLowerCase('zh-CN'),
        leading: (
          <AssetThumbnail
            asset={reference}
            className="h-10 w-10 rounded-lg bg-white/5"
            iconClassName="h-5 w-5 opacity-80"
          />
        ),
      })),
      ...annotations.map(annotation => ({
        id: `annotation-${annotation.token}`,
        kind: 'annotation' as const,
        token: annotation.token,
        label: annotation.token,
        description: annotation.type === 'point' ? '点选标记' : '框选标记',
        searchText: `${annotation.token.slice(1)} ${annotation.type === 'point' ? '点选标记' : '框选标记'}`.toLocaleLowerCase('zh-CN'),
        leading: (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-pink-500/10">
            <AtSign className="h-4 w-4 text-pink-300" />
          </span>
        ),
      })),
    ];
    if (!query) return items;
    return items.filter(item => item.searchText.includes(query) || item.token.toLocaleLowerCase('zh-CN').includes(`@${query}`));
  }, [annotations, references, tokenMenuQuery]);
  const tokenMenuGroups = useMemo<MentionMenuGroup[]>(() => [
    {
      id: 'references',
      label: '参考图片',
      options: tokenMenuItems.filter(item => item.kind === 'reference'),
    },
    {
      id: 'annotations',
      label: '精准标记',
      options: tokenMenuItems.filter(item => item.kind === 'annotation'),
    },
  ], [tokenMenuItems]);

  useEffect(() => {
    consumptionRefreshRef.current = onConsumptionSettingsRefresh;
  }, [onConsumptionSettingsRefresh]);

  useEffect(() => {
    activeReferenceItemRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeReferenceId, references]);

  const applyGenerationDraft = async (draft: ImageAssetGenerationMeta) => {
    const resolved = await resolveImageGenerationDraft(draft, assets, onAssetDetailLoad);
    setPrompt(resolved.prompt);
    setReferences(resolved.references);
    setAnnotations(resolved.annotations);
    setActiveReferenceId(resolved.references[0]?.id ?? null);
    setAspectRatio(IMAGE_RATIOS.includes(draft.ratio as ImageGenerationAspectRatio) ? draft.ratio as ImageGenerationAspectRatio : '1:1');
    setResolution(normalizeImageResolution(draft.resolution ?? draft.outputSize));
    setOptimizePromptMode(draft.optimizePromptMode === 'fast' ? 'fast' : 'standard');
    setTokenMenuIndex(null);
    return resolved.unavailableCount;
  };

  useEffect(() => {
    if (!reuseDraft || reuseDraft.kind !== 'image') return;
    let canceled = false;
    void applyGenerationDraft(reuseDraft)
      .then(unavailableCount => {
        if (canceled) return;
        onReuseDraftConsumed?.();
        if (unavailableCount === 0) toast.success('已载入图片生成参数');
        else toast.warning(`已载入生成参数；${unavailableCount} 张原始参考图已删除或不可访问，相关标记和提示词已移除`);
      })
      .catch(error => {
        if (!canceled) toast.error(error instanceof Error ? error.message : '图片生成参数载入失败');
      });
    return () => { canceled = true; };
  }, [reuseDraft]);

  const handleReferencesConfirm = (selectedAssets: Asset[]) => {
    const nextReferences = selectedAssets.filter(asset => asset.type === 'image').map(assetToImageReference);
    const retainedIds = new Set(nextReferences.map(reference => reference.id));
    const removedIds = new Set(references.filter(reference => !retainedIds.has(reference.id)).map(reference => reference.id));
    const removedTokens = annotations.filter(annotation => removedIds.has(annotation.assetId)).map(annotation => annotation.token);
    setAnnotations(current => current.filter(annotation => !removedIds.has(annotation.assetId)));
    setPrompt(current => remapImageReferenceMentions(
      removedTokens.reduce((next, token) => removeAnnotationToken(next, token), current),
      references,
      nextReferences,
    ));
    setReferences(nextReferences);
    setActiveReferenceId(current => current && retainedIds.has(current) ? current : nextReferences[0]?.id ?? null);
    setAssetPickerOpen(false);
    setTokenMenuIndex(null);
  };

  const removeReference = (event: MouseEvent<HTMLButtonElement>, index: number) => {
    event.stopPropagation();
    const removed = references[index];
    if (!removed) return;
    const removedTokens = annotations.filter(annotation => annotation.assetId === removed.id).map(annotation => annotation.token);
    const nextReferences = references.filter((_, currentIndex) => currentIndex !== index);
    setReferences(nextReferences);
    setAnnotations(current => current.filter(annotation => annotation.assetId !== removed.id));
    setPrompt(current => remapImageReferenceMentions(
      removedTokens.reduce((next, token) => removeAnnotationToken(next, token), current),
      references,
      nextReferences,
    ));
    setActiveReferenceId(current => current === removed.id ? nextReferences[Math.min(index, nextReferences.length - 1)]?.id ?? null : current);
  };

  const moveReference = (event: MouseEvent<HTMLButtonElement>, index: number, direction: -1 | 1) => {
    event.stopPropagation();
    const nextReferences = reorderImageReferences(references, index, direction);
    if (nextReferences === references) return;
    setPrompt(current => remapImageReferenceMentions(current, references, nextReferences));
    setReferences(nextReferences);
  };

  const handleAnnotationsChange = (next: ImageGenerationAnnotation[], removedTokens: string[] = []) => {
    setAnnotations(next);
    if (removedTokens.length > 0) {
      setPrompt(current => removedTokens.reduce((value, token) => removeAnnotationToken(value, token), current));
    }
  };

  const handlePromptChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextPrompt = event.target.value;
    const previousPrompt = prompt;
    setPrompt(nextPrompt);
    setAnnotations(current => syncAnnotationsAfterPromptChange(previousPrompt, nextPrompt, current));
    syncTokenMenu(nextPrompt, getCaret(event.target, nextPrompt));
  };

  const closeTokenMenu = () => {
    setTokenMenuIndex(null);
    setTokenMenuQuery('');
    setTokenMenuActiveIndex(0);
  };

  const syncTokenMenu = (value: string, caret: number, input = promptRef.current) => {
    if (!input || references.length + annotations.length === 0) {
      closeTokenMenu();
      return;
    }
    const beforeCaret = value.slice(0, caret);
    const triggerIndex = beforeCaret.lastIndexOf('@');
    if (triggerIndex < 0 || /\s/.test(beforeCaret.slice(triggerIndex))) {
      closeTokenMenu();
      return;
    }
    const caretPosition = measureTextareaCaret(input, caret);
    const horizontalBounds = getMentionMenuHorizontalBounds(
      caretPosition.left,
      input.getBoundingClientRect().width,
    );
    const belowTop = caretPosition.top + caretPosition.height + IMAGE_MENTION_MENU_CARET_GAP;
    const belowSpace = Math.max(0, input.clientHeight - belowTop - 8);
    const aboveSpace = Math.max(0, caretPosition.top - IMAGE_MENTION_MENU_CARET_GAP - 8);
    const openAbove = belowSpace < 144 && aboveSpace > belowSpace;
    const maxHeight = Math.min(256, openAbove ? aboveSpace : belowSpace);
    setTokenMenuIndex(triggerIndex);
    setTokenMenuQuery(value.slice(triggerIndex + 1, caret));
    setTokenMenuActiveIndex(0);
    setTokenMenuPosition({
      ...horizontalBounds,
      top: openAbove
        ? Math.max(8, caretPosition.top - IMAGE_MENTION_MENU_CARET_GAP - maxHeight)
        : belowTop,
      maxHeight,
    });
  };

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (tokenMenuIndex === null) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeTokenMenu();
      return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && tokenMenuItems.length > 0) {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setTokenMenuActiveIndex(current => (
        current + direction + tokenMenuItems.length
      ) % tokenMenuItems.length);
      return;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && tokenMenuItems.length > 0) {
      event.preventDefault();
      const option = tokenMenuItems[tokenMenuActiveIndex] ?? tokenMenuItems[0];
      if (option) insertPromptToken(option.token);
    }
  };

  const insertPromptToken = (token: string) => {
    const input = promptRef.current;
    const insertion = insertImagePromptMentionToken(
      prompt,
      token,
      tokenMenuIndex,
      input?.selectionStart ?? prompt.length,
      token.startsWith('@标记'),
    );
    if (!insertion.inserted) {
      closeTokenMenu();
      input?.focus();
      return;
    }
    setPrompt(insertion.prompt);
    closeTokenMenu();
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(insertion.caret, insertion.caret);
    });
  };

  useEffect(() => {
    if (tokenMenuIndex === null) return;
    const input = promptRef.current;
    if (!input) return;
    const refreshPosition = () => syncTokenMenu(input.value, getCaret(input), input);
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(refreshPosition);
    resizeObserver?.observe(input);
    window.addEventListener('resize', refreshPosition);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', refreshPosition);
    };
  }, [annotations.length, references.length, tokenMenuIndex]);

  const generateImages = async () => {
    if (isImageGenerateLocked()) return false;
    setGenerationError(null);
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) { reportGenerationError('请输入图片描述', 'prompt'); return false; }
    const mentionError = validateImagePromptMentions(trimmedPrompt, annotations, references);
    if (mentionError) { reportGenerationError(mentionError, 'prompt'); return false; }
    if (annotations.some(annotation => !references.some(reference => reference.id === annotation.assetId))) {
      reportGenerationError('存在未绑定参考图的标记，请删除后重试', 'references');
      return false;
    }
    const referenceViolation = getConfirmationViolation(
      references.map(referenceToPickerAsset),
      SEEDREAM_REFERENCE_SELECTION_RULES,
    );
    if (referenceViolation) { reportGenerationError(referenceViolation, 'references'); return false; }

    return runImageGenerate(async () => {
      try {
        const latestSettings = await consumptionRefreshRef.current();
        const latestCredits = getImageConsumptionCredits(latestSettings, resolution);
        if (latestCredits <= 0) { reportGenerationError(`${resolution} 图片生成当前未开放`); return false; }
        const requestedCredits = latestCredits * quantity;
        if (availableCredits < requestedCredits) { reportGenerationError(`积分不足，本次需要 ${requestedCredits} 积分`); return false; }
        const requests: GenerationReserveRequest[] = Array.from({ length: quantity }, () => ({
          kind: 'image',
          model: SEEDREAM_MODEL,
          prompt: trimmedPrompt,
          config: { resolution, aspectRatio, optimizePromptMode },
          references: references.map(reference => ({ assetId: reference.id, role: 'reference_image' as const })),
          annotations,
        }));
        const result = await onGenerationReserve(requests);
        if (!result.ok) { reportGenerationError(result.message); return false; }
        return true;
      } catch (error) {
        reportGenerationError(error instanceof Error ? error.message : '图片生成任务提交失败');
        return false;
      }
    });
  };

  const openQueuePreview = async (item: AIStudioQueueItem) => {
    if (!item.previewReady || !item.assetId) return;
    try {
      setPreviewAsset(await onAssetDetailLoad(item.assetId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '图片详情加载失败');
    }
  };

  const downloadQueueAsset = async (event: MouseEvent<HTMLButtonElement>, item: AIStudioQueueItem) => {
    event.stopPropagation();
    if (!item.previewReady || !item.assetId) return;
    try {
      await onAssetDownload({ id: item.assetId, name: item.model, type: 'image' });
      toast.success('图片下载已开始');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '图片下载失败');
    }
  };

  const reuseQueueAsset = async (asset: Asset) => {
    if (!asset.generation || asset.generation.kind !== 'image') return;
    try {
      const unavailableCount = await applyGenerationDraft(asset.generation);
      setPreviewAsset(null);
      if (unavailableCount === 0) toast.success('已载入图片生成参数');
      else toast.warning(`已载入生成参数；${unavailableCount} 张原始参考图已删除或不可访问，相关标记和提示词已移除`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '图片生成参数载入失败');
    }
  };

  const pickerInitialAssets = references.map(reference => (
    assets.find(asset => asset.id === reference.id) ?? referenceToPickerAsset(reference)
  ));

  return (
    <div className="min-w-0">
      <div className="space-y-5">
        <motion.div key="image" initial={false} animate={{ opacity: 1 }} className="grid min-w-0 grid-cols-1 gap-5">
          <div className="min-w-0 space-y-4" data-testid="ai-studio-image-composer">
            <section
              aria-labelledby="image-reference-workbench-title"
              className="@container/image-reference-workbench"
              data-testid="image-reference-workbench"
            >
              <Card ref={referenceSectionRef} variant="raised" accent="pink" aria-invalid={generationError?.field === 'references' || undefined}>
                {generationError?.field === 'references' && <p role="alert" className="product-field-error px-5 pt-4">{generationError.message}</p>}
                <header className="flex flex-col gap-3 border-b border-white/10 px-4 py-4 sm:px-5 @min-[740px]/image-reference-workbench:flex-row @min-[740px]/image-reference-workbench:items-center @min-[740px]/image-reference-workbench:justify-between">
                  <div className="min-w-0">
                    <h2 id="image-reference-workbench-title" className="flex items-center gap-2 text-sm font-semibold text-white">
                      <Upload className="h-4 w-4 shrink-0 text-pink-400" />
                      参考与标记
                    </h2>
                    <p className="mt-1 min-w-0 text-xs text-gray-500">
                      <span className="block" data-testid="image-reference-summary">参考图片 {references.length}/10，顺序对应 @图片1～@图片10</span>
                      {activeReference && (
                        <span className="mt-1 block max-w-full truncate" data-testid="image-active-reference" title={activeReference.name}>
                          当前：图{references.findIndex(reference => reference.id === activeReference.id) + 1} · {activeReference.name}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="grid w-full shrink-0 grid-cols-2 gap-2 @min-[740px]/image-reference-workbench:w-auto">
                    <Button className="min-w-0" type="button" size="sm" variant="secondary" icon={<BookOpen className="h-3.5 w-3.5" />} onClick={() => setTutorialOpen(true)}>交互编辑教程</Button>
                    <Button className="min-w-0" type="button" size="sm" variant="pink" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAssetPickerOpen(true)}>选择图片</Button>
                  </div>
                </header>

                {references.length === 0 ? (
                  <div className="p-3 sm:p-4">
                    <button type="button" className="flex w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.025] py-8 text-gray-500 transition-colors hover:border-pink-400/40 hover:text-pink-200" onClick={() => setAssetPickerOpen(true)}>
                      <ImageIcon className="mb-2 h-7 w-7" /><span className="text-sm">不选择参考图即为文生图</span>
                    </button>
                  </div>
                ) : (
                  <div className="grid min-w-0 gap-3 p-3 @min-[740px]/image-reference-workbench:grid-cols-[208px_minmax(0,1fr)]">
                    <section aria-labelledby="image-reference-list-title" className="min-w-0 rounded-xl border border-white/10 bg-black/10 @min-[740px]/image-reference-workbench:h-[536px]">
                      <h3 id="image-reference-list-title" className="sr-only">参考图片列表</h3>
                      <div
                        role="list"
                        aria-label="参考图片列表"
                        data-testid="image-reference-list"
                        className="flex min-w-0 gap-2 overflow-x-auto p-2 @min-[740px]/image-reference-workbench:h-full @min-[740px]/image-reference-workbench:flex-col @min-[740px]/image-reference-workbench:overflow-x-hidden @min-[740px]/image-reference-workbench:overflow-y-auto"
                      >
                        {references.map((reference, index) => {
                          const active = activeReference?.id === reference.id;
                          return (
                            <div
                              key={reference.id}
                              ref={active ? activeReferenceItemRef : undefined}
                              role="listitem"
                              className={`group flex w-[248px] shrink-0 items-center gap-2 rounded-xl border p-2 transition-colors @min-[740px]/image-reference-workbench:w-full ${active ? 'border-pink-400/50 bg-pink-500/10' : 'border-white/10 bg-white/5 hover:border-white/20'}`}
                            >
                              <button
                                type="button"
                                aria-label={`选择图${index + 1}：${reference.name}`}
                                aria-pressed={active}
                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                onClick={() => setActiveReferenceId(reference.id)}
                              >
                                <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-black/30"><AssetThumbnail asset={reference} /></span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-xs font-semibold text-pink-300">图{index + 1}</span>
                                  <span className="block truncate text-xs text-gray-300" title={reference.name}>{reference.name}</span>
                                </span>
                              </button>
                              <div className="flex shrink-0 flex-col gap-1">
                                <button type="button" aria-label={`将图${index + 1}前移`} disabled={index === 0} className={REFERENCE_ORDER_BUTTON_CLASS} onClick={event => moveReference(event, index, -1)}><ArrowUp className="h-3 w-3" /></button>
                                <button type="button" aria-label={`将图${index + 1}后移`} disabled={index === references.length - 1} className={REFERENCE_ORDER_BUTTON_CLASS} onClick={event => moveReference(event, index, 1)}><ArrowDown className="h-3 w-3" /></button>
                              </div>
                              <button type="button" aria-label={`移除图${index + 1}`} className="rounded-lg p-1.5 text-gray-500 hover:bg-red-500/15 hover:text-red-300" onClick={event => removeReference(event, index)}><X className="h-3.5 w-3.5" /></button>
                            </div>
                          );
                        })}
                      </div>
                    </section>

                    <section
                      aria-labelledby="image-annotation-workspace-title"
                      className="min-w-0"
                      data-testid="image-annotation-workspace"
                    >
                      <h3 id="image-annotation-workspace-title" className="sr-only">交互编辑画布</h3>
                      <ImageAnnotationCanvas asset={activeReference} annotations={annotations} onChange={handleAnnotationsChange} onInsertToken={insertPromptToken} />
                    </section>
                  </div>
                )}
              </Card>
            </section>

            <Card variant="raised" className="relative p-5" style={{ overflow: 'visible' }}>
              <div className="mb-3 flex items-center justify-between gap-3"><label htmlFor="image-prompt" className="flex items-center gap-2 text-sm text-white"><Sparkles className="h-4 w-4 text-pink-400" />图片描述</label><span className="text-xs text-gray-600">{prompt.length}/4000</span></div>
              <div className="relative">
                <textarea
                  id="image-prompt"
                  ref={promptRef}
                  aria-invalid={generationError?.field === 'prompt' || undefined}
                  aria-describedby={generationError?.field === 'prompt' ? 'image-prompt-error' : undefined}
                  value={prompt}
                  maxLength={4000}
                  rows={8}
                  className="w-full resize-y rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-6 text-white outline-none transition-colors placeholder:text-gray-600 focus:border-pink-500/50"
                  placeholder="描述主体、动作、环境、风格和编辑意图；输入 @ 可引用参考图片和画布标记"
                  onChange={event => { setGenerationError(current => current?.field === 'prompt' ? null : current); handlePromptChange(event); }}
                  onKeyDown={handlePromptKeyDown}
                  onKeyUp={event => !['Escape', 'ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key) && syncTokenMenu(event.currentTarget.value, getCaret(event.currentTarget), event.currentTarget)}
                  onClick={event => syncTokenMenu(event.currentTarget.value, getCaret(event.currentTarget), event.currentTarget)}
                  onFocus={event => syncTokenMenu(event.currentTarget.value, getCaret(event.currentTarget), event.currentTarget)}
                  onSelect={event => syncTokenMenu(event.currentTarget.value, getCaret(event.currentTarget), event.currentTarget)}
                  onScroll={event => syncTokenMenu(event.currentTarget.value, getCaret(event.currentTarget), event.currentTarget)}
                  onBlur={closeTokenMenu}
                />
                <AnimatePresence>
                  {tokenMenuIndex !== null && references.length + annotations.length > 0 && (
                    <AIStudioMentionMenu
                      groups={tokenMenuGroups}
                      activeIndex={tokenMenuActiveIndex}
                      position={tokenMenuPosition}
                      accent="pink"
                      testId="image-mention-menu"
                      ariaLabel="插入参考图片或精准标记"
                      onActiveIndexChange={setTokenMenuActiveIndex}
                      onSelect={(activeIndex) => {
                        const option = tokenMenuItems[activeIndex];
                        if (option) insertPromptToken(option.token);
                      }}
                    />
                  )}
                </AnimatePresence>
              </div>
              {generationError && generationError.field !== 'references' && <p id="image-prompt-error" role="alert" className="product-field-error mt-3">{generationError.message}</p>}
                  <AIStudioImageControls
                aspectRatio={aspectRatio}
                resolution={resolution}
                optimizePromptMode={optimizePromptMode}
                quantity={quantity}
                totalCredits={totalCredits}
                availableCredits={availableCredits}
                configAvailable={creditsPerImage > 0}
                generateStatus={imageGenerateStatus}
                onAspectRatioChange={setAspectRatio}
                onResolutionChange={setResolution}
                onOptimizePromptModeChange={setOptimizePromptMode}
                onQuantityChange={setQuantity}
                onGenerate={generateImages}
                onCreditsRecharge={onCreditsRecharge}
                onMenuOpen={closeTokenMenu}
              />
            </Card>
          </div>

          <AIStudioResults kind="image" items={imageQueue} pagination={generationPagination} loading={generationPageLoading} onNavigate={onGenerationPageNavigate} onPreview={openQueuePreview} onDownload={downloadQueueAsset} />
        </motion.div>
      </div>

      <AnimatePresence>
        {assetPickerOpen && (
          <AssetPickerModal
            assets={assets}
            folders={folders}
            assetSummary={assetSummary}
            pagination={assetPagination}
            pageLoading={assetPageLoading}
            pageError={assetPageError}
            defaultCategory="uploaded-image"
            mode="multi"
            accept="image"
            showAllCategory={false}
            enableFolders
            initialSelectedAssets={pickerInitialAssets}
            selectionRules={SEEDREAM_REFERENCE_SELECTION_RULES}
            uploadAccept="image"
            onUploadFile={onUploadFile}
            onAssetsPrepare={onAssetsPrepare}
            onAssetFiltersChange={onAssetFiltersChange}
            onAssetPageNavigate={onAssetPageNavigate}
            onAssetDetailLoad={onAssetDetailLoad}
            onAssetDelete={onAssetDelete}
            onClose={() => setAssetPickerOpen(false)}
            onConfirm={handleReferencesConfirm}
          />
        )}
        {previewAsset && (
          <AssetPreviewModal key={`image-queue-preview-${previewAsset.id}`} asset={previewAsset} mode="readonly" rootFolderId={previewAsset.folderId} onClose={() => setPreviewAsset(null)} onDownload={onAssetDownload} onReuseGenerate={asset => void reuseQueueAsset(asset)} />
        )}
        {tutorialOpen && <SeedreamInteractiveTutorialModal onClose={() => setTutorialOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}

function assetToImageReference(asset: Asset): AssetReferenceAsset {
  return { id: asset.id, name: asset.name, type: 'image', thumbnail: asset.thumbnail, publicUrl: asset.publicUrl, thumbnailUrl: asset.thumbnailUrl, sizeBytes: asset.sizeBytes, width: asset.width, height: asset.height, mediaExtension: asset.mediaExtension };
}

function referenceToPickerAsset(reference: AssetReferenceAsset): Asset {
  return { id: reference.id, name: reference.name, type: 'image', source: 'uploaded-image', folderId: null, size: '', sizeBytes: reference.sizeBytes, width: reference.width, height: reference.height, dimensions: reference.width !== undefined && reference.height !== undefined ? `${reference.width}×${reference.height}` : undefined, createdAt: '', updatedAt: '', thumbnail: reference.thumbnail, publicUrl: reference.publicUrl, thumbnailUrl: reference.thumbnailUrl, mediaExtension: reference.mediaExtension, views: 0 };
}

function normalizeImageResolution(value: string | undefined): ImageGenerationResolution {
  return value?.toUpperCase().includes('1K') ? '1K' : '2K';
}

function getCaret(input: HTMLTextAreaElement, value = input.value) {
  const caret = input.selectionStart ?? value.length;
  return caret === 0 && value.length > 0 ? value.length : caret;
}

function countToken(prompt: string, token: string) {
  return prompt.match(new RegExp(`${escapeRegExp(token)}(?!\\d)`, 'g'))?.length ?? 0;
}

function hasPromptToken(prompt: string, token: string) {
  return countToken(prompt, token) > 0;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const REFERENCE_ORDER_BUTTON_CLASS = 'flex h-6 w-6 items-center justify-center rounded-md bg-white/5 text-gray-500 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-25';
