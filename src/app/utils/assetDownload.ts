import type { Asset } from '../data/assets';
import type { EndpointResponse } from '@lindyson/api-contracts';
import { requestAdminAssetDownload,requestAssetDownload } from '../api/mutations';

export interface DownloadableAsset {
  id?: string | null;
  name: string;
  type?: Asset['type'];
}

export type AssetDownloadResult = EndpointResponse<'assetDownloadRequest'>['download'];
export type AdminAssetDownloadResult = EndpointResponse<'adminAssetDownload'>['download'];
export type BrowserDownloadResult = Pick<AssetDownloadResult, 'url' | 'filename'> & {
  downloadRequestedAt?: AssetDownloadResult['downloadRequestedAt'];
};

export async function prepareAssetDownload(asset: DownloadableAsset): Promise<AssetDownloadResult | null> {
  if (!asset.id) return null;
  return requestAssetDownload(asset.id);
}

export async function prepareAdminAssetDownload(asset: DownloadableAsset): Promise<AdminAssetDownloadResult | null> {
  if (!asset.id) return null;
  return requestAdminAssetDownload(asset.id);
}

export function startBrowserDownload(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function downloadAdminAsset(asset: DownloadableAsset): Promise<AdminAssetDownloadResult | null> {
  const download = await prepareAdminAssetDownload(asset);
  if (!download) return null;
  startBrowserDownload(download.url, download.filename);
  return download;
}
