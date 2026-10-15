import type { Asset, AssetReferenceAsset, AssetReferenceImage } from '../data/assets';

export function getAssetThumbnailUrl(asset: Pick<Asset, 'type' | 'thumbnail' | 'thumbnailUrl' | 'publicUrl'>) {
  const thumbnailUrl = asset.thumbnailUrl ?? asset.thumbnail;

  if (asset.type === 'video') {
    return getUsableVideoThumbnailUrl(thumbnailUrl, asset.publicUrl);
  }

  if (asset.type === 'audio') return undefined;

  // 卡片视图只能使用专用缩略图。缺失或解码失败时由 AssetThumbnail
  // 展示固定占位图，不能回退加载尺寸不受控的原图。
  return thumbnailUrl || undefined;
}

export function getImagePreviewUrl(asset: Pick<Asset, 'publicUrl' | 'thumbnailUrl' | 'thumbnail'>) {
  return asset.publicUrl ?? asset.thumbnailUrl ?? asset.thumbnail;
}

export function getVideoPosterUrl(asset: Pick<Asset, 'type' | 'thumbnail' | 'thumbnailUrl' | 'publicUrl'>) {
  return getAssetThumbnailUrl(asset);
}

export function getReferenceThumbnailUrl(reference: AssetReferenceImage | AssetReferenceAsset) {
  const thumbnailUrl = reference.thumbnailUrl ?? reference.thumbnail;

  if ('type' in reference && reference.type === 'video') {
    return getUsableVideoThumbnailUrl(thumbnailUrl, reference.publicUrl);
  }

  if ('type' in reference && reference.type === 'audio') return undefined;

  return thumbnailUrl || reference.publicUrl;
}

export function getAssetPreviewAspectRatio(asset: Pick<Asset, 'type' | 'dimensions' | 'generation'>) {
  if (asset.generation?.kind === 'video') {
    if (asset.generation.aspectRatio === 'adaptive') {
      return asset.dimensions ? dimensionsToCssAspect(asset.dimensions) : null;
    }
    return ratioToCssAspect(asset.generation.aspectRatio);
  }
  if (asset.generation?.kind === 'image') return ratioToCssAspect(asset.generation.ratio);
  if (asset.dimensions) return dimensionsToCssAspect(asset.dimensions);
  return asset.type === 'video' ? '16 / 9' : null;
}

export function getAspectRatioValue(ratio: string) {
  const [width, height] = ratio.split('/').map(value => Number(value.trim()));
  if (!width || !height) return 1;
  return width / height;
}

export function isLikelyVideoUrl(url: string) {
  return /\.(mp4|mov|m4v|webm|avi|mkv)(?:$|[?#])/i.test(url);
}

function getUsableVideoThumbnailUrl(thumbnailUrl: string | undefined, publicUrl: string | undefined) {
  if (!thumbnailUrl || thumbnailUrl === publicUrl || isLikelyVideoUrl(thumbnailUrl)) return undefined;
  return thumbnailUrl;
}

function ratioToCssAspect(ratio: string) {
  const [width, height] = ratio.split(':').map(Number);
  if (!width || !height) return '1 / 1';
  return `${width} / ${height}`;
}

function dimensionsToCssAspect(dimensions: string) {
  const match = dimensions.match(/(\d+)\s*[×x]\s*(\d+)/i);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return null;
  return `${width} / ${height}`;
}
