import { useCallback,useEffect,useRef,useState } from 'react';
import {
  APP_UPDATE_CHECK_INTERVAL_MS,
  fetchAppVersionManifest,
  hasAppUpdate,
} from './appVersion';

const CURRENT_BUILD_ID = __LINDYSON_BUILD_ID__;

export function useAppUpdate(enabled: boolean) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const checkingRef = useRef(false);

  const checkForUpdate = useCallback(async () => {
    if (!enabled || checkingRef.current) return;

    checkingRef.current = true;
    try {
      const remoteVersion = await fetchAppVersionManifest(CURRENT_BUILD_ID, window.fetch.bind(window));
      if (hasAppUpdate(CURRENT_BUILD_ID, remoteVersion)) setUpdateAvailable(true);
    } finally {
      checkingRef.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setUpdateAvailable(false);
      return;
    }

    void checkForUpdate();

    const intervalId = window.setInterval(() => void checkForUpdate(), APP_UPDATE_CHECK_INTERVAL_MS);
    const handleFocus = () => void checkForUpdate();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkForUpdate();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkForUpdate, enabled]);

  return {
    updateAvailable,
    refreshToUpdate: () => window.location.reload(),
  };
}
