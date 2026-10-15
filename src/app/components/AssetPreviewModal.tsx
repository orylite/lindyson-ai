import { AlertCircle,Check,Copy,Download,Image as ImageIcon,Music2,Sparkles,Trash2,Video,X } from 'lucide-react';
import { useEffect,useId,useState } from 'react';
import { toast } from 'sonner';
import {
  SOURCE_LABELS,
  type Asset,
  type AssetFolder,
  type AssetReferenceAsset,
  type AssetReferenceImage,
  type AssetSource,
} from '../data/assets';
import { Button,Card,Dialog,Select } from '../ui';
import type { BrowserDownloadResult } from '../utils/assetDownload';
import {
  getAspectRatioValue,
  getAssetPreviewAspectRatio,
  getImagePreviewUrl,
  getReferenceThumbnailUrl,
  getVideoPosterUrl,
} from '../utils/assetPreview';

type AssetPreviewMode = 'editable' | 'readonly';

type FolderDropdownOption = {
  value: string;
  label: string;
};

interface AssetPreviewModalProps {
  asset: Asset;
  mode?: AssetPreviewMode;
  folders?: AssetFolder[];
  rootFolderId: string | null;
  onClose: () => void;
  onUpdate?: (patch: Partial<Omit<Asset, 'id'>>) => void | Promise<void>;
  onDownload: (asset: Asset) => Promise<BrowserDownloadResult | null>;
  onDelete?: () => void;
  onReuseGenerate?: (asset: Asset) => void;
  showReuseAction?: boolean;
}

function sourceIcon(source: AssetSource) {
  if (source === 'uploaded-audio') return Music2;
  return source === 'ai-video' || source === 'uploaded-video' ? Video : ImageIcon;
}

