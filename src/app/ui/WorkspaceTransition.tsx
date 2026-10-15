import { Suspense, useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { LoadingState } from './LoadingState';

interface WorkspaceTransitionProps {
  navigationKey: string;
  children: ReactNode;
}

export function WorkspaceTransition({ navigationKey, children }: WorkspaceTransitionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const previousPageRef = useRef<string | null>(null);

  const cancelAnimation = useCallback(() => {
    animationRef.current?.cancel();
    animationRef.current = null;
  }, []);

  // 导航开始即清理旧动画；页面懒加载完成后再由内容提交触发入场。
  useLayoutEffect(() => cancelAnimation, [navigationKey, cancelAnimation]);

  useLayoutEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onPreferenceChange = () => {
      if (preference.matches) cancelAnimation();
    };
    preference.addEventListener('change', onPreferenceChange);
    return () => preference.removeEventListener('change', onPreferenceChange);
  }, [cancelAnimation]);

  const onContentReady = useCallback((nextPage: string) => {
    const previousPage = previousPageRef.current;
    previousPageRef.current = nextPage;
    cancelAnimation();

    const container = containerRef.current;
    if (
      previousPage === null
      || previousPage === nextPage
      || !container
      || typeof container.animate !== 'function'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) return;

    const animation = container.animate([
      { transform: 'translateX(48px)', opacity: 0.94 },
      { transform: 'none', opacity: 1 },
    ], {
      duration: 300,
      easing: getComputedStyle(container).getPropertyValue('--motion-product-ease').trim()
        || 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'none',
    });
    animation.id = 'workspace-page-enter';
    animationRef.current = animation;
    animation.onfinish = () => {
      if (animationRef.current === animation) cancelAnimation();
    };
  }, [cancelAnimation]);

  return (
    <div ref={containerRef} data-ui="workspace-content" className="h-full overflow-auto">
      <Suspense fallback={<LoadingState />}>
        <ReadyContent navigationKey={navigationKey} onReady={onContentReady}>
          {children}
        </ReadyContent>
      </Suspense>
    </div>
  );
}

function ReadyContent({ navigationKey, onReady, children }: WorkspaceTransitionProps & {
  onReady: (navigationKey: string) => void;
}) {
  // Suspense 提交真实内容后才运行；不使用 key 重挂载页面或重置表单。
  useLayoutEffect(() => onReady(navigationKey), [navigationKey, onReady]);
  return <>{children}</>;
}
