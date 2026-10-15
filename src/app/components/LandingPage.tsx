import {
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  Clapperboard,
  FolderOpen,
  Heart,
  Home,
  Inbox,
  Layers3,
  MessageCircle,
  Music2,
  Play,
  Plus,
  Search,
  Send,
  Share2,
  Sparkles,
  UserRound,
  Video,
  WandSparkles,
} from 'lucide-react';
import { motion,useMotionTemplate,useMotionValue,useMotionValueEvent,useReducedMotion,useScroll,useSpring,useTransform,type MotionValue } from 'motion/react';
import { useEffect,useRef,useState,type ImgHTMLAttributes } from 'react';
import { type AdminPlan } from '../data/admin';
import { LANDING_CONTENT,type LandingCapabilityIconKey } from '../data/landingContent';
import { Button } from '../ui';
import { PlanCard } from './PlanCard';
import { PublicComplianceNotice } from './PublicComplianceNotice';

interface LandingPageProps {
  plans: AdminPlan[];
  onStart: () => void;
  onLogin: () => void;
}

interface LandingPictureProps {
  alt: string;
  base: string;
  className?: string;
  loading?: ImgHTMLAttributes<HTMLImageElement>['loading'];
  fetchPriority?: ImgHTMLAttributes<HTMLImageElement>['fetchPriority'];
}

interface LandingCampaignMediaProps {
  alt: string;
  posterBase: string;
  videoSrc: string;
  className?: string;
  eager?: boolean;
  reduceMotion: boolean;
  active?: MotionValue<number>;
}

interface LandingStaticPictureProps {
  alt: string;
  base: string;
  className?: string;
  width: number;
  height: number;
}

const capabilityIcons: Record<LandingCapabilityIconKey, typeof Video> = {
  generate: WandSparkles,
  library: Layers3,
  publish: Send,
};

const heroCardLayouts = [
  { className: 'left-[3%] top-[24%] h-[62%] w-[36%] z-10',rotate: -7 },
  { className: 'left-[31%] top-[6%] h-[76%] w-[40%] z-30',rotate: 0 },
  { className: 'right-[1%] top-[20%] h-[64%] w-[35%] z-20',rotate: 7 },
] as const;

const landingNavItems = [
  { label: '创作过程',target: 'landing-showcase' },
  { label: '能力',target: 'landing-capabilities' },
  { label: '定价',target: 'landing-pricing' },
  { label: 'FAQ',target: 'landing-faq' },
] as const;

const capabilityVisuals = [
  {
    border: 'border-fuchsia-400/25',
    ambient: 'bg-[radial-gradient(circle_at_18%_8%,rgba(217,70,239,0.25),transparent_58%)]',
    icon: 'border-fuchsia-300/20 bg-fuchsia-400/15 text-fuchsia-100 shadow-[0_0_36px_rgba(217,70,239,0.18)]',
    glow: 'rgba(217,70,239,0.28)',
  },
  {
    border: 'border-violet-400/25',
    ambient: 'bg-[radial-gradient(circle_at_18%_8%,rgba(139,92,246,0.25),transparent_58%)]',
    icon: 'border-violet-300/20 bg-violet-400/15 text-violet-100 shadow-[0_0_36px_rgba(139,92,246,0.18)]',
    glow: 'rgba(139,92,246,0.28)',
  },
  {
    border: 'border-blue-400/25',
    ambient: 'bg-[radial-gradient(circle_at_18%_8%,rgba(59,130,246,0.25),transparent_58%)]',
    icon: 'border-blue-300/20 bg-blue-400/15 text-blue-100 shadow-[0_0_36px_rgba(59,130,246,0.18)]',
    glow: 'rgba(59,130,246,0.28)',
  },
] as const;

type LandingCapability = (typeof LANDING_CONTENT.capabilities.items)[number];

function LandingPicture({ alt,base,className = '',loading = 'lazy',fetchPriority = 'auto' }: LandingPictureProps) {
  const priorityAttribute = { fetchpriority: fetchPriority } as unknown as ImgHTMLAttributes<HTMLImageElement>;

  return (
    <picture>
      <source srcSet={`${base}.avif`} type="image/avif" />
      <source srcSet={`${base}.webp`} type="image/webp" />
      <img
        src={`${base}.webp`}
        alt={alt}
        width="1024"
        height="1280"
        loading={loading}
        {...priorityAttribute}
        decoding="async"
        className={className}
      />
    </picture>
  );
}

function LandingStaticPicture({ alt,base,className = '',width,height }: LandingStaticPictureProps) {
  return (
    <picture>
      <source srcSet={`${base}.avif`} type="image/avif" />
      <source srcSet={`${base}.webp`} type="image/webp" />
      <img
        src={`${base}.png`}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        className={className}
      />
    </picture>
  );
}

function LandingCampaignMedia({ alt,posterBase,videoSrc,className = '',eager = false,reduceMotion,active }: LandingCampaignMediaProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (reduceMotion || !videoRef.current) return;
    const video = videoRef.current;
    let intersectsViewport = false;
    let isActive = active ? active.get() > 0.5 : true;
    const syncPlayback = () => {
      if (intersectsViewport && isActive) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    };
    const observer = new IntersectionObserver(entries => {
      intersectsViewport = entries.some(entry => entry.isIntersecting);
      syncPlayback();
    }, { threshold: 0.12 });
    const unsubscribe = active?.on('change',latest => {
      isActive = latest > 0.5;
      syncPlayback();
    });
    observer.observe(video);
    return () => {
      unsubscribe?.();
      observer.disconnect();
      video.pause();
    };
  }, [active,reduceMotion]);

  if (reduceMotion) {
    return (
      <LandingPicture
        base={posterBase}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : 'auto'}
        className={className}
      />
    );
  }

  return (
    <video
      ref={videoRef}
      aria-label={alt}
      muted
      loop
      playsInline
      disablePictureInPicture
      controlsList="nodownload noremoteplayback"
      preload={eager ? 'auto' : 'metadata'}
      poster={`${posterBase}.webp`}
      data-campaign-video={videoSrc}
      className={className}
    >
      <source src={videoSrc} type="video/mp4" />
    </video>
  );
}

const showcaseProduct = LANDING_CONTENT.media[0];

