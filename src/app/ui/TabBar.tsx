import { useRef,type KeyboardEvent,type ReactNode } from 'react';

interface Tab<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
}

type TabVariant = 'pill' | 'segment';
type TabTone = 'legacy' | 'product';

interface TabBarProps<T extends string> {
  tabs: Tab<T>[];
  active: T;
  onChange: (id: T) => void;
  variant?: TabVariant;
  tone?: TabTone;
  gradient?: string;
  className?: string;
  ariaLabel?: string;
}

export function TabBar<T extends string>({ tabs, active, onChange, variant = 'pill', tone = 'legacy', gradient = 'from-purple-600 to-blue-600', className = '', ariaLabel = '内容分区' }: TabBarProps<T>) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const product = tone === 'product';
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    if (!next) return;
    onChange(next.id);
    tabRefs.current[nextIndex]?.focus();
  };

  if (variant === 'segment') {
    return (
      <div data-ui="tab-bar" data-tone={tone} role="tablist" aria-label={ariaLabel} className={`flex gap-1 rounded-xl border p-1 ${product ? 'border-[var(--product-border-subtle)] bg-[var(--product-surface-inset)]' : 'border-white/10 bg-white/5'} ${className}`}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={node => { tabRefs.current[index] = node; }}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={event => handleKeyDown(event, index)}
            data-ui="tab"
            data-state={active === tab.id ? 'active' : 'inactive'}
            className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-[var(--motion-standard)] ease-[var(--motion-product-ease)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
              active === tab.id
                ? product ? 'border border-white/10 bg-white/10 text-white shadow-sm shadow-black/20' : `bg-gradient-to-r ${gradient} text-white`
                : product ? 'border border-transparent text-[var(--product-text-secondary)] hover:bg-white/[0.045] hover:text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            {tab.icon}<span>{tab.label}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div data-ui="tab-bar" data-tone={tone} role="tablist" aria-label={ariaLabel} className={`flex gap-1 ${product ? 'rounded-xl border border-[var(--product-border-subtle)] bg-[var(--product-surface-inset)] p-1' : ''} ${className}`}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={node => { tabRefs.current[index] = node; }}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={event => handleKeyDown(event, index)}
          data-ui="tab"
          data-state={active === tab.id ? 'active' : 'inactive'}
          className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-[var(--motion-standard)] ease-[var(--motion-product-ease)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
            active === tab.id
              ? product ? 'bg-white/10 text-white shadow-sm shadow-black/20' : 'bg-purple-600 text-white'
              : product ? 'text-[var(--product-text-secondary)] hover:bg-white/[0.045] hover:text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
          }`}
        >
          {tab.icon}<span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
