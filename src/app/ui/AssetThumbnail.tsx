import { Image as ImageIcon, Music2, Video } from 'lucide-react';
import { useState } from 'react';
import type { Asset } from '../data/assets';
import { getAssetThumbnailUrl } from '../utils/assetPreview';

interface AssetThumbnailProps {
  asset: Pick<Asset, 'name' | 'type' | 'thumbnail' | 'thumbnailUrl' | 'publicUrl'>;
  className?: string;
  imageClassName?: string;
  iconClassName?: string;
  /** 卡片已经通过按钮名称描述素材时，缩略图应作为装饰，避免读屏重复朗读。 */
  decorative?: boolean;
  alt?: string;
}

export function AssetThumbnail({
  asset,
  className = 'h-full w-full',
  imageClassName = 'object-cover',
  iconClassName = 'h-8 w-8 opacity-80',
  decorative = false,
  alt,
}: AssetThumbnailProps) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const candidateUrl = getAssetThumbnailUrl(asset);
  const thumbnailUrl = candidateUrl === failedUrl ? undefined : candidateUrl;

  if (thumbnailUrl) {
    return (
      <img
        src={thumbnailUrl}
        alt={decorative ? '' : alt ?? asset.name}
        className={[className, imageClassName].filter(Boolean).join(' ')}
        onError={() => setFailedUrl(candidateUrl)}
      />
    );
  }

  const Icon = asset.type === 'video' ? Video : asset.type === 'audio' ? Music2 : ImageIcon;

  return (
    <div
      data-ui="asset-thumbnail-fallback"
      aria-hidden={decorative || undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : alt ?? asset.name}
      className={[className, 'flex items-center justify-center bg-gradient-to-br from-[#171729] via-[#10101d] to-[#221436] text-purple-300'].filter(Boolean).join(' ')}
    >
      <Icon className={iconClassName} />
    </div>
  );
}
