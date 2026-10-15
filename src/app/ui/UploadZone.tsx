import { Plus } from 'lucide-react';
import { type ReactNode,useRef } from 'react';

interface UploadZoneProps {
  onFiles?: (files: File[]) => void;
  onClick?: () => void;
  accept?: string;
  multiple?: boolean;
  height?: string;
  icon?: ReactNode;
  title?: string;
  subtitle?: string;
  className?: string;
  children?: ReactNode;
}

export function UploadZone({
  onFiles,
  onClick,
  accept = 'image/*,video/*',
  multiple = false,
  height = 'h-36',
  icon,
  title = '点击上传文件',
  subtitle,
  className = '',
  children,
}: UploadZoneProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    if (onClick) { onClick(); return; }
    fileRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length && onFiles) onFiles(files);
  };

  return (
    <button
      type="button"
      data-ui="button"
      data-variant="secondary"
      onClick={handleClick}
      className={`
        w-full flex flex-col items-center justify-center gap-3
        border-2 border-dashed border-white/15 rounded-xl
        hover:border-purple-500/40 hover:bg-white/5
        transition-all group ${height} ${className}
      `}
    >
      {onFiles && <input ref={fileRef} type="file" accept={accept} multiple={multiple} className="hidden" onChange={handleChange} />}
      {children ?? (
        <>
          <div className="w-9 h-9 rounded-xl bg-white/10 group-hover:bg-purple-500/20 flex items-center justify-center transition-colors">
            {icon ?? <Plus className="w-5 h-5 text-gray-400 group-hover:text-purple-400 transition-colors" />}
          </div>
          <div className="text-center px-4">
            <p className="text-sm font-medium text-white">{title}</p>
            {subtitle && <p className="text-xs text-gray-500 mt-1 leading-relaxed">{subtitle}</p>}
          </div>
        </>
      )}
    </button>
  );
}
