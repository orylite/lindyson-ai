import { Sparkles } from 'lucide-react';

interface LoadingStateProps {
  variant?: 'fullscreen' | 'panel';
  label?: string;
}

export function LoadingState({ variant = 'panel', label = '正在加载' }: LoadingStateProps) {
  const isFullscreen = variant === 'fullscreen';

  return (
    <div data-ui="loading-state" className={isFullscreen ? 'flex min-h-screen items-center justify-center p-6' : 'p-6'}>
      <div data-ui="loading-panel" className={`
        ${isFullscreen ? 'mx-auto w-full max-w-sm p-7 text-center' : 'w-full rounded-2xl p-6'}
        relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl
      `}>
        <div data-ui="loading-ambient" className="absolute inset-0 bg-gradient-to-r from-purple-600/10 via-pink-600/10 to-blue-600/10" />

        <div className={isFullscreen ? 'relative flex flex-col items-center' : 'relative flex items-center gap-4'}>
          <div className="relative flex h-14 w-14 flex-shrink-0 items-center justify-center">
            <div data-ui="loading-glow" className="absolute inset-0 rounded-2xl bg-gradient-to-r from-pink-600 via-purple-600 to-blue-600 opacity-70 blur-md animate-pulse" />
            <div className="absolute inset-0 rounded-2xl border border-white/20" />
            <div className="absolute inset-0 rounded-2xl border-2 border-transparent border-t-white/70 animate-spin" />
            <div data-ui="loading-icon" className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-blue-600 shadow-lg shadow-purple-500/20">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
          </div>

          <div className={isFullscreen ? 'mt-5 w-full' : 'min-w-0 flex-1'}>
            <p className="text-sm font-semibold text-white">
              {label}
              <span className="inline-flex w-5 justify-start">
                <span className="animate-pulse">.</span>
                <span className="animate-pulse delay-150">.</span>
                <span className="animate-pulse delay-300">.</span>
              </span>
            </p>
            <div className={isFullscreen ? 'mx-auto mt-4 h-1.5 w-36 overflow-hidden rounded-full bg-white/10' : 'mt-3 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/10'}>
              <div data-ui="loading-progress" className="h-full w-1/2 rounded-full bg-gradient-to-r from-pink-600 to-purple-600 animate-[loading-progress_1.35s_ease-in-out_infinite]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
