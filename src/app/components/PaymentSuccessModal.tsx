import { CalendarDays,CheckCircle2,Clock3,Coins,UserRoundCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AccountProfile } from '../data/account';
import type { AdminOrder } from '../data/admin';
import { Dialog } from '../ui';

interface PaymentSuccessModalProps {
  order: AdminOrder;
  account: AccountProfile;
  onConfirm: () => void;
}

export function PaymentSuccessModal({ order, account, onConfirm }: PaymentSuccessModalProps) {
  const purchaseMessage = order.kind === 'addon'
    ? `已成功购买${order.planName}`
    : `已成功订阅${withPlanSuffix(order.planName)}`;

  return (
    <Dialog
      onClose={onConfirm}
      titleId="payment-success-title"
      zIndexClass="z-[80]"
      panelClassName="max-w-lg rounded-3xl border border-green-400/25 bg-[#151525] p-6 shadow-2xl shadow-green-500/10 sm:p-8"
    >
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-green-400 to-emerald-600 shadow-lg shadow-green-500/25">
            <CheckCircle2 className="h-9 w-9 text-white" />
          </div>
          <h2 id="payment-success-title" className="mt-5 text-2xl font-bold text-white">支付成功</h2>
          <p className="mt-2 text-sm text-green-300">{purchaseMessage}</p>
        </div>

        <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SuccessDetail icon={<Coins className="h-4 w-4" />} label="积分到账" value={`+${order.creditAmount.toLocaleString()}`} />
          <SuccessDetail icon={<UserRoundCheck className="h-4 w-4" />} label="当前积分" value={account.availableCredits.toLocaleString()} />
          <SuccessDetail icon={<CalendarDays className="h-4 w-4" />} label="积分重置日期" value={account.resetDate || '-'} />
          <SuccessDetail icon={<Clock3 className="h-4 w-4" />} label="套餐到期日期" value={account.expiresAt || '-'} />
        </div>

        <button
          type="button"
          data-dialog-initial-focus
          onClick={onConfirm}
          className="mt-7 w-full rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 py-3 text-sm font-semibold text-white shadow-lg shadow-pink-500/20 transition-opacity hover:opacity-90"
        >
          确认并查看账户中心
        </button>
    </Dialog>
  );
}

function SuccessDetail({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-white/70">
        <span className="text-white">{icon}</span>
        {label}
      </div>
      <p className="mt-2 text-lg font-bold text-white">{value}</p>
    </div>
  );
}

function withPlanSuffix(planName: string) {
  return planName.endsWith('套餐') ? planName : `${planName}套餐`;
}