export function AssetPreviewModal({
  asset,
  mode = 'editable',
  folders = [],
  rootFolderId,
  onClose,
  onUpdate,
  onDownload,
  onDelete,
  onReuseGenerate,
  showReuseAction = true,
}: AssetPreviewModalProps) {
  const nameInputId = useId();
  const Icon = sourceIcon(asset.source);
  const generation = asset.generation;
  const editable = mode === 'editable';
  const previewAspectRatio = getAssetPreviewAspectRatio(asset);
  const isPortraitPreview = previewAspectRatio ? getAspectRatioValue(previewAspectRatio) < 1 : false;
  const modeLabel = generation?.kind === 'video' && generation.mode === 'first-last' ? '首尾帧' : '全能参考';
  const referenceAssets = generation?.referenceAssets?.length
    ? generation.referenceAssets
    : generation?.referenceImages ?? [];
  const reuseActionVisible = showReuseAction && Boolean(onReuseGenerate);
  const [nameDraft, setNameDraft] = useState(asset.name);
  const [savingName, setSavingName] = useState(false);
  const [movingFolder, setMovingFolder] = useState(false);
  const normalizedNameDraft = nameDraft.trim();
  const nameChanged = normalizedNameDraft !== asset.name;

  useEffect(() => {
    setNameDraft(asset.name);
    setSavingName(false);
    setMovingFolder(false);
  }, [asset.id, asset.name]);

  const handleSaveName = async () => {
    if (!editable || !onUpdate || savingName) return;
    if (!normalizedNameDraft) {
      toast.error('请输入素材名称');
      return;
    }
    if (!nameChanged) return;

    try {
      setSavingName(true);
      await onUpdate({ name: normalizedNameDraft });
      toast.success('素材名称已更新');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '素材名称更新失败');
    } finally {
      setSavingName(false);
    }
  };

  const handleFolderChange = async (folderId: string) => {
    if (!onUpdate || movingFolder || !rootFolderId || folderId === (asset.folderId ?? rootFolderId)) return;

    try {
      setMovingFolder(true);
      await onUpdate({ folderId });
      toast.success('素材文件夹已更新');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '素材文件夹更新失败');
    } finally {
      setMovingFolder(false);
    }
  };

  const handleCopyPrompt = async () => {
    if (!generation?.prompt) return;

    try {
      await navigator.clipboard.writeText(generation.prompt);
      toast.success('提示词已复制');
    } catch {
      toast.error('复制失败，请手动选择提示词');
    }
  };

  const handleDownload = async () => {
    try {
      const download = await onDownload(asset);
      if (!download) {
        toast.info('素材还未生成完成');
        return;
      }
      toast.success('素材下载已开始');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '素材下载失败');
    }
  };

  const handleReuse = () => {
    if (!generation) return;
    onReuseGenerate?.(asset);
  };

  return (
    <Dialog
      onClose={onClose}
      titleId="asset-preview-title"
      zIndexClass="z-40"
      panelClassName="h-[88vh] max-w-7xl"
      backdropBlur={false}
    >
      <div className="relative isolate h-full w-full">
        <Card variant="modal" backdropBlur={false} className="h-full overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-purple-300">
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <h2 id="asset-preview-title" className="text-base font-semibold text-white">素材预览</h2>
                <p className="text-xs text-gray-400">{SOURCE_LABELS[asset.source]}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="关闭素材预览"
              className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_400px] lg:overflow-hidden">
            <div className="product-media-surface flex min-h-[240px] items-center justify-center bg-black/80 p-3 sm:min-h-[360px] sm:p-5 lg:min-h-[420px] lg:border-r lg:border-white/10">
              <div
                className="relative max-h-full max-w-full overflow-hidden rounded-2xl bg-black shadow-2xl shadow-black/40"
                style={{
                  aspectRatio: previewAspectRatio ?? undefined,
                  height: previewAspectRatio ? isPortraitPreview ? '100%' : undefined : '100%',
                  width: previewAspectRatio ? isPortraitPreview ? 'auto' : '100%' : '100%',
                }}
              >
                <AssetMediaPreview asset={asset} />
              </div>
            </div>

            <aside className="min-h-0 space-y-5 p-4 sm:p-5 lg:overflow-y-auto">
              <div>
                <label htmlFor={nameInputId} className="text-xs text-gray-400">素材名称</label>
                {editable ? (
                  <div className="mt-2 flex gap-2">
                    <input
                      id={nameInputId}
                      value={nameDraft}
                      onChange={event => setNameDraft(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') void handleSaveName();
                      }}
                      className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-purple-500/50 focus:outline-none"
                    />
                    <Button
                      size="sm"
                      icon={<Check className="w-3.5 h-3.5" />}
                      loading={savingName}
                      disabled={!onUpdate || !nameChanged}
                      onClick={handleSaveName}
                      className="min-h-11 px-3"
                    >
                      确认
                    </Button>
                  </div>
                ) : (
                  <div className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white">
                    {asset.name}
                  </div>
                )}
              </div>

              {editable && (
                <FolderDropdown
                  label="所在文件夹"
                  value={asset.folderId ?? rootFolderId ?? ''}
                  options={[
                    ...(rootFolderId ? [{ value: rootFolderId, label: '主目录' }] : []),
                    ...folders.map(folder => ({ value: folder.id, label: folder.name })),
                  ]}
                  disabled={movingFolder || !rootFolderId}
                  onChange={folderId => void handleFolderChange(folderId)}
                />
              )}

              <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
                <InfoRow label="来源" value={SOURCE_LABELS[asset.source]} />
                <InfoRow label="大小" value={asset.size} />
                <InfoRow label="创建时间" value={asset.createdAt} />
                <InfoRow
                  label="下载记录"
                  value={asset.downloadRequestedAt ?? asset.downloadedAt
                    ? `首次发起下载时间：${asset.downloadRequestedAt ?? asset.downloadedAt}`
                    : '暂无下载记录'}
                />
                {asset.type === 'audio' && <InfoRow label="时长" value={asset.duration ?? '未识别'} />}
                {generation?.kind === 'video' && (
                  <>
                    <InfoRow label="模式" value={modeLabel} />
                    <InfoRow label="模型" value={generation.model} />
                    <InfoRow label="配置" value={`${generation.aspectRatio} · ${generation.resolution} · ${generation.duration}`} />
                  </>
                )}
                {generation?.kind === 'image' && (
                  <>
                    <InfoRow label="模型" value={generation.model} />
                    <InfoRow label="输出尺寸" value={generation.outputSize} />
                    <InfoRow label="比例" value={generation.ratio} />
                  </>
                )}
              </div>

              {generation && (
                <div className="space-y-5">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-white">生成提示词</h3>
                      <Button variant="secondary" size="sm" className="min-h-11" icon={<Copy className="w-3.5 h-3.5" />} onClick={handleCopyPrompt}>
                        复制
                      </Button>
                    </div>
                    <div
                      role="region"
                      aria-label="生成提示词内容"
                      data-testid="asset-preview-prompt-scroll"
                      className="scrollbar-gutter-stable max-h-48 overflow-y-auto overscroll-contain contain-paint rounded-2xl border border-purple-500/20 bg-purple-500/5 px-4 py-3 text-sm leading-relaxed text-gray-200 whitespace-pre-wrap break-words"
                    >
                      {generation.prompt || '暂无提示词'}
                    </div>
                  </div>

                  {referenceAssets.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-white mb-3">原始参考素材</h3>
                      <div className="space-y-2">
                        {referenceAssets.map(reference => (
                          <div key={reference.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-2">
                            <ReferenceThumbnail reference={reference} />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-white truncate">{reference.name}</p>
                              <p className="flex items-center gap-1 text-xs text-gray-500">
                                {'type' in reference && reference.type === 'video'
                                  ? <><Video className="h-3 w-3" />参考视频</>
                                  : 'type' in reference && reference.type === 'audio'
                                    ? <><Music2 className="h-3 w-3" />参考音频</>
                                    : <><ImageIcon className="h-3 w-3" />参考图片</>}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 grid grid-cols-1 gap-2">
                {reuseActionVisible && (
                  <Button
                    size="lg"
                    icon={<Sparkles className="w-4 h-4" />}
                    disabled={!generation}
                    onClick={handleReuse}
                  >
                    沿用生成
                  </Button>
                )}
                <Button variant="secondary" size="lg" icon={<Download className="w-4 h-4" />} onClick={() => void handleDownload()}>
                  下载素材
                </Button>
                {editable && onDelete && (
                  <Button variant="danger" size="lg" icon={<Trash2 className="w-4 h-4" />} onClick={onDelete}>
                    删除素材
                  </Button>
                )}
              </div>
            </aside>
          </div>
        </Card>
      </div>
    </Dialog>
  );
}

function AssetMediaPreview({ asset }: { asset: Asset }) {
  const [videoFailed, setVideoFailed] = useState(false);

  if (asset.type === 'video') {
    const videoUrl = asset.publicUrl;
    const posterUrl = getVideoPosterUrl(asset);

    if (videoUrl && !videoFailed) {
      return (
        <video
          key={videoUrl}
          src={videoUrl}
          poster={posterUrl}
          controls
          preload="metadata"
          playsInline
          aria-label={`视频预览 ${asset.name}`}
          className="absolute inset-0 h-full w-full bg-black object-contain"
          onError={() => setVideoFailed(true)}
        />
      );
    }

    return (
      <MediaFallback
        imageUrl={posterUrl}
        title={videoFailed ? '视频暂时无法播放' : '素材还没有可播放视频地址'}
        description="可尝试下载素材或稍后刷新页面。"
      />
    );
  }

  if (asset.type === 'audio') {
    if (asset.publicUrl) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-[#111827] via-[#0f172a] to-[#164e63] p-8 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-cyan-300/20 bg-cyan-400/10 text-cyan-200 shadow-2xl shadow-cyan-950/40">
            <Music2 className="h-11 w-11" />
          </div>
          <p className="mt-5 max-w-md truncate text-sm font-semibold text-white">{asset.name}</p>
          <p className="mt-1 text-xs text-cyan-100/60">{asset.duration ?? '时长未识别'}</p>
          <audio src={asset.publicUrl} controls preload="metadata" className="mt-6 w-full max-w-md" aria-label={`音频预览 ${asset.name}`} />
        </div>
      );
    }
    return <MediaFallback title="素材还没有可播放音频地址" description="可尝试下载素材或稍后刷新页面。" />;
  }

  const imageUrl = getImagePreviewUrl(asset);
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={`图片预览 ${asset.name}`}
        className="absolute inset-0 h-full w-full object-contain"
      />
    );
  }

  return (
    <MediaFallback
      title="暂无预览图"
      description="素材信息已保存。"
    />
  );
}

function MediaFallback({
  imageUrl,
  title,
  description,
}: {
  imageUrl?: string;
  title: string;
  description: string;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black">
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-45"
        />
      )}
      <div className="relative mx-5 flex max-w-sm flex-col items-center rounded-2xl border border-white/10 bg-black/70 px-5 py-4 text-center shadow-2xl shadow-black/40">
        <AlertCircle className="h-7 w-7 text-amber-300" />
        <p className="mt-3 text-sm font-semibold text-white">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-400">{description}</p>
      </div>
    </div>
  );
}

function ReferenceThumbnail({ reference }: { reference: AssetReferenceImage | AssetReferenceAsset }) {
  const [failed, setFailed] = useState(false);
  const thumbnailUrl = getReferenceThumbnailUrl(reference);
  const isVideo = 'type' in reference && reference.type === 'video';
  const isAudio = 'type' in reference && reference.type === 'audio';

  if (thumbnailUrl && !failed) {
    return (
      <img
        src={thumbnailUrl}
        alt={reference.name}
        className="w-14 h-14 flex-shrink-0 rounded-xl object-cover"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="w-14 h-14 flex-shrink-0 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center text-gray-500">
      {isVideo ? <Video className="h-5 w-5" /> : isAudio ? <Music2 className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
    </div>
  );
}

function FolderDropdown({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: FolderDropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return <Select label={label} value={value} options={options} disabled={disabled} touchTarget onValueChange={onChange} />;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-gray-400">{label}</span>
      <span className="text-right font-semibold text-white">{value}</span>
    </div>
  );
}
