import { ArrowUpRight } from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode } from 'react';
import type { CardAccent } from './Card';

interface StatCardProps {
  label: string;
  value: string | number;
  change?: string;
  changePositive?: boolean;
  icon: ReactNode;
  gradient: string;
  delay?: number;
  tone?: 'legacy' | 'product';
  accent?: Exclude<CardAccent, 'none' | 'warm'>;
}

export function StatCard({ label, value, change, changePositive = true, icon, gradient, delay = 0, tone = 'legacy', accent = 'violet' }: StatCardProps) {
  const product = tone === 'product';
  return (
    <motion.div
      initial={product ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: product ? 0.24 : 0.4, delay: product ? Math.min(delay, 0.06) : delay, ease: product ? [0.22, 1, 0.36, 1] : undefined }}
      data-ui={product ? 'card' : undefined}
      data-variant={product ? 'raised' : undefined}
      data-accent={product ? accent : undefined}
      className={product
        ? 'relative overflow-hidden rounded-2xl border border-[var(--product-border-subtle)] bg-[var(--product-surface-card)] p-4'
        : 'rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl transition-all hover:border-white/20'}
    >
      <div className={product ? "absolute right-4 top-4" : "flex items-start justify-between mb-3"}>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${product ? 'product-card-accent-icon border shadow-lg shadow-black/20' : `bg-gradient-to-br ${gradient}`}`}>
          {icon}
        </div>
        {change && (
          <span className={`text-xs flex items-center gap-0.5 ${changePositive ? 'text-green-400' : 'text-red-400'}`}>
            <ArrowUpRight className="w-3 h-3" />{change}
          </span>
        )}
      </div>
      <p data-ui={product ? 'stat-card-value' : undefined} className={`${product ? 'pr-11 text-[1.75rem] font-semibold tracking-[-0.035em] text-[var(--product-text-primary)]' : 'text-2xl font-bold text-white'} tabular-nums`}>{value}</p>
      <p className={`${product ? 'text-[var(--product-text-secondary)]' : 'text-gray-400'} mt-1 text-xs`}>{label}</p>
    </motion.div>
  );
}
