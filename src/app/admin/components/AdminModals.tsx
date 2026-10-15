import { AlertTriangle,ShieldCheck,X } from 'lucide-react';
import { useId,useState } from 'react';
import { toast } from 'sonner';
import { Button,Card,Dialog } from '../../ui';
import type { ConfirmState,DetailState } from '../types';

export function DetailModal({ detail, onClose }: { detail: DetailState | null; onClose: () => void }) {
  const titleId = useId();
  if (!detail) return null;

  const fixedContent = detail.bodyMode === 'fixed-content';
  const panelWidth = detail.extraWide ? 'max-w-6xl' : detail.wide ? 'max-w-4xl' : 'max-w-2xl';

  return (
    <Dialog open={Boolean(detail)} onClose={onClose} titleId={titleId} panelClassName={panelWidth}>
      <Card
        variant="modal"
        data-admin-ui="modal"
        className={`w-full overflow-hidden ${fixedContent ? 'flex h-[calc(100dvh-1.5rem)] max-h-[820px] flex-col sm:h-[calc(100dvh-3rem)]' : 'max-h-[82dvh]'}`}
      >
        <div className="flex items-start justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 id={titleId} className="font-semibold text-white">{detail.title}</h2>
            {detail.subtitle && <p className="mt-1 text-xs text-gray-500">{detail.subtitle}</p>}
          </div>
          <button type="button" aria-label="关闭详情" onClick={onClose} className="rounded-lg bg-white/5 p-2 text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div
          data-testid={fixedContent ? 'admin-detail-fixed-body' : undefined}
          className={fixedContent ? 'min-h-0 flex-1 overflow-hidden p-5' : 'max-h-[calc(82dvh-72px)] overflow-y-auto p-5'}
        >
          {detail.content}
        </div>
      </Card>
    </Dialog>
  );
}

export function ConfirmModal({ confirm, onClose }: { confirm: ConfirmState | null; onClose: () => void }) {
  const titleId = useId();
  const [submitting, setSubmitting] = useState(false);
  if (!confirm) return null;

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await confirm.onConfirm();
      setSubmitting(false);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={Boolean(confirm)}
      onClose={onClose}
      role="alertdialog"
      titleId={titleId}
      closeDisabled={submitting}
      zIndexClass="z-[60]"
      panelClassName="max-w-md"
    >
      <Card variant="modal" data-admin-ui="modal" className="w-full p-5">
        <div className="flex items-start gap-3">
          <div className={`rounded-xl p-2 ${confirm.danger ? 'bg-red-500/15 text-red-400' : 'bg-purple-500/15 text-purple-300'}`}>
            {confirm.danger ? <AlertTriangle className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
          </div>
          <div>
            <h2 id={titleId} className="font-semibold text-white">{confirm.title}</h2>
            <p className="mt-2 text-sm text-gray-400">{confirm.description}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button data-dialog-initial-focus variant="secondary" size="md" disabled={submitting} onClick={onClose}>取消</Button>
          <Button
            variant={confirm.danger ? 'danger' : 'primary'}
            size="md"
            disabled={submitting}
            onClick={() => void handleConfirm()}
          >
            {submitting ? '处理中…' : confirm.confirmLabel}
          </Button>
        </div>
      </Card>
    </Dialog>
  );
}
