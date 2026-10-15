import { useId,type InputHTMLAttributes,type ReactNode,type TextareaHTMLAttributes } from 'react';

type InputVariant = 'default' | 'ghost';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: ReactNode;
  suffix?: ReactNode;
  variant?: InputVariant;
}

const BASE = 'w-full bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 transition-colors';

export function Input({ label, hint, error, icon, suffix, variant = 'default', className = '', ...props }: InputProps) {
  const generatedId = useId();
  const inputId = props.id ?? generatedId;

  return (
    <div className="space-y-1.5">
      {label && <label htmlFor={inputId} className="text-xs text-gray-400 block">{label}</label>}
      <div className="relative">
        {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">{icon}</span>}
        <input
          {...props}
          data-ui="control"
          id={inputId}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error || hint ? `${inputId}-description` : undefined}
          className={`
            ${BASE} rounded-xl px-3 py-2.5
            ${icon ? 'pl-9' : ''}
            ${suffix ? 'pr-16' : ''}
            ${error ? 'border-red-500/50' : ''}
            ${className}
          `}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">{suffix}</span>
        )}
      </div>
      {hint && !error && <p id={`${inputId}-description`} className="text-xs text-gray-400">{hint}</p>}
      {error && <p id={`${inputId}-description`} role="alert" className="text-xs text-red-300">{error}</p>}
    </div>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  counter?: { current: number; max: number };
  labelRight?: ReactNode;
}

export function Textarea({ label, hint, error, counter, labelRight, className = '', ...props }: TextareaProps) {
  const generatedId = useId();
  const textareaId = props.id ?? generatedId;

  return (
    <div className="space-y-1.5">
      {(label || labelRight) && (
        <div className="flex items-center justify-between">
          {label && <label htmlFor={textareaId} className="text-xs text-gray-400">{label}</label>}
          {labelRight && <span>{labelRight}</span>}
        </div>
      )}
      <div className="relative">
        <textarea
          {...props}
          data-ui="control"
          id={textareaId}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error || hint ? `${textareaId}-description` : undefined}
          className={`
            ${BASE} rounded-xl px-3 py-2.5 resize-none
            ${error ? 'border-red-500/50' : ''}
            ${counter ? 'pb-6' : ''}
            ${className}
          `}
        />
        {counter && (
          <span className="absolute right-3 bottom-2 text-xs text-gray-500">
            {counter.current} / {counter.max}
          </span>
        )}
      </div>
      {hint && !error && <p id={`${textareaId}-description`} className="text-xs text-gray-400">{hint}</p>}
      {error && <p id={`${textareaId}-description`} role="alert" className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
