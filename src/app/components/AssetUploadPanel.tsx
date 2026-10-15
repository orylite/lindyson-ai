import {
  AlertCircle,
  CircleCheck,
  Image as ImageIcon,
  Loader2,
  Music2,
  RotateCcw,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect,useId,useMemo,useRef,useState,type ChangeEvent,type DragEvent,type ReactNode } from 'react';
import { toast } from 'sonner';
import { AssetUploadError,bindUploadClientIntent,formatUploadError,getUploadSource,type RetryUploadCompletion,type UploadProgressEvent,type UploadProgressPhase } from '../api/assetUpload';
import {
  listFolders,
  type Asset,
  type AssetFolder,
  type AssetLibraryState,
  type AssetSource,
} from '../data/assets';
import { Button,Card,Dialog,FolderSelect } from '../ui';

export type UploadedSource = Extract<AssetSource, 'uploaded-video' | 'uploaded-image' | 'uploaded-audio'>;
type UploadItemStatus = 'idle' | 'signing' | 'uploading' | 'completing' | 'success' | 'error';
export type AssetUploadAccept = 'all' | 'visual' | 'image' | 'video' | 'audio';

type UploadFolderIds = Record<UploadedSource, string>;

type UploadQueueItem = {
  id: string;
  clientIntentId: string;
  file: File;
  source: UploadedSource | null;
  previewUrl: string | null;
  status: UploadItemStatus;
  errorMessage?: string;
  technicalMessage?: string;
  asset?: Asset;
  retryCompletion?: RetryUploadCompletion;
  stageLabel?: string;
};

type UploadSummary = {
  successCount: number;
  errorCount: number;
};

export type AssetUploadCompleteResult = {
  assets: Asset[];
  successCount: number;
  errorCount: number;
  firstSuccess: { source: UploadedSource; requestedFolderId: string | null } | null;
};

export function createInitialUploadFolderIds(
  initialFolderIds?: Partial<Record<UploadedSource, string>>,
): UploadFolderIds {
  return {
    'uploaded-image': initialFolderIds?.['uploaded-image'] ?? '',
    'uploaded-video': initialFolderIds?.['uploaded-video'] ?? '',
    'uploaded-audio': initialFolderIds?.['uploaded-audio'] ?? '',
  };
}

export function getMissingUploadRootSources(
  library: AssetLibraryState,
  sources: ReadonlyArray<UploadedSource | null | undefined>,
) {
  return Array.from(new Set(sources.filter((source): source is UploadedSource => (
    Boolean(source) && !hasUploadRootFolder(library, source!)
  ))));
}

export function hasAvailableUploadSource(
  library: AssetLibraryState,
  sources: ReadonlyArray<UploadedSource | null | undefined>,
) {
  return sources.some(source => Boolean(source) && hasUploadRootFolder(library, source!));
}

interface AssetUploadPanelProps {
  library: AssetLibraryState;
  accept?: AssetUploadAccept;
  title?: string;
  zIndexClass?: string;
  onClose: () => void;
  onUploadFile: (file: File, folderId: string | null, onProgress?: (event: UploadProgressEvent) => void, signal?: AbortSignal) => Promise<Asset>;
  onComplete?: (result: AssetUploadCompleteResult) => void;
  initialFolderIds?: Partial<Record<UploadedSource, string>>;
}

const UPLOAD_STATUS_LABELS: Record<UploadItemStatus, string> = {
  idle: '等待上传',
  signing: '获取上传通道',
  uploading: '上传中',
  completing: '保存素材',
  success: '已完成',
  error: '上传失败',
};

const UPLOAD_PHASE_STATUS: Record<UploadProgressPhase, UploadItemStatus> = {
  signing: 'signing',
  uploading: 'uploading',
  completing: 'completing',
  sealing: 'completing',
  validating: 'completing',
  probing: 'completing',
  thumbnailing: 'completing',
  persisting: 'completing',
};

