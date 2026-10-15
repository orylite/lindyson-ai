import { Image as ImageIcon,Video } from 'lucide-react';
import { lazy,Suspense,useEffect,useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { UploadProgressEvent } from '../api/assetUpload';
import type { ExactCursorPagination as CursorPaginationState,PagePosition } from '../api/cursor';
import type { AdminGenerationJob,GenerationReserveRequest,GenerationReserveResult } from '../data/admin';
import type { Asset,AssetFolder,AssetGenerationMeta,AssetSource,AssetSummary } from '../data/assets';
import type { ConsumptionSettings } from '../data/consumption';
import type { RealPortraitActor } from '../data/realPortraits';
import { AppPage,PageHeader,StudioTab,StudioTabList } from '../ui';
import type { BrowserDownloadResult,DownloadableAsset } from '../utils/assetDownload';

const AIVideoStudio = lazy(() => import('./AIStudio').then(module => ({ default: module.AIVideoStudio })));
const AIImageStudio = lazy(() => import('./AIImageStudio').then(module => ({ default: module.AIImageStudio })));

type StudioKind = 'video' | 'image';

const STUDIO_KINDS = ['video', 'image'] as const satisfies readonly StudioKind[];
const STUDIO_TAB_IDS: Record<StudioKind, string> = {
  video: 'ai-studio-tab-video',
  image: 'ai-studio-tab-image',
};
const STUDIO_PANEL_IDS: Record<StudioKind, string> = {
  video: 'ai-studio-panel-video',
  image: 'ai-studio-panel-image',
};

interface AIStudioWorkspaceProps {
  assets: Asset[];
  folders: AssetFolder[];
  assetSummary: AssetSummary;
  assetPagination?: CursorPaginationState;
  assetPageLoading?: boolean;
  assetPageError?: unknown;
  videoGenerationJobs: AdminGenerationJob[];
  videoGenerationPagination?: CursorPaginationState;
  videoGenerationPageLoading?: boolean;
  imageGenerationJobs: AdminGenerationJob[];
  imageGenerationPagination?: CursorPaginationState;
  imageGenerationPageLoading?: boolean;
  reuseDraft?: AssetGenerationMeta | null;
  onReuseDraftConsumed?: () => void;
  onGenerationReserve: (requests: GenerationReserveRequest[]) => Promise<GenerationReserveResult>;
  onAssetsPrepare: () => void;
  onAssetFiltersChange: (filters: { source?: AssetSource; folderId?: string | null; search?: string }) => void;
  onAssetPageNavigate: (position: PagePosition) => void;
  onAssetDetailLoad: (assetId: string) => Promise<Asset>;
  onGenerationJobDetailLoad: (jobId: string) => Promise<AdminGenerationJob>;
  onVideoGenerationPageNavigate: (position: PagePosition) => void;
  onImageGenerationPageNavigate: (position: PagePosition) => void;
  onImageStudioVisited: () => void;
  onConsumptionSettingsRefresh: () => Promise<ConsumptionSettings>;
  onUploadFile: (file: File, folderId: string | null, onProgress?: (event: UploadProgressEvent) => void) => Promise<Asset>;
  onAssetDownload: (asset: DownloadableAsset) => Promise<BrowserDownloadResult | null>;
  onAssetDelete: (assetId: string) => Promise<void>;
  consumptionSettings: ConsumptionSettings;
  availableCredits: number;
  onPromptWizardCreditsChanged: () => Promise<void>;
  onCreditsRecharge: () => void;
  realPortraitActors: RealPortraitActor[];
  realPortraitsLoading?: boolean;
  onRealPortraitLibraryOpen: () => void;
}

export function AIStudioWorkspace(props: AIStudioWorkspaceProps) {
  const [activeKind, setActiveKind] = useState<StudioKind>(() => props.reuseDraft?.kind ?? 'video');
  const [visited, setVisited] = useState<Record<StudioKind, boolean>>(() => ({
    video: props.reuseDraft?.kind !== 'image',
    image: props.reuseDraft?.kind === 'image',
  }));

  useEffect(() => {
    if (!props.reuseDraft) return;
    setActiveKind(props.reuseDraft.kind);
    setVisited(current => ({ ...current, [props.reuseDraft!.kind]: true }));
  }, [props.reuseDraft]);

  useEffect(() => {
    if (visited.image) props.onImageStudioVisited();
  }, [props.onImageStudioVisited, visited.image]);

  const selectKind = (kind: StudioKind) => {
    setActiveKind(kind);
    setVisited(current => current[kind] ? current : { ...current, [kind]: true });
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, kind: StudioKind) => {
    const currentIndex = STUDIO_KINDS.indexOf(kind);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % STUDIO_KINDS.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + STUDIO_KINDS.length) % STUDIO_KINDS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = STUDIO_KINDS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextKind = STUDIO_KINDS[nextIndex];
    selectKind(nextKind);
    document.getElementById(STUDIO_TAB_IDS[nextKind])?.focus();
  };

  const sharedProps = {
    assets: props.assets,
    folders: props.folders,
    assetSummary: props.assetSummary,
    assetPagination: props.assetPagination,
    assetPageLoading: props.assetPageLoading,
    assetPageError: props.assetPageError,
    onGenerationReserve: props.onGenerationReserve,
    onAssetsPrepare: props.onAssetsPrepare,
    onAssetFiltersChange: props.onAssetFiltersChange,
    onAssetPageNavigate: props.onAssetPageNavigate,
    onAssetDetailLoad: props.onAssetDetailLoad,
    onConsumptionSettingsRefresh: props.onConsumptionSettingsRefresh,
    onUploadFile: props.onUploadFile,
    onAssetDownload: props.onAssetDownload,
    onAssetDelete: props.onAssetDelete,
    consumptionSettings: props.consumptionSettings,
    availableCredits: props.availableCredits,
  };

  return (
    <AppPage
      width="workspace"
      padded={false}
      data-testid="ai-studio-workspace-scroll"
      className="h-full min-h-0 overflow-y-auto overflow-x-hidden"
    >
      <div className="px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="mx-auto max-w-7xl" data-testid="ai-studio-workspace-header">
          <PageHeader
            title="AI Studio"
            subtitle={activeKind === 'video' ? '使用 Seedance 2.5 / 2.0 生成视频素材' : '使用 Seedream 5.0 Pro 生成与精准编辑图片'}
            titleTone="solid"
          />
        </div>
      </div>

      <div className="px-4 pb-4 pt-4 sm:px-6 sm:pb-6">
        <div
          data-testid="ai-studio-workspace-content"
          className="mx-auto max-w-7xl"
        >
          <StudioTabList
            data-testid="ai-studio-workspace-tabs"
            aria-label="AI Studio 生成类型"
          >
            <StudioTab
              id={STUDIO_TAB_IDS.video}
              active={activeKind === 'video'}
              accent="violet"
              icon={<Video className="h-4 w-4" />}
              aria-controls={STUDIO_PANEL_IDS.video}
              tabIndex={activeKind === 'video' ? 0 : -1}
              onClick={() => selectKind('video')}
              onKeyDown={event => handleTabKeyDown(event, 'video')}
            >
              AI 视频
            </StudioTab>
            <StudioTab
              id={STUDIO_TAB_IDS.image}
              active={activeKind === 'image'}
              accent="pink"
              icon={<ImageIcon className="h-4 w-4" />}
              aria-controls={STUDIO_PANEL_IDS.image}
              tabIndex={activeKind === 'image' ? 0 : -1}
              onClick={() => selectKind('image')}
              onKeyDown={event => handleTabKeyDown(event, 'image')}
            >
              AI 图片
            </StudioTab>
          </StudioTabList>

          <div
            id={STUDIO_PANEL_IDS.video}
            role="tabpanel"
            aria-labelledby={STUDIO_TAB_IDS.video}
            className={activeKind === 'video' ? 'min-w-0 pt-4' : 'hidden'}
          >
            {visited.video && (
              <Suspense fallback={<WorkspaceLoading />}>
                <AIVideoStudio
                  {...sharedProps}
                  generationJobs={props.videoGenerationJobs}
                  generationPagination={props.videoGenerationPagination}
                  generationPageLoading={props.videoGenerationPageLoading}
                  reuseDraft={activeKind === 'video' && props.reuseDraft?.kind === 'video' ? props.reuseDraft : null}
                  onReuseDraftConsumed={props.onReuseDraftConsumed}
                  onGenerationPageNavigate={props.onVideoGenerationPageNavigate}
                  onGenerationJobDetailLoad={props.onGenerationJobDetailLoad}
                  onPromptWizardCreditsChanged={props.onPromptWizardCreditsChanged}
                  onCreditsRecharge={props.onCreditsRecharge}
                  realPortraitActors={props.realPortraitActors}
                  realPortraitsLoading={props.realPortraitsLoading}
                  onRealPortraitLibraryOpen={props.onRealPortraitLibraryOpen}
                />
              </Suspense>
            )}
          </div>
          <div
            id={STUDIO_PANEL_IDS.image}
            role="tabpanel"
            aria-labelledby={STUDIO_TAB_IDS.image}
            className={activeKind === 'image' ? 'min-w-0 pt-4' : 'hidden'}
          >
            {visited.image && (
              <Suspense fallback={<WorkspaceLoading />}>
                <AIImageStudio
                  {...sharedProps}
                  generationJobs={props.imageGenerationJobs}
                  generationPagination={props.imageGenerationPagination}
                  generationPageLoading={props.imageGenerationPageLoading}
                  reuseDraft={activeKind === 'image' && props.reuseDraft?.kind === 'image' ? props.reuseDraft : null}
                  onReuseDraftConsumed={props.onReuseDraftConsumed}
                  onGenerationPageNavigate={props.onImageGenerationPageNavigate}
                  onCreditsRecharge={props.onCreditsRecharge}
                />
              </Suspense>
            )}
          </div>
        </div>
      </div>
    </AppPage>
  );
}

function WorkspaceLoading() {
  return <div className="flex min-h-64 items-center justify-center text-sm text-gray-500">正在加载 AI Studio 工作区...</div>;
}
