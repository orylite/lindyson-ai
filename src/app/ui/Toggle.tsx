import { useId } from 'react';

interface ToggleProps {
  enabled: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  error?: string;
  ariaLabel?: string;
}

export function Toggle({ enabled, onChange, label, size = 'md', disabled = false, error, ariaLabel }: ToggleProps) {
  const descriptionId = useId();
  const track = size === 'sm' ? 'w-8 h-5' : 'w-10 h-6';
  const thumb = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  const shift = size === 'sm' ? 'translate-x-3' : 'translate-x-4';

  const btn = (
    <button
      data-ui="toggle"
      data-state={enabled ? 'on' : 'off'}
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel ?? label ?? '切换开关'}
      aria-invalid={Boolean(error)}
      aria-describedby={error ? descriptionId : undefined}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex ${track} rounded-full flex-shrink-0 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f1e] disabled:cursor-not-allowed disabled:opacity-50 ${enabled ? 'bg-purple-600' : 'bg-gray-600'}`}
    >
      <span className={`absolute top-1 left-1 ${thumb} bg-white rounded-full shadow transform transition-transform duration-200 ${enabled ? shift : 'translate-x-0'}`} />
    </button>
  );

  if (!label && !error) return btn;

  if (!label) {
    return (
      <div>
        {btn}
        {error && <p id={descriptionId} role="alert" className="mt-1 text-xs text-red-300">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-gray-300">{label}</span>
        {btn}
      </div>
      {error && <p id={descriptionId} role="alert" className="mt-1 text-xs text-red-300">{error}</p>}
    </div>
  );
}
