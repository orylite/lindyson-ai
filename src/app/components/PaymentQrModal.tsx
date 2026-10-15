import { Clock3,ScanLine,ShieldCheck,X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Component,useEffect,useRef,useState,type ReactNode } from 'react';
import { toast } from 'sonner';
import type { AdminOrder,PaymentLaunch } from '../data/admin';
import { isPaymentAttemptDefinitivelyFailed,paymentFailureMessage } from '../data/paymentState';
import { Dialog } from '../ui';
import { formatCnyFromCents } from '../utils/currency';

interface PaymentQrModalProps {
  order: AdminOrder;
  payment: Extract<PaymentLaunch, { type: 'qr' }>;
  monitorMessage: string | null;
  onStopPaymentMonitor: () => void;
  onCancelPaymentOrder: (orderId: string) => Promise<AdminOrder>;
  onPaymentPaid: (order: AdminOrder) => void | Promise<void>;
  onPaymentFailed: (order: AdminOrder) => void;
}

export function PaymentQrModal({
  order,
  payment,
  monitorMessage,
  onStopPaymentMonitor,
  onCancelPaymentOrder,
  onPaymentPaid,
  onPaymentFailed,
}: PaymentQrModalProps) {
  const [now, setNow] = useState(() => Date.now());
  const [isClosing, setIsClosing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const settledRef = useRef(false);
  const expiryHandledRef = useRef(false);
  const cancelPaymentRef = useRef(onCancelPaymentOrder);
  const paymentPaidRef = useRef(onPaymentPaid);
  const paymentFailedRef = useRef(onPaymentFailed);
  cancelPaymentRef.current = onCancelPaymentOrder;
  paymentPaidRef.current = onPaymentPaid;
  paymentFailedRef.current = onPaymentFailed;
  const expiresAt = parseExpiresAt(order.paymentExpiresAtIso ?? order.paymentExpiresAt);
  const remainingSeconds = expiresAt === null ? null : Math.max(0, Math.ceil((expiresAt - now) / 1000));

  const resolveOrder = (nextOrder: AdminOrder, failedMessage: string) => {
    if (settledRef.current) return true;
    if (nextOrder.status === 'paid') {
      settledRef.current = true;
      void paymentPaidRef.current(nextOrder);
      return true;
    }
    if (isPaymentAttemptDefinitivelyFailed(nextOrder) || nextOrder.paymentAttemptStatus === 'manual-review') {
      settledRef.current = true;
      if (nextOrder.paymentAttemptStatus === 'manual-review') toast.warning(paymentFailureMessage(nextOrder));
      else toast.info(nextOrder.paymentAttemptError || nextOrder.paymentError || failedMessage);
      paymentFailedRef.current(nextOrder);
      return true;
    }
    return false;
  };

  const closePayment = async (expired = false) => {
    if (isClosing || settledRef.current) return;
    onStopPaymentMonitor();
    setIsClosing(true);
    setStatusMessage(expired ? '二维码已过期，正在确认支付状态…' : null);
    try {
      const nextOrder = await cancelPaymentRef.current(order.id);
      if (!resolveOrder(nextOrder, expired ? '支付二维码已过期' : '支付已取消')) {
        setStatusMessage('支付状态暂时无法确认，请稍后在历史订单中查看。');
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '关闭支付失败，请稍后重试。');
    } finally {
      setIsClosing(false);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (remainingSeconds === null || remainingSeconds > 0 || expiryHandledRef.current || settledRef.current) return;
    expiryHandledRef.current = true;
    void closePayment(true);
  }, [remainingSeconds]);

  return (
    <Dialog
      onClose={() => void closePayment()}
      titleId="payment-qr-title"
      closeDisabled={isClosing}
      zIndexClass="z-[90]"
      panelClassName="max-h-[calc(100vh-2rem)] max-w-4xl overflow-y-auto rounded-3xl border border-purple-400/30 bg-[#151525] p-6 shadow-2xl shadow-purple-500/20 sm:p-8"
    >
        <button
          type="button"
          onClick={() => void closePayment()}
          disabled={isClosing}
          aria-label="关闭支付二维码"
          className="absolute right-4 top-4 rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-50"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-600 to-purple-600 shadow-lg shadow-pink-500/25">
            <ScanLine className="h-7 w-7 text-white" />
          </div>
          <h2 id="payment-qr-title" className="mt-4 text-2xl font-bold text-white">支付宝扫码支付</h2>
          <p className="mt-2 text-sm text-gray-400">请使用支付宝扫一扫完成付款</p>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_336px] md:items-start md:gap-8">
          <div
            data-testid="payment-qr-summary"
            className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-sm"
          >
            <h3 className="text-base font-semibold text-white">支付摘要</h3>
            <div className="mt-4 flex items-center justify-between gap-4">
              <span className="text-gray-400">购买套餐</span>
              <span className="text-right font-semibold text-white">{order.planName}</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-4">
              <span className="text-gray-400">计费方式</span>
              <span className="font-medium text-white">{billingLabel(order.billing)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-4">
              <span className="text-gray-400">到账积分</span>
              <span className="font-semibold text-green-300">+{order.creditAmount.toLocaleString('zh-CN')} 积分</span>
            </div>
            {order.kind === 'main' && order.estimatedPlanResetAt && (
              <div className="mt-3 flex items-center justify-between gap-4">
                <span className="text-gray-400">预计积分重置日期</span>
                <span className="font-medium text-white">{order.estimatedPlanResetAt}</span>
              </div>
            )}
            {order.kind === 'main' && order.estimatedPlanExpiresAt && (
              <div className="mt-3 flex items-center justify-between gap-4">
                <span className="text-gray-400">预计套餐到期日期</span>
                <span className="font-medium text-white">{order.estimatedPlanExpiresAt}</span>
              </div>
            )}
            <div className="mt-4 flex items-end justify-between border-t border-white/10 pt-4">
              <span className="text-gray-400">应付金额</span>
              <span className="text-2xl font-bold text-white">{formatCnyFromCents(order.amount)}</span>
            </div>
            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="text-xs text-gray-500">订单号</p>
              <p className="mt-1 break-all text-xs leading-5 text-gray-400">{order.merchantOrderNo ?? order.id}</p>
            </div>
          </div>

          <div data-testid="payment-qr-code-panel" className="min-w-0">
            <PaymentQrErrorBoundary key={payment.codeUrl}>
              <div className="mx-auto flex w-full max-w-[336px] rounded-2xl bg-white p-2 shadow-lg shadow-black/20">
                <QRCodeSVG
                  value={payment.codeUrl}
                  size={320}
                  level="L"
                  boostLevel={false}
                  marginSize={4}
                  aria-label="支付宝支付二维码"
                  className="h-auto w-full"
                />
              </div>
            </PaymentQrErrorBoundary>

            <div className="mt-5 flex items-center justify-center gap-2 text-xs text-gray-400" aria-live="polite">
              <Clock3 className="h-4 w-4 shrink-0" />
              <span>
                {remainingSeconds === null
                  ? '支付二维码有效期以支付通道为准'
                  : remainingSeconds > 0
                    ? `请在 ${formatRemaining(remainingSeconds)} 内完成支付`
                    : '正在确认二维码是否已过期'}
              </span>
            </div>
          </div>
        </div>

        {(statusMessage ?? monitorMessage) && (
          <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-center text-xs leading-5 text-amber-200">
            {statusMessage ?? monitorMessage}
          </p>
        )}

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-green-300">
          <ShieldCheck className="h-4 w-4" />
          支付成功后将自动到账
        </div>
        <button
          type="button"
          onClick={() => void closePayment()}
          disabled={isClosing}
          className="mt-4 w-full rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-50"
        >
          {isClosing ? '正在关闭支付…' : '取消支付'}
        </button>
    </Dialog>
  );
}

class PaymentQrErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div
          role="alert"
          className="mx-auto mt-6 w-full max-w-[336px] rounded-2xl border border-red-400/20 bg-red-400/10 px-5 py-10 text-center text-sm leading-6 text-red-200"
        >
          支付二维码无法显示，请取消支付后重试。
        </div>
      );
    }
    return this.props.children;
  }
}

function billingLabel(value: AdminOrder['billing']) {
  if (value === 'yearly') return '年付';
  if (value === 'monthly') return '月付';
  return '一次性购买';
}

function parseExpiresAt(value: string | undefined) {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? null : milliseconds;
}

function formatRemaining(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}
