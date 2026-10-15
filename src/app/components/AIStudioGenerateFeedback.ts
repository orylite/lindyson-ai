import { useCallback,useEffect,useRef,useState } from 'react';

export type AIStudioGenerateStatus = 'idle' | 'submitting' | 'queued';

interface AIStudioGenerateFeedbackControllerOptions {
  confirmationDurationMs?: number;
  onStatusChange: (status: AIStudioGenerateStatus) => void;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface AIStudioGenerateFeedbackController {
  isLocked: () => boolean;
  isDisposed: () => boolean;
  run: (submit: () => Promise<boolean>) => Promise<boolean>;
  dispose: () => void;
}

export function createAIStudioGenerateFeedbackController({
  confirmationDurationMs = 800,
  onStatusChange,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = timer => clearTimeout(timer),
}: AIStudioGenerateFeedbackControllerOptions): AIStudioGenerateFeedbackController {
  let locked = false;
  let disposed = false;
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  const setStatus = (status: AIStudioGenerateStatus) => {
    if (!disposed) onStatusChange(status);
  };

  const release = () => {
    locked = false;
    resetTimer = null;
    setStatus('idle');
  };

  return {
    isLocked: () => locked,
    isDisposed: () => disposed,
    run: async submit => {
      if (locked || disposed) return false;

      locked = true;
      setStatus('submitting');
      try {
        const queued = await submit();
        if (disposed) return false;
        if (!queued) {
          release();
          return false;
        }

        setStatus('queued');
        resetTimer = setTimer(release, confirmationDurationMs);
        return true;
      } catch (error) {
        release();
        throw error;
      }
    },
    dispose: () => {
      disposed = true;
      locked = false;
      if (resetTimer !== null) clearTimer(resetTimer);
      resetTimer = null;
    },
  };
}

export function useAIStudioGenerateFeedback(confirmationDurationMs = 800) {
  const [status, setStatus] = useState<AIStudioGenerateStatus>('idle');
  const controllerRef = useRef<AIStudioGenerateFeedbackController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = createAIStudioGenerateFeedbackController({
      confirmationDurationMs,
      onStatusChange: setStatus,
    });
  }

  useEffect(() => {
    if (controllerRef.current?.isDisposed()) {
      controllerRef.current = createAIStudioGenerateFeedbackController({
        confirmationDurationMs,
        onStatusChange: setStatus,
      });
    }
    return () => controllerRef.current?.dispose();
  }, [confirmationDurationMs]);

  const run = useCallback((submit: () => Promise<boolean>) => (
    controllerRef.current?.run(submit) ?? Promise.resolve(false)
  ), []);

  return {
    status,
    isLocked: controllerRef.current.isLocked,
    run,
  };
}
