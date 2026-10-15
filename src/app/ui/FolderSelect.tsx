import { Select,type SelectOption } from './Select';

interface FolderSelectProps {
  label?: string;
  value: string;
  options: Array<SelectOption<string>>;
  onChange: (value: string) => void;
  placeholder?: string;
  size?: 'sm' | 'md';
  maxVisibleOptions?: number;
  className?: string;
  disabled?: boolean;
}

/** 文件夹选择统一使用共享深色组合框，保持键盘、读屏和移动端交互一致。 */
export function FolderSelect({
  label,
  value,
  options,
  onChange,
  placeholder = '选择文件夹',
  size = 'md',
  maxVisibleOptions = 5,
  className = '',
  disabled = false,
}: FolderSelectProps) {
  const hasCurrentValue = options.some(option => option.value === value);
  const normalizedOptions = hasCurrentValue
    ? options
    : [{ value: '', label: placeholder, disabled: true }, ...options];

  return (
    <Select
      label={label}
      value={hasCurrentValue ? value : ''}
      options={normalizedOptions}
      onValueChange={onChange}
      size={size}
      maxVisibleOptions={maxVisibleOptions}
      touchTarget
      containerClassName={className}
      disabled={disabled}
      aria-label={label ?? placeholder}
    />
  );
}
