import { forwardRef,type HTMLAttributes,type ReactNode } from 'react';

export type AppPageWidth = 'standard' | 'wide' | 'workspace';

interface AppPageProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  width?: AppPageWidth;
  padded?: boolean;
}

const WIDTH_CLASSES: Record<AppPageWidth, string> = {
  standard: 'max-w-[1280px]',
  wide: 'max-w-[1600px]',
  workspace: 'max-w-none',
};

export const AppPage = forwardRef<HTMLDivElement, AppPageProps>(function AppPage({
  children,
  width = 'standard',
  padded = true,
  className = '',
  ...props
}, ref) {
  return (
    <div
      ref={ref}
      data-app-page="true"
      {...props}
      className={`relative mx-auto min-h-full w-full ${WIDTH_CLASSES[width]} ${padded ? 'px-4 py-5 sm:px-6 sm:py-6 xl:px-8 xl:py-8' : ''} ${className}`}
    >
      {children}
    </div>
  );
});
