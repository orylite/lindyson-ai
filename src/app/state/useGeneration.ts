import { keepPreviousData,useQuery,useQueryClient } from '@tanstack/react-query';
import { useCallback,useEffect,useRef,useState } from 'react';
import { toast } from 'sonner';
import type { CursorPage,PagePosition } from '../api/cursor';
import { createIdempotencyKey } from '../api/idempotency';
import { isPaginationSnapshotChanged,retryUnlessPaginationSnapshotChanged } from '../api/client';
import * as mutations from '../api/mutations';
import { privateQueryKey } from '../api/queryClient';
import * as queries from '../api/queries';
import type {
  AdminGenerationJob,
  GenerationReserveRequest,
  GenerationReserveResult,
  ImageGenerationReserveRequest,
  VideoGenerationReserveRequest,
} from '../data/admin';
import type { ConsumptionSettings } from '../data/consumption';
import type { AppTab } from './routing';
import {
  cursorPageRequestIdentity,
  useCursorPagination,
  type CursorPageRequest,
} from './useCursorPagination';

export const EMPTY_CONSUMPTION_SETTINGS: ConsumptionSettings = {
  video: [],
  image: [
    { id: 'seedream-5.0-pro-1k', model: 'seedream-5.0-pro', modelLabel: 'Seedream 5.0 Pro', resolution: '1K', credits: 0, available: false },
    { id: 'seedream-5.0-pro-2k', model: 'seedream-5.0-pro', modelLabel: 'Seedream 5.0 Pro', resolution: '2K', credits: 0, available: false },
  ],
  promptWizard: {
    generationCredits: 1,
    available: false,
    engineVersion: 4,
    updatedAt: '',
  },
};

/** AI Studio 底部生成记录每页固定展示 12 个任务。 */
export const GENERATION_QUEUE_PAGE_SIZE = 12;

/**
 * 进行中任务的轮询间隔随等待时间递增：视频生成通常要 1～5 分钟，
 * 刚提交时 3 秒一次，30 秒后 5 秒一次，2 分钟后 10 秒一次。
 */
export const GENERATION_POLL_SCHEDULE_MS = [
  { untilMs: 30_000, intervalMs: 3_000 },
  { untilMs: 120_000, intervalMs: 5_000 },
  { untilMs: Number.POSITIVE_INFINITY, intervalMs: 10_000 },
] as const;

export function generationPollDelayMs(elapsedMs: number): number {
  // NaN 和负数按刚开始处理；Infinity 落到最慢一档。
  const elapsed = elapsedMs > 0 ? elapsedMs : 0;
  const stage = GENERATION_POLL_SCHEDULE_MS.find(item => elapsed < item.untilMs)
    ?? GENERATION_POLL_SCHEDULE_MS[GENERATION_POLL_SCHEDULE_MS.length - 1];
  return stage.intervalMs;
}

/** 页面切到后台时不轮询，回到前台后立即刷新一次。 */
export function isGenerationPollVisible(visibilityState: DocumentVisibilityState | undefined) {
  return visibilityState !== 'hidden';
}

export function buildGenerationQueueQueryKeys(
  sessionEpoch: number,
  videoRequest: CursorPageRequest,
  imageRequest: CursorPageRequest,
) {
  return {
    video: privateQueryKey(sessionEpoch, 'generation', 'jobs', 'video', cursorPageRequestIdentity(videoRequest)),
    image: privateQueryKey(sessionEpoch, 'generation', 'jobs', 'image', cursorPageRequestIdentity(imageRequest)),
  };
}

export function isGenerationQueueQueryEnabled(
  kind: 'video' | 'image',
  workspaceEnabled: boolean,
  imageQueueVisited: boolean,
) {
  return workspaceEnabled && (kind === 'video' || imageQueueVisited);
}

export function buildGenerationIdempotencyFingerprint(requests: GenerationReserveRequest[]) {
  return JSON.stringify(requests.map(request => ({
    kind: request.kind,
    model: request.model,
    prompt: request.prompt,
    config: request.config,
    references: request.references,
    annotations: 'annotations' in request ? request.annotations : undefined,
    ...(request.kind === 'video' ? {
      realPortrait: request.realPortrait,
      promptWizardSource: request.promptWizardSource,
      tkPromptSource: request.tkPromptSource,
    } : {}),
  })));
}

interface UseGenerationOptions {
  refreshAccount: () => Promise<unknown>;
  invalidateUserCreditLedger: () => void;
  activeTab: AppTab;
  accountEmail: string;
  sessionEpoch: number;
}