function ProductAnalysisPanel({ progress,reduceMotion }: { progress?: MotionValue<number>; reduceMotion: boolean }) {
  const staticProgress = useMotionValue(1);
  const resolvedProgress = reduceMotion || !progress ? staticProgress : progress;
  const tagsOpacity = useTransform(resolvedProgress,[0.34,0.58],[0,1],{ clamp: true });
  const tagsY = useTransform(resolvedProgress,[0.34,0.58],[14,0],{ clamp: true });
  const promptOpacity = useTransform(resolvedProgress,[0.66,0.9],[0,1],{ clamp: true });
  const promptY = useTransform(resolvedProgress,[0.66,0.9],[16,0],{ clamp: true });
  const readyOpacity = useTransform(resolvedProgress,[0.9,1],[0,1],{ clamp: true });
  const [value,setValue] = useState(() => reduceMotion ? 100 : Math.round(resolvedProgress.get() * 100));

  useMotionValueEvent(resolvedProgress,'change',latest => setValue(Math.round(latest * 100)));
  useEffect(() => {
    if (reduceMotion) setValue(100);
  },[reduceMotion]);

  const analysis = LANDING_CONTENT.showcase.analysis;

  return (
    <div data-product-analysis-panel className="relative h-full w-full overflow-hidden rounded-[1.6rem] border border-violet-300/20 bg-[#0b0a12]/95 p-5 shadow-[0_32px_90px_rgba(0,0,0,0.58)] backdrop-blur-2xl sm:p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(168,85,247,0.2),transparent_48%),radial-gradient(circle_at_100%_100%,rgba(59,130,246,0.12),transparent_46%)]" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-fuchsia-300/20 bg-fuchsia-400/15 shadow-[0_0_28px_rgba(217,70,239,0.2)]"><WandSparkles className="h-4.5 w-4.5 text-fuchsia-100" /></span>
            <div>
              <p className="text-[9px] font-bold tracking-[0.2em] text-violet-300">{analysis.eyebrow}</p>
              <h4 className="mt-1 text-base font-bold text-white">{analysis.title}</h4>
            </div>
          </div>
          <span data-analysis-progress aria-label={`产品分析进度 ${value}%`} className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold tabular-nums text-white/75">{value}%</span>
        </div>

        <div className="mt-5 h-1 overflow-hidden rounded-full bg-white/10">
          <motion.div data-analysis-progress-bar style={{ scaleX: resolvedProgress,transformOrigin: 'left' }} className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-400 to-blue-400" />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/8 bg-black/25 p-3">
            <dt className="text-[9px] font-semibold tracking-[0.14em] text-white/35">{analysis.productLabel}</dt>
            <dd className="mt-1 text-sm font-semibold text-white/90">{analysis.product}</dd>
          </div>
          <div className="rounded-2xl border border-white/8 bg-black/25 p-3">
            <dt className="text-[9px] font-semibold tracking-[0.14em] text-white/35">{analysis.sceneLabel}</dt>
            <dd className="mt-1 text-xs font-semibold leading-5 text-white/80">{analysis.scene}</dd>
          </div>
        </dl>

        <motion.div data-analysis-tags style={{ opacity: tagsOpacity,y: tagsY }} className="mt-4">
          <p className="text-[9px] font-semibold tracking-[0.14em] text-white/35">{analysis.tagsLabel}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {analysis.tags.map(tag => <span key={tag} className="rounded-full border border-violet-300/15 bg-violet-400/10 px-2.5 py-1 text-[10px] font-medium text-violet-100/85">{tag}</span>)}
          </div>
        </motion.div>

        <motion.div data-analysis-prompt style={{ opacity: promptOpacity,y: promptY }} className="mt-4 rounded-2xl border border-white/10 bg-black/35 p-3.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[9px] font-semibold tracking-[0.14em] text-white/35">{analysis.promptLabel}</p>
            <motion.span data-analysis-ready style={{ opacity: readyOpacity }} className="flex items-center gap-1 text-[9px] font-semibold text-emerald-300"><Check className="h-3 w-3" />{analysis.readyLabel}</motion.span>
          </div>
          <p className="mt-2 text-xs leading-5 text-white/72">{analysis.prompt}</p>
        </motion.div>
      </div>
    </div>
  );
}

