import { AlertTriangle,ExternalLink,Image as ImageIcon,Info,PlayCircle,X } from 'lucide-react';
import { useState } from 'react';
import { Dialog } from '../ui';

const OFFICIAL_TUTORIAL_URL = 'https://docs.volcengine.com/docs/82379/2582774?lang=zh';

// 演示媒体是火山引擎官方教程素材，不随仓库分发。部署方把转码后的文件放到静态目录，
// 用 VITE_SEEDREAM_TUTORIAL_MEDIA_BASE_URL 指定目录（例如 /tutorials）；未配置时只展示文字与官方链接。
const TUTORIAL_MEDIA_BASE_URL = (import.meta.env?.VITE_SEEDREAM_TUTORIAL_MEDIA_BASE_URL ?? '').trim().replace(/\/+$/, '');
const mediaUrl = (fileName: string) => TUTORIAL_MEDIA_BASE_URL ? `${TUTORIAL_MEDIA_BASE_URL}/${fileName}` : null;
const VIDEO_URL = mediaUrl('seedream-interactive-editing.mp4');
const VIDEO_POSTER_URL = mediaUrl('seedream-interactive-editing-poster.webp');
const INPUT_IMAGE_URL = mediaUrl('seedream-interactive-input.webp');
const OUTPUT_IMAGE_URL = mediaUrl('seedream-interactive-output.webp');
const MEDIA_NOT_CONFIGURED_MESSAGE = '演示媒体未配置，请查看官方教程';

const TUTORIAL_DESCRIPTION = '支持通过坐标、框选、箭头等多种方式指定编辑位置，精准编辑图片，实现局部元素替换、物品定位、区域生成等精细化操作。';

interface SeedreamInteractiveTutorialModalProps {
  onClose: () => void;
}

export function SeedreamInteractiveTutorialModal({ onClose }: SeedreamInteractiveTutorialModalProps) {
  const [videoFailed, setVideoFailed] = useState(false);

  return (
    <Dialog
      onClose={onClose}
      titleId="seedream-interactive-tutorial-title"
      descriptionId="seedream-interactive-tutorial-description"
      zIndexClass="z-[80]"
      panelClassName="flex max-h-[calc(100dvh-1.5rem)] max-w-[1180px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f0f1e] shadow-2xl sm:max-h-[calc(100dvh-3rem)]"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-6 sm:py-5">
        <div className="min-w-0">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-pink-300">Seedream 5.0 Pro</p>
          <h2 id="seedream-interactive-tutorial-title" className="text-lg font-semibold text-white sm:text-xl">
            Seedream 5.0 Pro 交互编辑教程
          </h2>
        </div>
        <button
          type="button"
          aria-label="关闭交互编辑教程"
          data-dialog-initial-focus
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div data-testid="seedream-tutorial-scroll-area" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(260px,0.65fr)]">
          <div className="grid min-w-0 content-start gap-4">
            <section aria-labelledby="seedream-tutorial-video-label" className="min-w-0 self-start rounded-2xl border border-white/10 bg-white/[0.035] p-3">
              <div className="mb-2.5 flex items-center gap-2">
                <PlayCircle className="h-4 w-4 text-pink-400" />
                <h3 id="seedream-tutorial-video-label" className="text-sm font-semibold text-white">演示视频</h3>
              </div>
              <div className="product-media-surface flex w-full items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black" style={{ aspectRatio: '2352 / 1134' }}>
                {!VIDEO_URL ? (
                  <MediaFailure message={MEDIA_NOT_CONFIGURED_MESSAGE} />
                ) : videoFailed ? (
                  <MediaFailure message="演示视频加载失败" />
                ) : (
                  <video
                    data-testid="seedream-tutorial-video"
                    src={VIDEO_URL}
                    poster={VIDEO_POSTER_URL ?? undefined}
                    controls
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-contain"
                    onError={() => setVideoFailed(true)}
                  >
                    您的浏览器暂不支持视频播放。
                  </video>
                )}
              </div>
            </section>

            <section aria-labelledby="seedream-tutorial-description-label" className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-3 sm:p-4">
              <div className="mb-2 flex items-center gap-2">
                <Info className="h-4 w-4 text-pink-400" />
                <h3 id="seedream-tutorial-description-label" className="text-sm font-semibold text-white">功能描述</h3>
              </div>
              <p id="seedream-interactive-tutorial-description" className="text-xs leading-5 text-gray-400 sm:text-sm sm:leading-6">
                {TUTORIAL_DESCRIPTION}
              </p>
            </section>
          </div>

          <aside aria-label="交互编辑输入与输出示例" className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <TutorialImage
              label="输入图"
              src={INPUT_IMAGE_URL}
              alt="交互编辑输入图：狗与孔雀海报组合图"
              failureMessage="输入图加载失败"
            />
            <TutorialImage
              label="输出图"
              src={OUTPUT_IMAGE_URL}
              alt="交互编辑输出图：狗被定位放入孔雀海报后的成品图"
              failureMessage="输出图加载失败"
            />
          </aside>
        </div>
      </div>
    </Dialog>
  );
}

function TutorialImage({ label, src, alt, failureMessage }: {
  label: string;
  src: string | null;
  alt: string;
  failureMessage: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <figure className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-3 sm:p-4">
      <figcaption className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
        <ImageIcon className="h-4 w-4 text-pink-400" />
        {label}
      </figcaption>
      <div className="flex min-h-44 w-full items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/50 sm:min-h-52 lg:min-h-0">
        {!src ? (
          <MediaFailure message={MEDIA_NOT_CONFIGURED_MESSAGE} />
        ) : failed ? (
          <MediaFailure message={failureMessage} />
        ) : (
          <img
            src={src}
            alt={alt}
            className="max-h-[360px] h-auto w-full object-contain"
            loading="eager"
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </figure>
  );
}

function MediaFailure({ message }: { message: string }) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center gap-3 px-4 py-6 text-center">
      <AlertTriangle className="h-5 w-5 text-amber-300" />
      <p className="text-sm text-gray-300">{message}</p>
      <a
        href={OFFICIAL_TUTORIAL_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-pink-300 hover:text-pink-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400"
      >
        查看官方教程
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