/** 视频与图片生成提交、独立分页队列和统一轮询。 */
export function useGeneration({
  refreshAccount,
  invalidateUserCreditLedger,
  activeTab,
  accountEmail,
  sessionEpoch,
}: UseGenerationOptions) {
  const queryClient = useQueryClient();
  const videoPaging = useCursorPagination(GENERATION_QUEUE_PAGE_SIZE);
  const imagePaging = useCursorPagination(GENERATION_QUEUE_PAGE_SIZE);
  const activePollRef = useRef(false);
  const pollErrorShownRef = useRef(false);
  // 同一批进行中任务共用一个计时起点，轮询间隔按等待时长递增；任务集合变化后重新计时。
  const pollClockRef = useRef({ key: '', since: 0 });
  const videoSnapshotNoticeRef = useRef(false);
  const imageSnapshotNoticeRef = useRef(false);
  const batchKeysRef = useRef(createGenerationIdempotencyRegistry());
  const [imageQueueVisited, setImageQueueVisited] = useState(false);
  const enabled = Boolean(accountEmail) && activeTab === 'ai-studio';
  const queueKeys = buildGenerationQueueQueryKeys(sessionEpoch, videoPaging.request, imagePaging.request);
  const settingsKey = privateQueryKey(sessionEpoch, 'generation', 'consumption-settings');
  const videoJobsQuery = useQuery({
    queryKey: queueKeys.video,
    queryFn: ({ signal }) => queries.getGenerationJobsPage({ ...videoPaging.request, kind: 'video' }, signal),
    enabled: isGenerationQueueQueryEnabled('video', enabled, imageQueueVisited),
    placeholderData: keepPreviousData,
    retry: retryUnlessPaginationSnapshotChanged,
    staleTime: 30_000,
  });
  const imageJobsQuery = useQuery({
    queryKey: queueKeys.image,
    queryFn: ({ signal }) => queries.getGenerationJobsPage({ ...imagePaging.request, kind: 'image' }, signal),
    enabled: isGenerationQueueQueryEnabled('image', enabled, imageQueueVisited),
    placeholderData: keepPreviousData,
    retry: retryUnlessPaginationSnapshotChanged,
    staleTime: 30_000,
  });
  const settingsQuery = useQuery({
    queryKey: settingsKey,
    queryFn: ({ signal }) => queries.getConsumptionSettings(signal),
    enabled,
    staleTime: 5 * 60_000,
  });
  const videoGenerationJobs = videoJobsQuery.data?.items ?? [];
  const imageGenerationJobs = imageJobsQuery.data?.items ?? [];
  const userGenerationJobs = mergeGenerationJobs(videoGenerationJobs, imageGenerationJobs);
  const consumptionSettings = settingsQuery.data ?? EMPTY_CONSUMPTION_SETTINGS;

  useEffect(() => {
    if (videoJobsQuery.isFetching || !videoJobsQuery.data) return;
    videoPaging.adoptSnapshot(videoJobsQuery.data.pagination);
    videoSnapshotNoticeRef.current = false;
  }, [videoJobsQuery.data, videoJobsQuery.isFetching, videoPaging.adoptSnapshot]);

  useEffect(() => {
    if (!isPaginationSnapshotChanged(videoJobsQuery.error)) return;
    videoPaging.reset();
    if (!videoSnapshotNoticeRef.current) {
      videoSnapshotNoticeRef.current = true;
      toast.info('列表已更新，已返回第 1 页');
    }
  }, [videoJobsQuery.error, videoPaging.reset]);

  useEffect(() => {
    if (imageJobsQuery.isFetching || !imageJobsQuery.data) return;
    imagePaging.adoptSnapshot(imageJobsQuery.data.pagination);
    imageSnapshotNoticeRef.current = false;
  }, [imageJobsQuery.data, imageJobsQuery.isFetching, imagePaging.adoptSnapshot]);

  useEffect(() => {
    if (!isPaginationSnapshotChanged(imageJobsQuery.error)) return;
    imagePaging.reset();
    if (!imageSnapshotNoticeRef.current) {
      imageSnapshotNoticeRef.current = true;
      toast.info('列表已更新，已返回第 1 页');
    }
  }, [imageJobsQuery.error, imagePaging.reset]);

  useEffect(() => {
    if (!videoJobsQuery.isFetching && videoJobsQuery.data?.items.length === 0 && videoPaging.request.position !== 'first') {
      videoPaging.recoverEmptyPage(videoJobsQuery.data.pagination);
    }
  }, [videoJobsQuery.data, videoJobsQuery.isFetching, videoPaging.recoverEmptyPage, videoPaging.request.position]);

  useEffect(() => {
    if (!imageJobsQuery.isFetching && imageJobsQuery.data?.items.length === 0 && imagePaging.request.position !== 'first') {
      imagePaging.recoverEmptyPage(imageJobsQuery.data.pagination);
    }
  }, [imageJobsQuery.data, imageJobsQuery.isFetching, imagePaging.recoverEmptyPage, imagePaging.request.position]);

  const refreshUserGenerationJobs = useCallback(async () => {
    const [videoResult, imageResult] = await Promise.all([
      videoJobsQuery.refetch(),
      imageQueueVisited ? imageJobsQuery.refetch() : Promise.resolve(null),
    ]);
    return mergeGenerationJobs(videoResult.data?.items ?? [], imageResult?.data?.items ?? []);
  }, [imageJobsQuery.refetch, imageQueueVisited, videoJobsQuery.refetch]);

  const enableImageGenerationQueue = useCallback(() => {
    setImageQueueVisited(true);
  }, []);

  const refreshConsumptionSettings = useCallback(async () => {
    const result = await settingsQuery.refetch();
    if (!result.data) throw result.error ?? new Error('积分消耗配置加载失败');
    return result.data;
  }, [settingsQuery.refetch]);

  const refreshPromptWizardCredits = useCallback(async () => {
    invalidateUserCreditLedger();
    await refreshAccount();
  }, [invalidateUserCreditLedger, refreshAccount]);

  const loadGenerationJob = useCallback((id: string) => queries.getGenerationJob(id), []);

  const navigateVideoGenerationPage = useCallback((position: PagePosition) => {
    videoPaging.navigate(position, videoJobsQuery.data?.pagination);
  }, [videoJobsQuery.data?.pagination, videoPaging.navigate]);

  const navigateImageGenerationPage = useCallback((position: PagePosition) => {
    imagePaging.navigate(position, imageJobsQuery.data?.pagination);
  }, [imageJobsQuery.data?.pagination, imagePaging.navigate]);

  const reserveGenerationCredits = useCallback(async (requests: GenerationReserveRequest[]): Promise<GenerationReserveResult> => {
    if (requests.length === 0) return { ok: false, message: '没有可提交的生成任务' };
    const kind = requests[0].kind;
    if (requests.some(request => request.kind !== kind)) {
      return { ok: false, message: '同一批次不能混合图片与视频任务' };
    }
    const fingerprint = buildGenerationIdempotencyFingerprint(requests);
    const idempotencyKey = batchKeysRef.current.get(fingerprint);

    let jobs: AdminGenerationJob[];
    try {
      jobs = kind === 'image'
        ? await mutations.createImageGenerationBatch(requests as ImageGenerationReserveRequest[], idempotencyKey)
        : await mutations.createVideoGenerationBatch(requests as VideoGenerationReserveRequest[], idempotencyKey);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '生成任务创建失败' };
    }

    queryClient.setQueriesData<CursorPage<AdminGenerationJob>>(
      { queryKey: privateQueryKey(sessionEpoch, 'generation', 'jobs', kind) },
      current => current?.pagination.position === 'first'
        ? { ...current, items: mergeGenerationJobs(jobs, current.items).slice(0, current.pagination.limit) }
        : current,
    );
    if (kind === 'image') imagePaging.reset();
    else videoPaging.reset();
    invalidateUserCreditLedger();
    const refreshed = await settleGenerationRefreshes([refreshAccount()]);
    if (refreshed) batchKeysRef.current.release(fingerprint);
    return { ok: true, jobs };
  }, [imagePaging.reset, invalidateUserCreditLedger, queryClient, refreshAccount, sessionEpoch, videoPaging.reset]);

  const activeVideoJobIds = activeJobIds(videoGenerationJobs);
  const activeImageJobIds = activeJobIds(imageGenerationJobs);
  const activeJobIdsKey = `video:${activeVideoJobIds}|image:${activeImageJobIds}`;

  useEffect(() => {
    // 离开 AI Studio 后 refetch 仍会真正发请求，所以这里也要随查询一起停掉。
    if (!enabled || (!activeVideoJobIds && !activeImageJobIds)) return;
    if (pollClockRef.current.key !== activeJobIdsKey) {
      pollClockRef.current = { key: activeJobIdsKey, since: Date.now() };
    }
    let canceled = false;
    let timer: number | undefined;

    const clearTimer = () => {
      if (timer) window.clearTimeout(timer);
      timer = undefined;
    };
    const schedule = (delayMs = generationPollDelayMs(Date.now() - pollClockRef.current.since)) => {
      if (canceled || !isGenerationPollVisible(document.visibilityState)) return;
      clearTimer();
      timer = window.setTimeout(poll, delayMs);
    };
    const poll = async () => {
      if (activePollRef.current) {
        schedule();
        return;
      }
      activePollRef.current = true;
      try {
        const ids = new Set([...activeVideoJobIds.split('|'), ...activeImageJobIds.split('|')].filter(Boolean));
        const [videoResult, imageResult] = await Promise.all([
          activeVideoJobIds ? videoJobsQuery.refetch({ cancelRefetch: false }) : Promise.resolve(null),
          activeImageJobIds ? imageJobsQuery.refetch({ cancelRefetch: false }) : Promise.resolve(null),
        ]);
        if (videoResult?.error) throw videoResult.error;
        if (imageResult?.error) throw imageResult.error;
        const jobs = [
          ...(videoResult?.data?.items ?? videoGenerationJobs),
          ...(imageResult?.data?.items ?? imageGenerationJobs),
        ];
        pollErrorShownRef.current = false;
        if (jobs.some(job => ids.has(job.id) && !isActiveGenerationJob(job.status))) {
          invalidateUserCreditLedger();
          await Promise.allSettled([refreshAccount()]);
          void queryClient.invalidateQueries({ queryKey: privateQueryKey(sessionEpoch, 'assets') });
        }
      } catch (error) {
        if (!isAbortError(error) && !pollErrorShownRef.current) {
          pollErrorShownRef.current = true;
          toast.error('生成队列刷新失败，将自动重试');
        }
      } finally {
        activePollRef.current = false;
        schedule();
      }
    };
    const handleVisibilityChange = () => {
      if (isGenerationPollVisible(document.visibilityState)) schedule(0);
      else clearTimer();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    schedule();
    return () => {
      canceled = true;
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeImageJobIds, activeJobIdsKey, activeVideoJobIds, enabled, imageGenerationJobs, imageJobsQuery.refetch, invalidateUserCreditLedger, queryClient, refreshAccount, sessionEpoch, videoGenerationJobs, videoJobsQuery.refetch]);

  const clearGenerationState = useCallback(() => {
    batchKeysRef.current.clear();
    videoPaging.reset();
    imagePaging.reset();
    setImageQueueVisited(false);
  }, [imagePaging.reset, videoPaging.reset]);

  return {
    userGenerationJobs,
    videoGenerationJobs,
    imageGenerationJobs,
    generationPagination: videoJobsQuery.data?.pagination,
    generationPageLoading: videoJobsQuery.isFetching,
    navigateGenerationPage: navigateVideoGenerationPage,
    videoGenerationPagination: videoJobsQuery.data?.pagination,
    videoGenerationPageLoading: videoJobsQuery.isFetching,
    navigateVideoGenerationPage,
    imageGenerationPagination: imageJobsQuery.data?.pagination,
    imageGenerationPageLoading: imageJobsQuery.isFetching,
    navigateImageGenerationPage,
    enableImageGenerationQueue,
    consumptionSettings,
    setConsumptionSettings: (settings: ConsumptionSettings) => queryClient.setQueryData(settingsKey, settings),
    refreshUserGenerationJobs,
    refreshConsumptionSettings,
    refreshPromptWizardCredits,
    loadGenerationJob,
    reserveGenerationCredits,
    clearGenerationState,
  };
}

export function createGenerationIdempotencyRegistry(createKey = () => createIdempotencyKey('video-batch')) {
  const keys = new Map<string, string>();
  return {
    get(fingerprint: string) {
      const existing = keys.get(fingerprint);
      if (existing) return existing;
      const next = createKey();
      keys.set(fingerprint, next);
      return next;
    },
    release(fingerprint: string) {
      keys.delete(fingerprint);
    },
    clear() {
      keys.clear();
    },
  };
}

export async function settleGenerationRefreshes(refreshes: Promise<unknown>[]) {
  const results = await Promise.allSettled(refreshes);
  const succeeded = results.every(result => result.status === 'fulfilled' || isAbortError(result.reason));
  if (!succeeded) toast.warning('生成任务已创建，但部分账户数据刷新失败，稍后会自动同步');
  return succeeded;
}

function mergeGenerationJobs(incoming: AdminGenerationJob[], existing: AdminGenerationJob[]) {
  const byId = new Map<string, AdminGenerationJob>();
  [...incoming, ...existing].forEach(job => {
    if (!byId.has(job.id)) byId.set(job.id, job);
  });
  return [...byId.values()].sort((a, b) => parseJobTime(b.createdAtIso ?? b.time) - parseJobTime(a.createdAtIso ?? a.time));
}

function isActiveGenerationJob(status: AdminGenerationJob['status']) {
  return status === 'queued' || status === 'processing';
}

function activeJobIds(jobs: AdminGenerationJob[]) {
  return jobs
    .filter(job => isActiveGenerationJob(job.status))
    .map(job => job.id)
    .sort()
    .join('|');
}

function parseJobTime(value: string) {
  const parsed = new Date(value.replace(' ', 'T')).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}
