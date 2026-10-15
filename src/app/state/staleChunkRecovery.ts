export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function recoverFromStaleChunk(
  storage: SessionStorageLike,
  buildId: string,
  reload: () => void,
) {
  const recoveryKey = `lindyson:stale-chunk-recovery:${buildId}`;

  try {
    if (storage.getItem(recoveryKey) === '1') return false;
    storage.setItem(recoveryKey, '1');
    reload();
    return true;
  } catch {
    return false;
  }
}