export function AssetUploadPanel({
  library,
  accept = 'all',
  title = '上传素材',
  zIndexClass = 'z-50',
  onClose,
  onUploadFile,
  onComplete,
  initialFolderIds,
}: AssetUploadPanelProps) {
  const initialSelections = useMemo(() => createInitialUploadFolderIds(initialFolderIds), [initialFolderIds]);
  const [uploadItems, setUploadItems] = useState<UploadQueueItem[]>([]);
  const [imageFolderId, setImageFolderId] = useState(() => initialSelections['uploaded-image']);
  const [videoFolderId, setVideoFolderId] = useState(() => initialSelections['uploaded-video']);
  const [audioFolderId, setAudioFolderId] = useState(() => initialSelections['uploaded-audio']);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const uploadItemsRef = useRef<UploadQueueItem[]>([]);
  const batchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setImageFolderId(current => normalizeSelectedUploadFolderId(library, 'uploaded-image', current));
    setVideoFolderId(current => normalizeSelectedUploadFolderId(library, 'uploaded-video', current));
    setAudioFolderId(current => normalizeSelectedUploadFolderId(library, 'uploaded-audio', current));
  }, [library]);

  useEffect(() => {
    uploadItemsRef.current = uploadItems;
  }, [uploadItems]);

  useEffect(() => () => {
    batchAbortRef.current?.abort();
    revokeUploadPreviews(uploadItemsRef.current);
  }, []);

  const uploadStats = useMemo(() => {
    const total = uploadItems.length;
    const successCount = uploadItems.filter(item => item.status === 'success').length;
    const errorCount = uploadItems.filter(item => item.status === 'error').length;
    const pendingItems = uploadItems.filter(item => item.source && (item.status === 'idle' || item.status === 'error'));
    const uploadablePendingCount = pendingItems.filter(item => hasUploadRootFolder(library, item.source!)).length;
    const blockedPendingCount = pendingItems.length - uploadablePendingCount;
    const retryableErrorCount = uploadItems.filter(item => (
      item.source && item.status === 'error' && hasUploadRootFolder(library, item.source)
    )).length;
    const supportedCount = uploadItems.filter(item => item.source).length;
    const completedRatio = supportedCount === 0 ? 0 : successCount / supportedCount;

    return {
      total,
      successCount,
      errorCount,
      uploadablePendingCount,
      blockedPendingCount,
      retryableErrorCount,
      supportedCount,
      completedRatio,
    };
  }, [library, uploadItems]);

  const missingRootSources = useMemo(
    () => getMissingUploadRootSources(library, uploadItems.map(item => item.source)),
    [library, uploadItems],
  );
  const canStartUpload = !uploading && hasAvailableUploadSource(
    library,
    uploadItems
      .filter(item => item.status === 'idle' || item.status === 'error')
      .map(item => item.source),
  );
  const fileAccept = getFileInputAccept(accept);
  const copy = getUploadCopy(accept);

  const addUploadFiles = (files: File[]) => {
    if (files.length === 0) return;
    const nextItems = files.map(file => createUploadQueueItem(file, accept));
    const rejectedCount = nextItems.filter(item => !item.source).length;

    setUploadItems(prev => [...prev, ...nextItems]);
    setUploadSummary(null);
    if (rejectedCount > 0) toast.error(`${rejectedCount} 个文件格式不支持`);
  };

  const handleUploadFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    addUploadFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const handleUploadDrag = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (uploading) return;
    if (event.type === 'dragleave' && event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setDragActive(event.type === 'dragenter' || event.type === 'dragover');
  };

  const handleUploadDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (uploading) {
      toast.info('当前批次上传中，完成后再添加新文件');
      return;
    }
    addUploadFiles(Array.from(event.dataTransfer.files));
  };

  const updateUploadItem = (itemId: string, patch: Partial<UploadQueueItem>) => {
    setUploadItems(prev => prev.map(item => item.id === itemId ? { ...item, ...patch } : item));
  };

  const removeUploadItem = (itemId: string) => {
    if (uploading) return;
    setUploadItems(prev => {
      const removed = prev.find(item => item.id === itemId);
      if (removed) revokeUploadPreview(removed);
      return prev.filter(item => item.id !== itemId);
    });
  };

  const removeFailedUploadItems = () => {
    if (uploading) return;
    setUploadItems(prev => {
      const failed = prev.filter(item => item.status === 'error');
      revokeUploadPreviews(failed);
      return prev.filter(item => item.status !== 'error');
    });
    setUploadSummary(null);
  };

  const resetUploadPanel = () => {
    if (uploading) {
      toast.info('上传进行中，完成后可关闭面板');
      return;
    }
    revokeUploadPreviews(uploadItemsRef.current);
    setUploadItems([]);
    setUploadSummary(null);
    setDragActive(false);
    onClose();
  };

  const getUploadTargetFolderId = (source: UploadedSource) => (
    source === 'uploaded-video' ? videoFolderId : source === 'uploaded-audio' ? audioFolderId : imageFolderId
  );

  const submitUpload = async (mode: 'all' | 'failed' = 'all') => {
    if (uploading) return;

    const targetIds = uploadItemsRef.current
      .filter(item => {
        if (!item.source) return false;
        if (!hasUploadRootFolder(library, item.source)) return false;
        if (mode === 'failed') return item.status === 'error';
        return item.status === 'idle' || item.status === 'error';
      })
      .map(item => item.id);

    if (targetIds.length === 0) {
      toast.error(copy.emptyMessage);
      return;
    }

    let successCount = 0;
    let errorCount = mode === 'all' ? uploadItemsRef.current.filter(item => !item.source && item.status === 'error').length : 0;
    let firstSuccess: AssetUploadCompleteResult['firstSuccess'] = null;
    const successfulAssets: Asset[] = [];

    setUploading(true);
    setUploadSummary(null);
    const batchController = new AbortController();
    batchAbortRef.current = batchController;

    const processItem = async (itemId: string) => {
      const current = uploadItemsRef.current.find(item => item.id === itemId);
      if (!current?.source) return;

      const requestedFolderId = getUploadTargetFolderId(current.source) || null;
      const retryCompletion = current.retryCompletion;
      updateUploadItem(itemId, {
        status: retryCompletion ? 'completing' : 'signing',
        errorMessage: undefined,
        technicalMessage: undefined,
        stageLabel: retryCompletion ? '恢复后台处理' : undefined,
      });

      try {
        let asset: Asset;
        if (retryCompletion) {
          asset = await retryCompletion(batchController.signal);
        } else {
          bindUploadClientIntent(current.file, current.clientIntentId);
          asset = await onUploadFile(current.file, requestedFolderId, event => {
            updateUploadItem(itemId, {
              status: UPLOAD_PHASE_STATUS[event.phase],
              stageLabel: getUploadPhaseLabel(event.phase),
            });
          }, batchController.signal);
        }
        successCount += 1;
        successfulAssets.push(asset);
        if (!firstSuccess) firstSuccess = { source: current.source, requestedFolderId };
        updateUploadItem(itemId, {
          status: 'success',
          asset,
          errorMessage: undefined,
          technicalMessage: undefined,
          retryCompletion: undefined,
          stageLabel: undefined,
        });
      } catch (error) {
        const formatted = formatUploadError(error);
        const nextRetryCompletion = error instanceof AssetUploadError && error.stage === 'complete'
          ? error.retryCompletion
          : undefined;
        errorCount += 1;
        updateUploadItem(itemId, {
          status: 'error',
          errorMessage: formatted.message,
          technicalMessage: formatted.technicalMessage,
          retryCompletion: nextRetryCompletion,
          stageLabel: undefined,
        });
      }
    };

    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(3, targetIds.length) }, async () => {
      while (!batchController.signal.aborted) {
        const itemId = targetIds[nextIndex];
        nextIndex += 1;
        if (!itemId) return;
        await processItem(itemId);
      }
    });
    await Promise.all(workers);

    const result: AssetUploadCompleteResult = {
      assets: successfulAssets,
      successCount,
      errorCount,
      firstSuccess,
    };

    setUploadSummary({ successCount, errorCount });
    setUploading(false);
    batchAbortRef.current = null;

    if (batchController.signal.aborted) {
      toast.info('已停止当前批次并请求服务端取消，后台处理结果以会话状态为准');
    } else if (successCount > 0 && errorCount > 0) {
      toast.info(`已上传 ${successCount} 个素材，${errorCount} 个失败，可在面板中重试`);
    } else if (successCount > 0) {
      toast.success(`已上传 ${successCount} 个素材`);
    } else {
      toast.error('本批次素材上传失败，请查看失败原因后重试');
    }

    onComplete?.(result);
  };

  return (
    <PanelModal title={title} onClose={resetUploadPanel} closeDisabled={uploading} zIndexClass={zIndexClass}>
      <div className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <label
            className={`flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center transition-all focus-within:border-purple-300 focus-within:ring-2 focus-within:ring-purple-300/50 ${
              dragActive
                ? 'border-violet-300 bg-violet-500/10'
                : 'border-purple-500/40 bg-white/[0.03] hover:bg-white/5'
            } ${uploading ? 'cursor-not-allowed' : ''}`}
            onDragEnter={handleUploadDrag}
            onDragOver={handleUploadDrag}
            onDragLeave={handleUploadDrag}
            onDrop={handleUploadDrop}
          >
            <Upload className="mb-3 h-9 w-9 text-purple-300" />
            <p role="status" className="text-sm font-semibold text-white">{dragActive && !uploading ? '松开以上传' : uploading ? '正在上传素材…' : copy.title}</p>
            <p className="mt-1 text-xs text-gray-500">{copy.description}</p>
            <input
              type="file"
              multiple
              accept={fileAccept}
              className="sr-only"
              aria-label="选择上传素材文件"
              disabled={uploading}
              onChange={handleUploadFilesChange}
            />
          </label>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">已完成素材</span>
              <span role="status" className="text-lg font-bold text-white">{uploadStats.successCount} / {uploadStats.supportedCount}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[var(--product-accent-violet)] transition-[width] duration-180"
                style={{ width: `${uploadStats.completedRatio * 100}%` }}
              />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <UploadStat label="队列" value={uploadStats.total} />
              <UploadStat label="完成" value={uploadStats.successCount} tone="success" />
              <UploadStat label="失败" value={uploadStats.errorCount} tone="danger" />
            </div>
            {uploadSummary && (
              <div role="status" className={`mt-4 rounded-xl border p-3 text-xs ${
                uploadSummary.errorCount > 0
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
              }`}>
                {uploadSummary.errorCount > 0
                  ? `本批次已完成 ${uploadSummary.successCount} 个，失败 ${uploadSummary.errorCount} 个。`
                  : `本批次 ${uploadSummary.successCount} 个素材已完成上传。`}
              </div>
            )}
          </div>
        </div>

        {missingRootSources.length > 0 && (
          <div className="flex gap-3 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-100" role="alert">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <p>{missingRootSources.map(getUploadedSourceLabel).join('、')}的系统主目录缺失，这些来源暂时无法上传；其他来源仍可继续。</p>
          </div>
        )}

        <div className={accept === 'all' ? 'grid grid-cols-1 gap-3 md:grid-cols-3' : accept === 'visual' ? 'grid grid-cols-1 gap-3 md:grid-cols-2' : 'grid grid-cols-1 gap-3'}>
          {(accept === 'all' || accept === 'visual' || accept === 'image') && (
            <UploadFolderSelect
              label="图片目标文件夹"
              value={imageFolderId}
              folders={listFolders(library, 'uploaded-image').filter(folder => !folder.isSystem)}
              disabled={uploading || !hasUploadRootFolder(library, 'uploaded-image')}
              onChange={setImageFolderId}
            />
          )}
          {(accept === 'all' || accept === 'visual' || accept === 'video') && (
            <UploadFolderSelect
              label="视频目标文件夹"
              value={videoFolderId}
              folders={listFolders(library, 'uploaded-video').filter(folder => !folder.isSystem)}
              disabled={uploading || !hasUploadRootFolder(library, 'uploaded-video')}
              onChange={setVideoFolderId}
            />
          )}
          {(accept === 'all' || accept === 'audio') && (
            <UploadFolderSelect
              label="音频目标文件夹"
              value={audioFolderId}
              folders={listFolders(library, 'uploaded-audio').filter(folder => !folder.isSystem)}
              disabled={uploading || !hasUploadRootFolder(library, 'uploaded-audio')}
              onChange={setAudioFolderId}
            />
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/15">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-white">上传队列</p>
              <p className="text-xs text-gray-500">
                {uploadStats.supportedCount > 0
                  ? uploadStats.blockedPendingCount > 0
                    ? `${uploadStats.uploadablePendingCount} 个可上传素材 · ${uploadStats.blockedPendingCount} 个暂不可用`
                    : `${uploadStats.supportedCount} 个可上传素材`
                  : '选择文件后会显示逐项进度'}
              </p>
            </div>
            {uploadStats.errorCount > 0 && (
              <button
                type="button"
                disabled={uploading}
                onClick={removeFailedUploadItems}
                className="min-h-11 rounded-lg px-3 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/10 hover:text-red-200 disabled:opacity-50"
              >
                移除失败项
              </button>
            )}
          </div>
          <div className="max-h-[360px] space-y-2 overflow-y-auto p-3">
            {uploadItems.length === 0 ? (
              <div className="flex min-h-32 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-sm text-gray-500">
                暂无待上传文件
              </div>
            ) : (
              uploadItems.map(item => (
                <UploadQueueRow
                  key={item.id}
                  item={item}
                  targetLabel={getUploadFolderLabel(
                    library,
                    item.source,
                    item.source ? getUploadTargetFolderId(item.source) || null : null,
                  )}
                  disabled={uploading}
                  onRemove={() => removeUploadItem(item.id)}
                />
              ))
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            {uploading ? '上传进行中，完成前暂时不能关闭面板。' : '上传失败的文件会保留在队列中，可直接重试。'}
          </p>
          <div className="flex flex-wrap justify-end gap-3">
            {uploading && (
              <Button variant="danger" className="min-h-11" icon={<X className="h-4 w-4" />} onClick={() => batchAbortRef.current?.abort()}>
                取消上传
              </Button>
            )}
            {uploadStats.retryableErrorCount > 0 && (
              <Button variant="secondary" className="min-h-11" disabled={uploading} icon={<RotateCcw className="h-4 w-4" />} onClick={() => submitUpload('failed')}>
                全部重试
              </Button>
            )}
            <Button variant="secondary" className="min-h-11" disabled={uploading} onClick={resetUploadPanel}>完成</Button>
            <Button className="min-h-11" loading={uploading} disabled={!canStartUpload} onClick={() => submitUpload('all')}>
              {uploadStats.blockedPendingCount > 0 && uploadStats.uploadablePendingCount > 0
                ? '上传可用素材'
                : uploadStats.successCount > 0 ? '继续上传' : '开始上传'}
            </Button>
          </div>
        </div>
      </div>
    </PanelModal>
  );
}

function getUploadRootFolderId(library: AssetLibraryState, source: UploadedSource) {
  return library.folders.find(folder => folder.source === source && folder.isSystem)?.id ?? '';
}

function hasUploadRootFolder(library: AssetLibraryState, source: UploadedSource) {
  return Boolean(getUploadRootFolderId(library, source));
}

export function normalizeSelectedUploadFolderId(library: AssetLibraryState, source: UploadedSource, folderId: string) {
  if (!folderId) return '';
  return listFolders(library, source).some(folder => !folder.isSystem && folder.id === folderId)
    ? folderId
    : '';
}

function getUploadedSourceLabel(source: UploadedSource) {
  if (source === 'uploaded-video') return '视频';
  if (source === 'uploaded-audio') return '音频';
  return '图片';
}

function createUploadQueueItem(file: File, accept: AssetUploadAccept): UploadQueueItem {
  const detectedSource = getUploadSource(file);
  const source = isAcceptedSource(detectedSource, accept) ? detectedSource : null;
  const isImage = source === 'uploaded-image';
  const id = createUploadItemId();
  return {
    id,
    clientIntentId: id,
    file,
    source,
    previewUrl: isImage ? URL.createObjectURL(file) : null,
    status: source ? 'idle' : 'error',
    errorMessage: source ? undefined : getUnsupportedMessage(accept),
    technicalMessage: source ? undefined : `Unsupported content type: ${file.type || 'unknown'}`,
  };
}

function isAcceptedSource(source: UploadedSource | null, accept: AssetUploadAccept) {
  if (!source) return false;
  if (accept === 'image') return source === 'uploaded-image';
  if (accept === 'video') return source === 'uploaded-video';
  if (accept === 'audio') return source === 'uploaded-audio';
  if (accept === 'visual') return source !== 'uploaded-audio';
  return true;
}

function getUnsupportedMessage(accept: AssetUploadAccept) {
  if (accept === 'image') return '仅支持图片文件';
  if (accept === 'video') return '仅支持视频文件';
  if (accept === 'audio') return '仅支持 MP3 或 WAV 音频文件';
  if (accept === 'visual') return '仅支持图片或视频文件';
  return '仅支持图片、视频或 MP3/WAV 音频文件';
}

function getFileInputAccept(accept: AssetUploadAccept) {
  if (accept === 'image') return 'image/*';
  if (accept === 'video') return 'video/*';
  if (accept === 'audio') return '.mp3,.wav,audio/mpeg,audio/wav,audio/x-wav';
  if (accept === 'visual') return 'image/*,video/*';
  return 'image/*,video/*,.mp3,.wav,audio/mpeg,audio/wav,audio/x-wav';
}

function getUploadCopy(accept: AssetUploadAccept) {
  if (accept === 'image') {
    return {
      title: '选择或拖拽图片文件',
      description: '图片进入已上传图片；失败项可单独重试',
      emptyMessage: '请先选择可上传的图片文件',
    };
  }
  if (accept === 'video') {
    return {
      title: '选择或拖拽视频文件',
      description: '视频进入已上传视频；失败项可单独重试',
      emptyMessage: '请先选择可上传的视频文件',
    };
  }
  if (accept === 'audio') {
    return {
      title: '选择或拖拽 MP3/WAV 音频',
      description: '音频进入已上传音频；失败项可单独重试',
      emptyMessage: '请先选择可上传的音频文件',
    };
  }
  if (accept === 'visual') {
    return {
      title: '选择或拖拽图片、视频文件',
      description: '图片进入已上传图片，视频进入已上传视频；失败项可单独重试',
      emptyMessage: '请先选择可上传的图片或视频文件',
    };
  }
  return {
    title: '选择或拖拽图片、视频、音频文件',
    description: '文件按类型进入对应数字资产分类；音频仅支持 MP3/WAV',
    emptyMessage: '请先选择可上传的素材文件',
  };
}

function createUploadItemId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function revokeUploadPreview(item: UploadQueueItem) {
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
}

function revokeUploadPreviews(items: UploadQueueItem[]) {
  items.forEach(revokeUploadPreview);
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function getUploadFolderLabel(library: AssetLibraryState, source: UploadedSource | null, folderId: string | null) {
  if (!source || !folderId) return '不放入文件夹';
  const folder = listFolders(library, source).find(item => item.id === folderId);
  if (!folder || folder.isSystem) return '不放入文件夹';
  return folder.name;
}

function UploadFolderSelect({
  label,
  value,
  folders,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  folders: AssetFolder[];
  disabled?: boolean;
  onChange: (folderId: string) => void;
}) {
  return (
    <FolderSelect
      label={label}
      value={value}
      options={[
        { value: '', label: '不放入文件夹' },
        ...folders.map(folder => ({ value: folder.id, label: folder.name })),
      ]}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

function UploadStat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'success' | 'danger' }) {
  const valueColor = tone === 'success' ? 'text-emerald-300' : tone === 'danger' ? 'text-red-300' : 'text-white';

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 px-2 py-2">
      <p className={`text-base font-bold ${valueColor}`}>{value}</p>
      <p className="text-[10px] text-gray-500">{label}</p>
    </div>
  );
}

function UploadQueueRow({
  item,
  targetLabel,
  disabled,
  onRemove,
}: {
  item: UploadQueueItem;
  targetLabel: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  const isWorking = item.status === 'signing' || item.status === 'uploading' || item.status === 'completing';
  const statusColor = item.status === 'success'
    ? 'text-emerald-300'
    : item.status === 'error'
    ? 'text-red-300'
    : isWorking
    ? 'text-purple-300'
    : 'text-gray-400';

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-black/30">
          {item.previewUrl ? (
            <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-purple-300">
              {item.source === 'uploaded-video' ? <Video className="h-6 w-6" /> : item.source === 'uploaded-audio' ? <Music2 className="h-6 w-6" /> : <ImageIcon className="h-6 w-6" />}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{item.file.name}</p>
              <p className="mt-0.5 text-xs text-gray-500">
                {formatFileSize(item.file.size)} · {item.source === 'uploaded-video' ? '视频' : item.source === 'uploaded-audio' ? '音频' : item.source === 'uploaded-image' ? '图片' : '不支持'} · {targetLabel}
              </p>
            </div>
            <div className={`flex flex-shrink-0 items-center gap-1 text-xs font-semibold ${statusColor}`}>
              {isWorking && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}
              {item.status === 'success' && <CircleCheck className="h-3.5 w-3.5" />}
              {item.status === 'error' && <AlertCircle className="h-3.5 w-3.5" />}
              <span>{item.stageLabel ?? UPLOAD_STATUS_LABELS[item.status]}</span>
            </div>
          </div>

          {item.errorMessage && (
            <p role="alert" className="mt-2 text-xs text-red-200" title={item.technicalMessage}>
              {item.errorMessage}
            </p>
          )}
        </div>

        <button
          type="button"
          disabled={disabled || isWorking}
          onClick={onRemove}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-white/5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`移除 ${item.file.name}`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function getUploadPhaseLabel(phase: UploadProgressPhase) {
  if (phase === 'signing') return '获取上传通道';
  if (phase === 'uploading') return '上传中';
  if (phase === 'sealing') return '封口文件';
  if (phase === 'validating') return '校验文件';
  if (phase === 'probing') return '读取媒体';
  if (phase === 'thumbnailing') return '生成封面';
  if (phase === 'persisting') return '保存素材';
  return '等待后台处理';
}

function PanelModal({
  title,
  children,
  onClose,
  zIndexClass,
  closeDisabled = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  zIndexClass: string;
  closeDisabled?: boolean;
}) {
  const titleId = useId();
  return (
    <Dialog
      onClose={onClose}
      titleId={titleId}
      closeDisabled={closeDisabled}
      zIndexClass={zIndexClass}
      panelClassName="max-w-5xl"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        className="relative w-full"
      >
        <Card variant="modal">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <h2 id={titleId} className="text-base font-semibold text-white">{title}</h2>
            <button
              onClick={onClose}
              disabled={closeDisabled}
              className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="关闭上传素材"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="max-h-[calc(100vh-8rem)] overflow-y-auto p-5">{children}</div>
        </Card>
      </motion.div>
    </Dialog>
  );
}
