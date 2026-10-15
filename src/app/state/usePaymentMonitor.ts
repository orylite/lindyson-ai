import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import type { AdminOrder } from '../data/admin';
import { isPaymentAttemptDefinitivelyFailed } from '../data/paymentState';

const QR_POLL_INTERVAL_MS = 5_000;
const POPUP_CLOSE_CHECK_MS = 500;
const POPUP_RETRY_DELAYS_MS = [0, 1_000, 2_000, 4_000] as const;
const MONITOR_MAX_LIFETIME_MS = 10 * 60 * 1_000;

export const PAYMENT_SYNC_RETRY_MESSAGE = '支付状态暂时无法确认，系统会继续自动查询。';

export type PaymentMonitorMode = 'qr' | 'popup';

export interface PaymentMonitorStatus {
  orderId: string;
  mode: PaymentMonitorMode;
  phase: 'monitoring' | 'checking-return';
  message: string | null;
}

export interface StartPaymentMonitorInput {
  orderId: string;
  mode: PaymentMonitorMode;
  paymentWindow?: Window | null;
  onPaid: (order: AdminOrder) => void | Promise<void>;
  onFailed: (order: AdminOrder) => void | Promise<void>;
  onUnconfirmed?: () => void | Promise<void>;
}

interface UsePaymentMonitorOptions {
  syncPaymentOrder: (orderId: string, options?: { signal?: AbortSignal }) => Promise<AdminOrder>;
}

interface InternalPaymentMonitorStatus extends PaymentMonitorStatus {
  runId: number;
}

interface ActiveMonitor {
  runId: number;
  controller: AbortController;
  timeoutIds: Set<number>;
  cleanups: Set<() => void>;
  activeSync: Promise<AdminOrder> | null;
}

/**
 * 支付查单的唯一计时与取消边界。
 *
 * 二维码与移动支付弹窗共用同一实例；新监控会终止旧监控，组件卸载、pagehide
 * 或账户私有状态清理时也会中止正在进行的 HTTP 请求。
 */
