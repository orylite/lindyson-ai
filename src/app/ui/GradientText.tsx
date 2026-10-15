import { type ReactNode } from 'react';

type GradientPreset = 'primary' | 'pink' | 'cyan';

const PRESETS: Record<GradientPreset, string> = {
  primary: 'from-purple-400 to-blue-400',
  pink:    'from-pink-400 to-purple-400',
  cyan:    'from-blue-400 to-cyan-400',
};

interface GradientTextProps {
  children: ReactNode;
  preset?: GradientPreset;
  custom?: string;
  className?: string;
  as?: 'h1' | 'h2' | 'h3' | 'span' | 'p';
}

export function GradientText({ children, preset = 'primary', custom, className = '', as: Tag = 'span' }: GradientTextProps) {
  const gradient = custom ?? PRESETS[preset];
  return (
    <Tag className={`bg-gradient-to-r ${gradient} bg-clip-text text-transparent ${className}`}>
      {children}
    </Tag>
  );
}
