export const APP_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export interface AppVersionManifest {
  buildId: string;
  builtAt: string;
}

export type VersionManifestFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function isAppVersionManifest(value: unknown): value is AppVersionManifest {
  if (!value || typeof value !== 'object') return false;

  const manifest = value as Record<string, unknown>;
  return typeof manifest.buildId === 'string'
    && manifest.buildId.trim().length > 0
    && typeof manifest.builtAt === 'string'
    && manifest.builtAt.trim().length > 0;
}

export function hasAppUpdate(currentBuildId: string, remoteVersion: AppVersionManifest | null) {
  return Boolean(remoteVersion && remoteVersion.buildId !== currentBuildId);
}

export async function fetchAppVersionManifest(
  currentBuildId: string,
  fetcher: VersionManifestFetcher,
): Promise<AppVersionManifest | null> {
  try {
    const query = new URLSearchParams({
      build: currentBuildId,
      t: String(Date.now()),
    });
    const response = await fetcher(`/version.json?${query.toString()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) return null;

    const manifest: unknown = await response.json();
    return isAppVersionManifest(manifest) ? manifest : null;
  } catch {
    return null;
  }
}