export function usePaymentMonitor({ syncPaymentOrder }: UsePaymentMonitorOptions) {
  const activeMonitorRef = useRef<ActiveMonitor | null>(null);
  const nextRunIdRef = useRef(0);
  const [internalStatus, setInternalStatus] = useState<InternalPaymentMonitorStatus | null>(null);

  const disposeMonitor = useCallback((monitor: ActiveMonitor) => {
    if (activeMonitorRef.current === monitor) activeMonitorRef.current = null;
    if (!monitor.controller.signal.aborted) monitor.controller.abort();
    for (const timeoutId of monitor.timeoutIds) window.clearTimeout(timeoutId);
    monitor.timeoutIds.clear();
    for (const cleanup of monitor.cleanups) cleanup();
    monitor.cleanups.clear();
    setInternalStatus(current => current?.runId === monitor.runId ? null : current);
  }, []);

  const stopPaymentMonitor = useCallback(() => {
    const monitor = activeMonitorRef.current;
    if (monitor) disposeMonitor(monitor);
  }, [disposeMonitor]);

  const startPaymentMonitor = useCallback((input: StartPaymentMonitorInput) => {
    stopPaymentMonitor();

    const monitor: ActiveMonitor = {
      runId: ++nextRunIdRef.current,
      controller: new AbortController(),
      timeoutIds: new Set(),
      cleanups: new Set(),
      activeSync: null,
    };
    activeMonitorRef.current = monitor;
    setInternalStatus({
      runId: monitor.runId,
      orderId: input.orderId,
      mode: input.mode,
      phase: 'monitoring',
      message: null,
    });

    const isCurrent = () => activeMonitorRef.current === monitor && !monitor.controller.signal.aborted;
    const schedule = (callback: () => void, delayMs: number) => {
      const timeoutId = window.setTimeout(() => {
        monitor.timeoutIds.delete(timeoutId);
        if (isCurrent()) callback();
      }, delayMs);
      monitor.timeoutIds.add(timeoutId);
    };
    const finish = () => {
      if (isCurrent()) disposeMonitor(monitor);
    };
    const invoke = (callback: (() => void | Promise<void>) | undefined) => {
      if (!callback) return;
      void Promise.resolve().then(callback).catch(() => undefined);
    };
    const syncOnce = () => {
      if (monitor.activeSync) return monitor.activeSync;
      const request = syncPaymentOrder(input.orderId, { signal: monitor.controller.signal });
      monitor.activeSync = request;
      void request.finally(() => {
        if (monitor.activeSync === request) monitor.activeSync = null;
      }).catch(() => undefined);
      return request;
    };
    const resolveTerminalOrder = (order: AdminOrder) => {
      if (!isCurrent()) return true;
      if (order.status === 'paid') {
        finish();
        invoke(() => input.onPaid(order));
        return true;
      }
      if (isPaymentAttemptDefinitivelyFailed(order) || order.paymentAttemptStatus === 'manual-review') {
        finish();
        invoke(() => input.onFailed(order));
        return true;
      }
      return false;
    };

    if (input.mode === 'qr') {
      let hasShownTransientMessage = false;
      const poll = async () => {
        try {
          const order = await syncOnce();
          if (resolveTerminalOrder(order)) return;
        } catch (error) {
          if (!isCurrent() || isAbortError(error)) return;
          if (!hasShownTransientMessage) {
            hasShownTransientMessage = true;
            setInternalStatus(current => current?.runId === monitor.runId
              ? { ...current, message: PAYMENT_SYNC_RETRY_MESSAGE }
              : current);
          }
        }
        if (isCurrent()) schedule(() => void poll(), QR_POLL_INTERVAL_MS);
      };
      void poll();
    } else {
      let closedSequenceStarted = false;
      let closedSequenceStartedAt = 0;
      let focusListenerAttached = true;

      const detachFocusListener = () => {
        if (!focusListenerAttached) return;
        focusListenerAttached = false;
        window.removeEventListener('focus', handleFocus);
      };
      const finishUnconfirmed = () => {
        if (!isCurrent()) return;
        finish();
        invoke(input.onUnconfirmed);
      };
      const runClosedAttempt = (attempt: number) => {
        if (!isCurrent()) return;
        const delayMs = Math.max(
          0,
          POPUP_RETRY_DELAYS_MS[attempt] - (Date.now() - closedSequenceStartedAt),
        );
        schedule(() => {
          void syncOnce()
            .then(order => {
              if (resolveTerminalOrder(order)) return;
              const nextAttempt = attempt + 1;
              if (nextAttempt < POPUP_RETRY_DELAYS_MS.length) runClosedAttempt(nextAttempt);
              else finishUnconfirmed();
            })
            .catch(error => {
              if (!isCurrent() || isAbortError(error)) return;
              const nextAttempt = attempt + 1;
              if (nextAttempt < POPUP_RETRY_DELAYS_MS.length) runClosedAttempt(nextAttempt);
              else finishUnconfirmed();
            });
        }, delayMs);
      };
      const startClosedSequence = () => {
        if (closedSequenceStarted || !isCurrent()) return;
        closedSequenceStarted = true;
        closedSequenceStartedAt = Date.now();
        detachFocusListener();
        setInternalStatus(current => current?.runId === monitor.runId
          ? { ...current, phase: 'checking-return' }
          : current);
        runClosedAttempt(0);
      };
      function handleFocus() {
        if (isPaymentWindowClosed(input.paymentWindow)) {
          startClosedSequence();
          return;
        }
        if (!isCurrent() || closedSequenceStarted) return;
        void syncOnce().then(resolveTerminalOrder).catch(() => undefined);
      }
      const checkPaymentWindow = () => {
        if (isPaymentWindowClosed(input.paymentWindow)) startClosedSequence();
        else if (isCurrent()) schedule(checkPaymentWindow, POPUP_CLOSE_CHECK_MS);
      };

      window.addEventListener('focus', handleFocus);
      monitor.cleanups.add(detachFocusListener);
      schedule(checkPaymentWindow, POPUP_CLOSE_CHECK_MS);
    }

    schedule(finish, MONITOR_MAX_LIFETIME_MS);
  }, [disposeMonitor, stopPaymentMonitor, syncPaymentOrder]);

  useEffect(() => {
    const handlePageHide = () => stopPaymentMonitor();
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      stopPaymentMonitor();
    };
  }, [stopPaymentMonitor]);

  const paymentMonitorStatus = useMemo<PaymentMonitorStatus | null>(() => {
    if (!internalStatus) return null;
    return {
      orderId: internalStatus.orderId,
      mode: internalStatus.mode,
      phase: internalStatus.phase,
      message: internalStatus.message,
    };
  }, [internalStatus]);

  return {
    paymentMonitorStatus,
    startPaymentMonitor,
    stopPaymentMonitor,
  };
}

function isPaymentWindowClosed(paymentWindow: Window | null | undefined) {
  if (!paymentWindow) return false;
  try {
    return paymentWindow.closed;
  } catch {
    return false;
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}