function CapabilityCard({ capability,index,reduceMotion }: { capability: LandingCapability; index: number; reduceMotion: boolean }) {
  const Icon = capabilityIcons[capability.iconKey];
  const visual = capabilityVisuals[index] ?? capabilityVisuals[0];
  const pointerX = useMotionValue(50);
  const pointerY = useMotionValue(50);
  const rotateXTarget = useMotionValue(0);
  const rotateYTarget = useMotionValue(0);
  const rotateX = useSpring(rotateXTarget,{ stiffness: 180,damping: 24,mass: 0.45 });
  const rotateY = useSpring(rotateYTarget,{ stiffness: 180,damping: 24,mass: 0.45 });
  const cursorGlow = useMotionTemplate`radial-gradient(340px circle at ${pointerX}% ${pointerY}%, ${visual.glow}, transparent 68%)`;

  return (
    <motion.article
      data-capability-card={capability.id}
      onPointerMove={(event) => {
        if (reduceMotion || event.pointerType === 'touch') return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = Math.min(1,Math.max(0,(event.clientX - bounds.left) / bounds.width));
        const y = Math.min(1,Math.max(0,(event.clientY - bounds.top) / bounds.height));
        pointerX.set(x * 100);
        pointerY.set(y * 100);
        rotateXTarget.set((0.5 - y) * 5);
        rotateYTarget.set((x - 0.5) * 5);
      }}
      onPointerLeave={() => {
        pointerX.set(50);
        pointerY.set(50);
        rotateXTarget.set(0);
        rotateYTarget.set(0);
      }}
      whileHover={reduceMotion ? undefined : { y: -6,scale: 1.012 }}
      transition={{ duration: 0.28,ease: [0.22,1,0.36,1] }}
      style={reduceMotion ? undefined : { rotateX,rotateY,transformPerspective: 1000 }}
      className={`group relative min-h-72 overflow-hidden rounded-[1.75rem] border bg-[#0c0c12] p-7 shadow-[0_28px_80px_rgba(0,0,0,0.28)] transform-gpu ${visual.border}`}
    >
      <div data-capability-default-glow className={`pointer-events-none absolute inset-0 opacity-80 ${visual.ambient}`} />
      <motion.div data-capability-cursor-glow style={{ background: cursorGlow }} className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent opacity-50" />
      <div className="relative flex h-full flex-col">
        <div className="flex items-center justify-between">
          <motion.span whileHover={reduceMotion ? undefined : { rotate: -5,scale: 1.06 }} className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${visual.icon}`}><Icon className="h-5 w-5" /></motion.span>
          <span className="text-xs font-semibold tracking-[0.2em] text-white/30">0{index + 1}</span>
        </div>
        <div className="mt-auto pt-16">
          <h3 className="text-2xl font-bold tracking-[-0.03em] text-white">{capability.title}</h3>
          <p className="mt-3 max-w-sm text-sm leading-6 text-white/55">{capability.description}</p>
        </div>
      </div>
    </motion.article>
  );
}

function GenerationProgress({ progress }: { progress: MotionValue<number> }) {
  const [value,setValue] = useState(() => Math.round(progress.get() * 100));

  useMotionValueEvent(progress,'change',latest => setValue(Math.round(latest * 100)));

  return (
    <div data-generation-control className="w-full rounded-2xl border border-white/12 bg-black/80 px-4 py-3.5 shadow-2xl shadow-black/60 backdrop-blur-xl sm:px-5">
      <div className="flex items-center justify-between gap-4 text-[11px] font-semibold tracking-[0.08em] text-white/65">
        <span className="flex items-center gap-2"><WandSparkles className="h-3.5 w-3.5 text-fuchsia-300" />Generating perfume film</span>
        <span data-generation-progress aria-label={`生成进度 ${value}%`} className="tabular-nums text-white">{value}%</span>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
        <motion.div data-generation-progress-bar style={{ scaleX: progress,transformOrigin: 'left' }} className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-400 to-blue-400" />
      </div>
    </div>
  );
}

function GenerationWorkspace({ progress,progressOpacity,videoOpacity,videoActive }: {
  progress: MotionValue<number>;
  progressOpacity: MotionValue<number>;
  videoOpacity: MotionValue<number>;
  videoActive: MotionValue<number>;
}) {
  return (
    <div data-generation-workspace className="relative h-full w-full overflow-hidden rounded-[1.6rem] border border-violet-300/20 bg-[#0b0a12]/95 shadow-[0_32px_90px_rgba(0,0,0,0.58)] backdrop-blur-2xl">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_4%,rgba(217,70,239,0.18),transparent_45%),radial-gradient(circle_at_82%_100%,rgba(59,130,246,0.16),transparent_48%)]" />
      <motion.div data-generation-progress-view style={{ opacity: progressOpacity }} className="absolute inset-0 flex flex-col items-center justify-center px-6 sm:px-10">
        <div className="flex h-14 w-14 items-center justify-center rounded-[1.25rem] border border-fuchsia-300/20 bg-fuchsia-400/15 shadow-[0_0_44px_rgba(217,70,239,0.24)]"><WandSparkles className="h-6 w-6 text-fuchsia-100" /></div>
        <p className="mt-5 text-[10px] font-bold tracking-[0.24em] text-violet-300">AI VIDEO GENERATION</p>
        <p className="mt-2 text-lg font-bold text-white">Generating perfume film</p>
        <p className="mt-2 text-xs text-white/35">Seedance 2.0 · 9:16 · 5s</p>
        <div className="mt-7 w-full max-w-md"><GenerationProgress progress={progress} /></div>
      </motion.div>
      <motion.div data-generation-video-view style={{ opacity: videoOpacity }} className="absolute inset-0 flex items-center justify-center p-5 sm:p-6">
        <figure className="relative aspect-[9/16] h-full max-h-[21.5rem] overflow-hidden rounded-[1.35rem] border border-white/12 bg-black shadow-[0_28px_80px_rgba(0,0,0,0.65)]">
          <LandingCampaignMedia
            posterBase={showcaseProduct.campaignBase}
            videoSrc={showcaseProduct.campaignVideo}
            alt={`${showcaseProduct.campaignAlt}，生成完成预览`}
            reduceMotion={false}
            active={videoActive}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 to-transparent" />
          <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between p-3 text-[9px] font-semibold tracking-[0.14em] text-white/70"><span>PERFUME FILM</span><span>5S · 9:16</span></figcaption>
        </figure>
      </motion.div>
    </div>
  );
}

function StaticGenerationProgress() {
  return (
    <div data-generation-control className="w-full rounded-2xl border border-white/12 bg-black/80 px-4 py-3.5 shadow-2xl shadow-black/60">
      <div className="flex items-center justify-between gap-4 text-[11px] font-semibold tracking-[0.08em] text-white/65">
        <span className="flex items-center gap-2"><WandSparkles className="h-3.5 w-3.5 text-fuchsia-300" />Generating perfume film</span>
        <span data-generation-progress aria-label="生成进度 100%" className="tabular-nums text-white">100%</span>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full w-full rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-400 to-blue-400" /></div>
    </div>
  );
}

function AssetLibraryWindow({ reduceMotion,active }: { reduceMotion: boolean; active?: MotionValue<number> }) {
  return (
    <div data-asset-library-window className="w-full max-w-2xl overflow-hidden rounded-[1.6rem] border border-white/12 bg-[#0a0a0f]/96 shadow-[0_36px_100px_rgba(0,0,0,0.62)] backdrop-blur-2xl">
      <div className="flex h-12 items-center justify-between border-b border-white/8 px-4 sm:px-5">
        <div className="flex items-center gap-2 text-xs font-semibold text-white">
          <FolderOpen className="h-4 w-4 text-violet-300" />数字资产
        </div>
        <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">已自动入库</span>
      </div>
      <div className="grid min-h-[350px] grid-cols-[5rem_1fr] sm:grid-cols-[8rem_1fr]">
        <div className="border-r border-white/8 bg-white/[0.015] px-3 py-5 text-[10px] text-white/35 sm:px-4">
          <p className="rounded-lg bg-violet-400/10 px-2 py-2 font-semibold text-violet-200">全部资产</p>
          <p className="mt-1 px-2 py-2">AI 视频</p>
          <p className="mt-1 px-2 py-2">AI 图片</p>
        </div>
        <div className="flex min-w-0 items-center gap-4 p-4 sm:gap-6 sm:p-6">
          <div className="relative aspect-[9/16] h-[260px] flex-none overflow-hidden rounded-[1.1rem] border border-white/10 bg-black shadow-2xl sm:h-[310px]">
            <LandingCampaignMedia
              posterBase={showcaseProduct.campaignBase}
              videoSrc={showcaseProduct.campaignVideo}
              alt={`${showcaseProduct.campaignAlt}，数字资产预览`}
              reduceMotion={reduceMotion}
              active={active}
              className="h-full w-full object-cover"
            />
            <span className="absolute bottom-2 right-2 rounded-full bg-black/65 px-2 py-1 text-[9px] font-semibold text-white/70 backdrop-blur-md">00:05</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold tracking-[0.18em] text-violet-300">AI VIDEO</p>
            <h4 className="mt-3 text-lg font-bold text-white sm:text-2xl">香水暖金流光</h4>
            <p className="mt-2 text-xs leading-5 text-white/40 sm:text-sm">提示词、参考素材与生成参数已随视频保存。</p>
            <dl className="mt-5 grid gap-2 text-[10px] sm:grid-cols-2 sm:text-[11px]">
              <div className="rounded-xl bg-white/[0.04] p-3"><dt className="text-white/30">画幅</dt><dd className="mt-1 font-semibold text-white/75">9:16</dd></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><dt className="text-white/30">时长</dt><dd className="mt-1 font-semibold text-white/75">5 seconds</dd></div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

function TikTokPublishWindow({ reduceMotion,active }: { reduceMotion: boolean; active?: MotionValue<number> }) {
  return (
    <div data-tiktok-publish-window className="w-full max-w-2xl overflow-hidden rounded-[1.6rem] border border-white/12 bg-[#0a0a0f]/96 shadow-[0_36px_100px_rgba(0,0,0,0.62)] backdrop-blur-2xl">
      <div className="flex h-12 items-center justify-between border-b border-white/8 px-4 sm:px-5">
        <div className="flex items-center gap-2 text-xs font-semibold text-white">
          <Send className="h-4 w-4 text-pink-300" />TikTok Publish
        </div>
        <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">Ready</span>
      </div>
      <div className="grid gap-5 p-4 sm:grid-cols-[12rem_1fr] sm:p-6">
        <div className="relative mx-auto aspect-[9/16] h-[280px] overflow-hidden rounded-[1.1rem] border border-white/10 bg-black shadow-2xl sm:h-[330px]">
          <LandingCampaignMedia
            posterBase={showcaseProduct.campaignBase}
            videoSrc={showcaseProduct.campaignVideo}
            alt={`${showcaseProduct.campaignAlt}，TikTok 发布素材`}
            reduceMotion={reduceMotion}
            active={active}
            className="h-full w-full object-cover"
          />
          <span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-1 text-[9px] font-semibold text-white/80 backdrop-blur-md">Cover selected</span>
        </div>
        <div className="flex min-w-0 flex-col">
          <p className="text-[10px] font-bold tracking-[0.18em] text-white/35">POST DETAILS</p>
          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.035] p-3 text-xs leading-5 text-white/70">Golden light. One drop, endless glow. <span className="text-cyan-300">#beauty #aivideo</span></div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-white/30">Visibility</p><p className="mt-1.5 font-semibold text-white/75">Everyone</p></div>
            <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-white/30">Format</p><p className="mt-1.5 font-semibold text-white/75">9:16 · 5s</p></div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[10px] text-white/55"><span className="flex h-4 w-4 items-center justify-center rounded bg-cyan-300 text-[9px] font-black text-black">✓</span>AI-generated content</div>
          <div className="mt-auto flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-[#ff2d88] to-violet-600 text-xs font-bold text-white shadow-lg shadow-fuchsia-950/30">Publish</div>
        </div>
      </div>
    </div>
  );
}

function TikTokPhone({ reduceMotion,active }: { reduceMotion: boolean; active?: MotionValue<number> }) {
  const actionItems = [
    { icon: Heart,label: '24.8K' },
    { icon: MessageCircle,label: '612' },
    { icon: Bookmark,label: '3,204' },
    { icon: Share2,label: '1,186' },
  ] as const;

  return (
    <div
      data-tiktok-phone
      data-figma-node-id="2901:5295"
      className="relative aspect-[650/1321] h-full max-h-[610px] min-h-[460px] drop-shadow-[0_45px_90px_rgba(0,0,0,0.78)]"
    >
      <LandingStaticPicture
        base="/landing/iphone17pro-cosmic-orange-shell"
        alt=""
        width={650}
        height={1321}
        className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      />
      <div
        data-tiktok-phone-screen
        data-figma-node-id="2901:5307"
        className="absolute left-[5%] top-[2.082%] z-10 h-[95.836%] w-[90%] overflow-hidden bg-black"
        style={{
          borderRadius: '14.102% / 6.517%',
          clipPath: 'inset(0 round 14.102% / 6.517%)',
        }}
      >
        <LandingCampaignMedia
          posterBase={showcaseProduct.campaignBase}
          videoSrc={showcaseProduct.campaignVideo}
          alt={`${showcaseProduct.campaignAlt}，TikTok 手机预览`}
          reduceMotion={reduceMotion}
          active={active}
          className="h-full w-full object-cover"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/75" />
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-5 pt-10 text-[10px] font-semibold text-white/65">
          <span>Following</span><span className="relative text-white">For You<span className="absolute -bottom-1.5 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-white" /></span>
        </div>
        <div className="absolute right-2.5 top-[36%] z-10 flex flex-col items-center gap-3 text-white">
          <div className="relative mb-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-fuchsia-500 to-violet-700"><Sparkles className="h-4 w-4" /><span className="absolute -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#fe2c55]"><Plus className="h-2.5 w-2.5" /></span></div>
          {actionItems.map(({ icon: Icon,label }) => (
            <div key={label} className="flex flex-col items-center gap-0.5 drop-shadow-lg"><Icon className="h-6 w-6 fill-black/10" strokeWidth={2.4} /><span className="text-[8px] font-semibold">{label}</span></div>
          ))}
          <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-[#171717]/90"><Music2 className="h-4 w-4" /></div>
        </div>
        <div className="absolute bottom-13 left-3 right-12 z-10 text-white drop-shadow-lg">
          <p className="text-[11px] font-bold">@lindyson.studio</p>
          <p className="mt-1 text-[9px] leading-4">Golden light. One drop, endless glow. <span className="font-semibold">#beauty #aivideo</span></p>
          <p className="mt-2 flex items-center gap-1 text-[8px] font-medium"><Music2 className="h-3 w-3" />original sound - Lindyson Studio</p>
        </div>
        <div className="absolute inset-x-0 bottom-0 z-10 grid h-11 grid-cols-5 items-center bg-black/90 px-3 text-[7px] text-white">
          <span className="flex flex-col items-center gap-0.5"><Home className="h-4 w-4 fill-white" />Home</span>
          <span className="flex flex-col items-center gap-0.5 text-white/80"><Search className="h-4 w-4" />Discover</span>
          <span className="mx-auto flex h-5 w-9 items-center justify-center rounded-md bg-white text-black shadow-[-3px_0_0_#25f4ee,3px_0_0_#fe2c55]"><Plus className="h-3.5 w-3.5" /></span>
          <span className="flex flex-col items-center gap-0.5 text-white/80"><Inbox className="h-4 w-4" />Inbox</span>
          <span className="flex flex-col items-center gap-0.5 text-white/80"><UserRound className="h-4 w-4" />Profile</span>
        </div>
      </div>
      <div
        data-tiktok-dynamic-island
        data-figma-node-id="2901:5310"
        className="pointer-events-none absolute left-[35.769%] top-[3.596%] z-30 h-[4.088%] w-[28.462%] overflow-hidden rounded-full"
      >
        <LandingStaticPicture
          base="/landing/iphone17pro-dynamic-island"
          alt=""
          width={370}
          height={108}
          className="h-full w-full"
        />
      </div>
    </div>
  );
}

export function LandingPage({ plans,onStart,onLogin }: LandingPageProps) {
  const scrollContainerRef = useRef<HTMLElement>(null);
  const landingHeaderRef = useRef<HTMLElement>(null);
  const showcaseRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const mainPlans = [...plans]
    .filter(plan => plan.kind === 'main' && plan.status === 'active' && plan.landingVisible)
    .sort((a,b) => a.monthlyPrice - b.monthlyPrice);

  const { scrollYProgress: pageProgress } = useScroll({ container: scrollContainerRef });
  const headerSurfaceOpacity = useTransform(pageProgress,[0,0.035],[0.78,0.96]);
  const heroVisualY = useTransform(pageProgress,[0,0.2],[0,-90]);
  const heroVisualScale = useTransform(pageProgress,[0,0.2],[1,0.94]);

  const { scrollYProgress: rawShowcaseProgress } = useScroll({
    container: scrollContainerRef,
    target: showcaseRef,
    offset: ['start start','end end'],
  });
  const showcaseProgress = useSpring(rawShowcaseProgress,{ stiffness: 70,damping: 26,mass: 0.45 });
  const analysisProgress = useTransform(rawShowcaseProgress,[0.035,0.20],[0,1],{ clamp: true });
  const analysisScanY = useTransform(analysisProgress,[0,0.66],['4%','92%'],{ clamp: true });
  const analysisScanOpacity = useTransform(analysisProgress,[0,0.08,0.56,0.66],[0,1,1,0],{ clamp: true });
  const generationProgress = useTransform(showcaseProgress,[0.28,0.43],[0,1],{ clamp: true });
  const generationVideoOpacity = useTransform(showcaseProgress,[0.43,0.47],[0,1]);
  const generationProgressOpacity = useTransform(showcaseProgress,[0,0.43,0.47,1],[1,1,0,0]);
  const generationVideoActive = useTransform(showcaseProgress,[0,0.43,0.45,0.475,0.48,1],[0,0,1,1,0,0]);
  const creationWorkspaceOpacity = useTransform(showcaseProgress,[0,0.46,0.50,1],[1,1,0,0]);
  const analysisPanelOpacity = useTransform(showcaseProgress,[0,0.22,0.26,1],[1,1,0,0]);
  const generationPanelOpacity = useTransform(showcaseProgress,[0,0.22,0.26,0.46,0.50,1],[0,0,1,1,0,0]);
  const stepOneOpacity = useTransform(showcaseProgress,[0,0.22,0.26],[1,1,0]);
  const stepTwoOpacity = useTransform(showcaseProgress,[0.22,0.26,0.46,0.50],[0,1,1,0]);
  const stepThreeOpacity = useTransform(showcaseProgress,[0.46,0.50,0.64,0.68],[0,1,1,0]);
  const stepFourOpacity = useTransform(showcaseProgress,[0.64,0.68,0.80,0.84],[0,1,1,0]);
  const stepFiveOpacity = useTransform(showcaseProgress,[0.80,0.84,1],[0,1,1]);
  const stepOneY = useTransform(showcaseProgress,[0,0.22,0.26],[0,0,-22]);
  const stepTwoY = useTransform(showcaseProgress,[0.22,0.26,0.46,0.50],[22,0,0,-22]);
  const stepThreeY = useTransform(showcaseProgress,[0.46,0.50,0.64,0.68],[22,0,0,-22]);
  const stepFourY = useTransform(showcaseProgress,[0.64,0.68,0.80,0.84],[22,0,0,-22]);
  const stepFiveY = useTransform(showcaseProgress,[0.80,0.84,1],[22,0,0]);
  const stepMotion = [
    { opacity: stepOneOpacity,y: stepOneY },
    { opacity: stepTwoOpacity,y: stepTwoY },
    { opacity: stepThreeOpacity,y: stepThreeY },
    { opacity: stepFourOpacity,y: stepFourY },
    { opacity: stepFiveOpacity,y: stepFiveY },
  ] as const;

  const scrollToLandingSection = (id: string) => {
    const scrollContainer = scrollContainerRef.current;
    const landingHeader = landingHeaderRef.current;
    const target = document.getElementById(id);
    if (!scrollContainer || !landingHeader || !target) return;

    const scrollContainerRect = scrollContainer.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const targetScrollTop = scrollContainer.scrollTop
      + targetRect.top
      - scrollContainerRect.top
      - landingHeader.getBoundingClientRect().height;

    scrollContainer.scrollTo({
      top: Math.max(0,targetScrollTop),
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  };

  return (
    <main ref={scrollContainerRef} className="relative h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#050507] text-[#f6f3ee] scrollbar-gutter-stable">
      <header ref={landingHeaderRef} data-landing-header className="sticky top-0 z-50 border-b border-transparent">
        <motion.div data-header-glass style={{ opacity: headerSurfaceOpacity }} className="absolute inset-0 border-b border-white/12 bg-[#08080c]/90 shadow-[0_16px_48px_rgba(0,0,0,0.3)] backdrop-blur-2xl" />
        <div className="relative mx-auto flex h-18 w-full max-w-[1440px] items-center justify-between px-5 sm:px-8 xl:px-12">
          <button
            type="button"
            aria-label="返回首页顶部"
            onClick={() => scrollContainerRef.current?.scrollTo({ top: 0,behavior: 'smooth' })}
            className="flex items-center gap-3 text-left"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 via-violet-600 to-blue-600 shadow-[0_0_28px_rgba(168,85,247,0.32)]">
              <Sparkles className="h-5 w-5 text-white" />
            </span>
            <span data-header-brand-copy className="landing-header-brand-copy">
              <span className="block text-sm font-bold tracking-tight text-white sm:text-base">Lindyson AI</span>
              <span className="hidden text-[10px] tracking-[0.12em] text-white/40 sm:block">{LANDING_CONTENT.brandTagline}</span>
            </span>
          </button>

          <nav aria-label="首页导航" className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/[0.035] p-1 text-xs font-medium tracking-[0.08em] text-white/55 shadow-inner shadow-white/[0.03] lg:flex">
            {landingNavItems.map(item => (
              <motion.button
                key={item.target}
                type="button"
                data-nav-target={item.target}
                onClick={() => scrollToLandingSection(item.target)}
                whileHover={reduceMotion ? undefined : { y: -1 }}
                className="group relative overflow-hidden rounded-full px-3.5 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70 hover:text-white focus-visible:text-white"
              >
                <span data-nav-hover-surface className="pointer-events-none absolute inset-0 bg-gradient-to-r from-fuchsia-400/12 via-violet-400/16 to-blue-400/12 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100" />
                <span className="relative">{item.label}</span>
                <span data-nav-hover-line className="pointer-events-none absolute bottom-1 left-1/2 h-px w-5 -translate-x-1/2 scale-x-0 bg-gradient-to-r from-fuchsia-300 via-violet-300 to-blue-300 opacity-0 shadow-[0_0_10px_rgba(196,181,253,0.75)] transition-[transform,opacity] duration-300 group-hover:scale-x-100 group-hover:opacity-100 group-focus-visible:scale-x-100 group-focus-visible:opacity-100" />
              </motion.button>
            ))}
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <Button
              data-header-login
              variant="ghost"
              size="sm"
              className="landing-header-action-button landing-header-login-button"
              onClick={onLogin}
            >
              登录
            </Button>
            <Button
              data-header-start
              variant="pink"
              size="sm"
              className="landing-header-action-button landing-header-start-button"
              iconRight={<ArrowRight className="landing-header-start-icon" />}
              onClick={onStart}
            >
              开始创作
            </Button>
          </div>
        </div>
      </header>

      <section className="relative mx-auto grid min-h-[calc(100dvh-4.5rem)] w-full max-w-[1440px] items-center gap-12 px-5 pb-16 pt-10 sm:px-8 lg:grid-cols-[0.82fr_1.18fr] lg:px-12 lg:pb-12 lg:pt-4">
        <div className="relative z-20 max-w-2xl">
          <motion.p
            initial={reduceMotion ? false : { opacity: 0,y: 18 }}
            animate={{ opacity: 1,y: 0 }}
            transition={{ duration: 0.55,ease: [0.22,1,0.36,1] }}
            className="mb-5 text-[11px] font-bold tracking-[0.32em] text-violet-300"
          >
            {LANDING_CONTENT.hero.eyebrow}
          </motion.p>
          <motion.h1
            initial={reduceMotion ? false : { opacity: 0,y: 26 }}
            animate={{ opacity: 1,y: 0 }}
            transition={{ delay: 0.08,duration: 0.7,ease: [0.22,1,0.36,1] }}
            className="max-w-3xl text-[clamp(3.2rem,6.7vw,7.25rem)] font-black leading-[0.9] tracking-[-0.07em] text-[#f6f3ee]"
          >
            <span className="sr-only">{LANDING_CONTENT.hero.headline}</span>
            {LANDING_CONTENT.hero.headlineLines.map((line,index) => (
              <span
                key={line}
                aria-hidden="true"
                data-hero-headline-line={index + 1}
                className={`block whitespace-nowrap ${index === 1 ? 'bg-gradient-to-r from-[#f6f3ee] via-fuchsia-200 to-violet-400 bg-clip-text text-transparent' : ''}`}
              >
                {line}
              </span>
            ))}
          </motion.h1>
          <motion.p
            initial={reduceMotion ? false : { opacity: 0,y: 20 }}
            animate={{ opacity: 1,y: 0 }}
            transition={{ delay: 0.18,duration: 0.65,ease: [0.22,1,0.36,1] }}
            className="mt-7 max-w-lg text-base leading-7 text-white/60 sm:text-lg"
          >
            {LANDING_CONTENT.hero.description}
          </motion.p>
          <motion.div
            initial={reduceMotion ? false : { opacity: 0,y: 20 }}
            animate={{ opacity: 1,y: 0 }}
            transition={{ delay: 0.26,duration: 0.65,ease: [0.22,1,0.36,1] }}
            className="mt-8 flex flex-col gap-3 sm:flex-row"
          >
            <Button variant="pink" size="lg" className="sm:w-auto" iconRight={<ArrowRight className="h-4 w-4" />} onClick={onStart}>{LANDING_CONTENT.hero.primaryCta}</Button>
            <Button variant="secondary" size="lg" className="sm:w-auto" icon={<Play className="h-4 w-4" />} onClick={() => scrollToLandingSection('landing-showcase')}>{LANDING_CONTENT.hero.secondaryCta}</Button>
          </motion.div>
          <motion.div
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4,duration: 0.7 }}
            className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-medium tracking-[0.08em] text-white/35"
          >
            <span>SEEDANCE 2.0</span><span className="h-1 w-1 rounded-full bg-white/20" /><span>SEEDREAM 5.0 PRO</span><span className="h-1 w-1 rounded-full bg-white/20" /><span>TIKTOK</span>
          </motion.div>
        </div>

        <motion.div data-hero-visual style={reduceMotion ? undefined : { y: heroVisualY,scale: heroVisualScale }} className="relative min-h-[420px] sm:min-h-[560px] lg:min-h-[720px]">
          <div className="absolute inset-[12%] rounded-full bg-fuchsia-600/15 blur-[100px]" />
          <div className="absolute left-[26%] top-[20%] h-[44%] w-[46%] rounded-full bg-blue-600/15 blur-[90px]" />
          {LANDING_CONTENT.media.map((item,index) => {
            const layout = heroCardLayouts[index];
            return (
              <motion.figure
                key={item.id}
                initial={reduceMotion ? false : { opacity: 0,y: 42,scale: 0.94 }}
                animate={{ opacity: 1,y: 0,scale: 1 }}
                transition={{ delay: 0.14 + index * 0.1,duration: 0.78,ease: [0.22,1,0.36,1] }}
                whileHover={reduceMotion ? undefined : { y: -12,rotate: layout.rotate * 0.45,scale: 1.025 }}
                style={{ rotate: layout.rotate }}
                className={`absolute overflow-hidden rounded-[1.6rem] border border-white/15 bg-[#101016] shadow-[0_36px_100px_rgba(0,0,0,0.65)] ${layout.className}`}
              >
                <LandingCampaignMedia
                  posterBase={item.campaignBase}
                  videoSrc={item.campaignVideo}
                  alt={item.campaignAlt}
                  eager={index === 1}
                  reduceMotion={Boolean(reduceMotion)}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/10" />
                <figcaption className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
                  <p className="text-[10px] font-bold tracking-[0.22em] text-white/45">{item.category}</p>
                  <p className="mt-1 text-xs font-medium text-white/85 sm:text-sm">{item.prompt}</p>
                </figcaption>
              </motion.figure>
            );
          })}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0,scale: 0.8 }}
            animate={{ opacity: 1,scale: 1 }}
            transition={{ delay: 0.55,duration: 0.6,ease: [0.22,1,0.36,1] }}
            className="absolute bottom-[5%] left-[40%] z-40 flex items-center gap-2 rounded-full border border-white/15 bg-black/55 px-4 py-2 text-[10px] font-semibold tracking-[0.16em] text-white/70 shadow-xl backdrop-blur-xl"
          >
            <span className="h-2 w-2 rounded-full bg-fuchsia-400 shadow-[0_0_14px_rgba(232,121,249,0.95)]" />
            AI GENERATED
          </motion.div>
        </motion.div>
      </section>

      <section ref={showcaseRef} id="landing-showcase" className={`relative scroll-mt-[4.5rem] border-y border-white/[0.06] bg-[#08080c] ${reduceMotion ? '' : 'lg:h-[600vh]'}`}>
        <div className={`mx-auto px-5 py-24 sm:px-8 lg:max-w-[1440px] lg:px-12 ${reduceMotion ? 'lg:py-28' : 'lg:sticky lg:top-[4.5rem] lg:flex lg:h-[calc(100dvh-4.5rem)] lg:items-center lg:py-0'}`}>
          <div className="w-full">
            <div className="mb-12 max-w-5xl lg:mb-8 xl:mb-10">
              <p className="text-[11px] font-bold tracking-[0.32em] text-violet-300">{LANDING_CONTENT.showcase.eyebrow}</p>
              <h2 className="mt-5 text-4xl font-black leading-[1.02] tracking-[-0.045em] text-[#f6f3ee] sm:text-5xl lg:text-6xl">{LANDING_CONTENT.showcase.title}</h2>
              <p className="mt-5 max-w-xl text-sm leading-7 text-white/45 sm:text-base">{LANDING_CONTENT.showcase.description}</p>
            </div>

            <ol className="sr-only">
              {LANDING_CONTENT.showcase.steps.map(step => <li key={step.id}>{step.number} {step.title}：{step.description}</li>)}
            </ol>

            {!reduceMotion && (
              <div className="hidden grid-cols-[0.52fr_1.48fr] items-center gap-14 lg:grid xl:gap-20">
                <div aria-hidden="true" className="relative h-52">
                  {LANDING_CONTENT.showcase.steps.map((step,index) => (
                    <motion.div key={step.id} style={stepMotion[index]} className="absolute inset-0 flex flex-col justify-center">
                      <p className="text-xs font-bold tracking-[0.25em] text-fuchsia-300">{step.number}</p>
                      <h3 className="mt-4 text-5xl font-black tracking-[-0.05em] text-white">{step.title}</h3>
                      <p className="mt-4 text-base text-white/45">{step.description}</p>
                    </motion.div>
                  ))}
                  <div className="absolute -bottom-10 left-0 right-8 h-px bg-white/10">
                    <motion.div style={{ scaleX: showcaseProgress,transformOrigin: 'left' }} className="h-px bg-gradient-to-r from-fuchsia-400 via-violet-400 to-blue-400" />
                  </div>
                </div>

                <div data-showcase-stage-root className="relative h-[clamp(460px,62dvh,610px)] min-w-0">
                  <div className="pointer-events-none absolute left-1/2 top-1/2 h-[76%] w-[72%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fuchsia-700/10 blur-[90px]" />
                  <div className="pointer-events-none absolute left-[42%] top-[12%] h-[52%] w-[44%] rounded-full bg-blue-700/10 blur-[90px]" />

                  <motion.div data-creation-workspace style={{ opacity: creationWorkspaceOpacity }} className="absolute inset-0 flex items-center justify-center">
                    <div className="grid h-[88%] w-full max-w-5xl grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] items-center gap-5 xl:gap-7">
                      <figure data-showcase-product="beauty" className="relative aspect-[9/16] h-full justify-self-end overflow-hidden rounded-[1.8rem] border border-white/12 bg-black shadow-[0_38px_110px_rgba(0,0,0,0.7)]">
                        <LandingPicture base={showcaseProduct.sourceBase} alt={showcaseProduct.sourceAlt} className="h-full w-full object-cover" />
                        <motion.div data-analysis-scan-line style={{ opacity: analysisScanOpacity,top: analysisScanY }} className="pointer-events-none absolute inset-x-3 z-20 h-px bg-gradient-to-r from-transparent via-violet-200 to-transparent shadow-[0_0_18px_rgba(196,181,253,0.95)]" />
                        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/80 to-transparent" />
                        <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between p-4 text-[9px] font-semibold tracking-[0.14em] text-white/65"><span>PERFUME SOURCE</span><span>9:16</span></figcaption>
                      </figure>
                      <div data-creation-workspace-right className="relative h-[24rem] max-h-full w-full xl:h-[25rem]">
                        <motion.div data-showcase-stage="input" style={{ opacity: analysisPanelOpacity }} className="absolute inset-0">
                          <ProductAnalysisPanel progress={analysisProgress} reduceMotion={false} />
                        </motion.div>
                        <motion.div data-showcase-stage="generate" style={{ opacity: generationPanelOpacity }} className="absolute inset-0">
                          <GenerationWorkspace
                            progress={generationProgress}
                            progressOpacity={generationProgressOpacity}
                            videoOpacity={generationVideoOpacity}
                            videoActive={generationVideoActive}
                          />
                        </motion.div>
                      </div>
                    </div>
                  </motion.div>

                  <motion.div data-showcase-stage="library" style={stepMotion[2]} className="absolute inset-0 flex items-center justify-center">
                    <AssetLibraryWindow reduceMotion={false} active={stepThreeOpacity} />
                  </motion.div>

                  <motion.div data-showcase-stage="publish" style={stepMotion[3]} className="absolute inset-0 flex items-center justify-center">
                    <TikTokPublishWindow reduceMotion={false} active={stepFourOpacity} />
                  </motion.div>

                  <motion.div data-showcase-stage="preview" style={stepMotion[4]} className="absolute inset-0 flex items-center justify-center">
                    <TikTokPhone reduceMotion={false} active={stepFiveOpacity} />
                  </motion.div>
                </div>
              </div>
            )}

            <div className={`space-y-2 ${reduceMotion ? '' : 'lg:hidden'}`}>
              {LANDING_CONTENT.showcase.steps.map((step,index) => (
                <article key={step.id} data-showcase-mobile-stage={step.id} className="border-t border-white/10 py-8 first:border-t-0 first:pt-0">
                  <div className="flex items-start gap-4"><span className="text-xs font-bold tracking-[0.2em] text-fuchsia-300">{step.number}</span><div><h3 className="text-xl font-bold text-white">{step.title}</h3><p className="mt-2 text-sm text-white/45">{step.description}</p></div></div>
                  {index === 0 && (
                    <div className="mt-6 grid gap-5 md:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] md:items-center">
                      <div className="mx-auto aspect-[9/16] w-full max-w-[13rem] overflow-hidden rounded-[1.5rem] border border-white/10 bg-black shadow-2xl md:max-w-[15rem]">
                        <LandingPicture base={showcaseProduct.sourceBase} alt={showcaseProduct.sourceAlt} className="h-full w-full object-cover" />
                      </div>
                      <ProductAnalysisPanel reduceMotion />
                    </div>
                  )}
                  {index === 1 && (
                    <div className="mx-auto mt-6 max-w-md">
                      <div className="mx-auto aspect-[9/16] w-full max-w-[13rem] overflow-hidden rounded-[1.5rem] border border-white/10 bg-black shadow-2xl">
                        <LandingCampaignMedia
                          posterBase={showcaseProduct.campaignBase}
                          videoSrc={showcaseProduct.campaignVideo}
                          alt={`${showcaseProduct.campaignAlt}，生成完成预览`}
                          reduceMotion={Boolean(reduceMotion)}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="mt-4"><StaticGenerationProgress /></div>
                    </div>
                  )}
                  {index === 2 && <div className="mt-6"><AssetLibraryWindow reduceMotion={Boolean(reduceMotion)} /></div>}
                  {index === 3 && <div className="mt-6"><TikTokPublishWindow reduceMotion={Boolean(reduceMotion)} /></div>}
                  {index === 4 && <div className="mt-6 flex h-[610px] justify-center"><TikTokPhone reduceMotion={Boolean(reduceMotion)} /></div>}
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="landing-capabilities" className="relative mx-auto w-full max-w-[1440px] scroll-mt-[4.5rem] px-5 py-28 sm:px-8 lg:px-12 lg:py-36">
        <div className="max-w-none">
          <p className="text-[11px] font-bold tracking-[0.32em] text-blue-300">{LANDING_CONTENT.capabilities.eyebrow}</p>
          <h2 data-capabilities-title className="mt-5 text-4xl font-black leading-[1.02] tracking-[-0.045em] text-[#f6f3ee] sm:text-5xl md:whitespace-nowrap lg:text-6xl">{LANDING_CONTENT.capabilities.title}</h2>
        </div>
        <div className="mt-14 grid gap-4 lg:grid-cols-3">
          {LANDING_CONTENT.capabilities.items.map((capability,index) => <CapabilityCard key={capability.id} capability={capability} index={index} reduceMotion={Boolean(reduceMotion)} />)}
        </div>
      </section>

      {mainPlans.length > 0 && (
        <section id="landing-pricing" className="scroll-mt-[4.5rem] border-y border-white/[0.06] bg-[#08080c] px-5 py-28 sm:px-8 lg:py-36">
          <div className="mx-auto w-full max-w-[1440px]">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-[11px] font-bold tracking-[0.32em] text-fuchsia-300">{LANDING_CONTENT.pricing.eyebrow}</p>
              <h2 className="mt-5 text-4xl font-black tracking-[-0.045em] text-[#f6f3ee] sm:text-5xl">{LANDING_CONTENT.pricing.title}</h2>
              <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-white/45">{LANDING_CONTENT.pricing.description}</p>
            </div>
            <div className="mt-14 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {mainPlans.map(plan => (
                <motion.div
                  key={plan.id}
                  className="h-full"
                  whileHover={reduceMotion ? undefined : { y: -6 }}
                  transition={{ duration: 0.28,ease: [0.22,1,0.36,1] }}
                >
                  <PlanCard
                    plan={plan}
                    price={plan.monthlyPrice}
                    priceHelper={plan.monthlyPrice <= 0 ? '注册后开始创作' : '按月计费'}
                    featureLimit={5}
                    actionLabel={plan.ctaLabel}
                    onAction={onStart}
                  />
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section id="landing-faq" className="mx-auto w-full max-w-5xl scroll-mt-[4.5rem] px-5 py-28 sm:px-8 lg:py-36">
        <div className="text-center">
          <p className="text-[11px] font-bold tracking-[0.32em] text-blue-300">FAQ</p>
          <h2 className="mt-5 text-4xl font-black tracking-[-0.045em] text-[#f6f3ee] sm:text-5xl">开始之前，了解这些。</h2>
        </div>
        <div className="mt-12 divide-y divide-white/10 border-y border-white/10">
          {LANDING_CONTENT.faqs.map(item => (
            <details key={item.question} className="group py-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-left text-base font-bold text-white marker:hidden sm:text-lg">
                {item.question}
                <ChevronDown className="h-5 w-5 flex-none text-white/35 transition-transform duration-300 group-open:rotate-180" />
              </summary>
              <p className="max-w-3xl pb-7 pr-10 text-sm leading-7 text-white/50">{item.answer}</p>
            </details>
          ))}
        </div>

        <div className="relative mt-24 overflow-hidden rounded-[2rem] border border-white/10 bg-[#0d0d13] px-6 py-16 text-center sm:px-12 sm:py-20">
          <div className="absolute left-1/2 top-0 h-56 w-[70%] -translate-x-1/2 rounded-full bg-fuchsia-500/15 blur-[100px]" />
          <Clapperboard className="relative mx-auto h-8 w-8 text-fuchsia-300" />
          <h2 className="relative mt-6 text-4xl font-black tracking-[-0.05em] text-[#f6f3ee] sm:text-5xl">{LANDING_CONTENT.finalCta.title}</h2>
          <p className="relative mx-auto mt-4 max-w-xl text-sm leading-7 text-white/50">{LANDING_CONTENT.finalCta.description}</p>
          <Button variant="pink" size="lg" className="relative mx-auto mt-8 sm:w-auto" iconRight={<ArrowRight className="h-4 w-4" />} onClick={onStart}>{LANDING_CONTENT.finalCta.cta}</Button>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] px-5 py-8 sm:px-8">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-between gap-5 text-center text-xs text-white/35 sm:flex-row sm:text-left">
          <div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-600"><Sparkles className="h-4 w-4 text-white" /></span><span className="font-semibold text-white/65">Lindyson AI</span></div>
          <div className="flex items-center gap-5"><a href="/terms" className="transition-colors hover:text-white">服务条款</a><a href="/policy" className="transition-colors hover:text-white">隐私政策</a></div>
          <div className="space-y-1"><PublicComplianceNotice /><p>© 2026 Lindyson All Rights Reserved</p></div>
        </div>
      </footer>
    </main>
  );
}
