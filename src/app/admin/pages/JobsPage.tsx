import { useEffect,useState } from 'react';
import { toast } from 'sonner';
import {
  type AdminGenerationJob
} from '../../data/admin';
import type { Asset } from '../../data/assets';
import { generationJobDisplayStatus,generationJobReviewMessage } from '../../data/generationJobState';
import { AssetPreviewModal } from '../../components/AssetPreviewModal';
import { Button } from '../../ui';
import { downloadAdminAsset } from '../../utils/assetDownload';

import {
  AdminDataTable,
  DetailGrid,
  JobDetail,
  PageShell,
  SearchFilter,
  SelectFilter,
  Stack,
  statusBadge
} from '../components/AdminPageShared';
import type { AdminListControls,ConfirmState,DetailState } from '../types';

export function AdminJobsPage({ jobs, control, onJobDetailLoad, onAdminAssetLoad, onGenerationRetry, onGenerationRefund, setDetail, setConfirm }: {
  jobs: AdminGenerationJob[];
  control: AdminListControls['jobs'];
  onJobDetailLoad: (id: string) => Promise<AdminGenerationJob>;
  onAdminAssetLoad: (assetId: string) => Promise<Asset>;
  onGenerationRetry: (job: AdminGenerationJob) => Promise<void>;
  onGenerationRefund: (job: AdminGenerationJob) => Promise<void>;
  setDetail: (detail: DetailState) => void;
  setConfirm: (confirm: ConfirmState) => void;
}) {
  const [search, setSearch] = useState(control.filters.search ?? '');
  const [status, setStatus] = useState<'all' | AdminGenerationJob['status']>(control.filters.status ?? 'all');
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [loadingAssetJobId, setLoadingAssetJobId] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => control.setFilters({
      search: search.trim() || undefined,
      status: status === 'all' ? undefined : status,
      userId: control.filters.userId,
    }), 300);
    return () => window.clearTimeout(timer);
  }, [control.filters.userId, control.setFilters, search, status]);

  const openJobDetail = async (job: AdminGenerationJob) => {
    try {
      const detail = await onJobDetailLoad(job.id);
      setDetail({ title: detail.id, subtitle: '任务详情', content: <JobDetail job={detail} />, wide: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '任务详情加载失败');
    }
  };

  const retryJob = (job: AdminGenerationJob) => {
    setConfirm({
      title: '确认重试生成任务？',
      description: `${job.id} 仅会在“失败、积分已退回、无资产且无未决供应商执行”全部满足时重新预扣积分。`,
      confirmLabel: '重试任务',
      onConfirm: () => onGenerationRetry(job),
    });
  };

  const refundJob = (job: AdminGenerationJob) => {
    const confirmation = getGenerationRefundConfirmation(job);
    setConfirm({
      title: confirmation.title,
      description: confirmation.description,
      confirmLabel: confirmation.confirmLabel,
      danger: true,
      onConfirm: () => onGenerationRefund(job),
    });
  };

  const showAssetFallback = (job: AdminGenerationJob) => {
    setDetail({
      title: job.assetName ?? job.assetId ?? '关联资产',
      subtitle: '任务关联资产',
      content: <DetailGrid rows={[
        ['资产 ID', job.assetId ?? '-'],
        ['资产名称', job.assetName ?? '-'],
        ['资产来源', job.assetSource ?? '-'],
      ]} />,
    });
  };

  const viewAsset = async (job: AdminGenerationJob) => {
    if (!job.assetId) return;

    setLoadingAssetJobId(job.id);
    try {
      const asset = await onAdminAssetLoad(job.assetId);
      setPreviewAsset(asset);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '关联资产暂不可预览');
      showAssetFallback(job);
    } finally {
      setLoadingAssetJobId(null);
    }
  };

  return (
    <>
      <PageShell title="生成任务监控" subtitle="查看视频/图片生成任务、模型、状态、失败原因和积分消耗">
        <SearchFilter search={search} onSearch={setSearch} placeholder="搜索任务、用户、模型或提示词...">
          <SelectFilter value={status} onChange={setStatus} label="状态" options={[
            { value: 'all', label: '全部任务' },
            { value: 'queued', label: '分析中' },
            { value: 'processing', label: '生成中 / 待核验' },
            { value: 'completed', label: '已完成' },
            { value: 'failed', label: '失败' },
            { value: 'canceled', label: '已取消' },
          ]} />
        </SearchFilter>
        <AdminDataTable
          items={jobs}
          paginationLabel="生成任务分页导航"
          gridTemplate="1fr 1fr .62fr .9fr 1.1fr .75fr .7fr .85fr 210px"
          columns={[
            { header: '任务', render: job => <Stack title={job.id} subtitle={job.time} /> },
            { header: '用户', render: job => <Stack title={job.userName} subtitle={job.email} /> },
            { header: '类型', render: job => job.kind === 'video' ? 'AI 视频' : 'AI 图片' },
            { header: '模型', render: job => job.model },
            { header: '状态', render: job => <span title={generationJobReviewMessage(job) ?? undefined}>{statusBadge(generationJobDisplayStatus(job))}</span> },
            { header: '失败分类', render: job => job.failCategory ? statusBadge(job.failCategory) : '-' },
            { header: '积分状态', render: job => statusBadge(job.creditStatus) },
            { header: '关联资产', render: job => job.assetName ? <Stack title={job.assetName} subtitle={job.assetId} /> : <span className="text-gray-500">-</span> },
            { header: '操作', className: 'justify-end', render: job => (
              <div className="flex gap-2" onClick={event => event.stopPropagation()}>
                <Button size="sm" variant="secondary" onClick={() => void openJobDetail(job)}>详情</Button>
                <Button size="sm" variant="primary" disabled={!canRetryGenerationJob(job)} onClick={() => retryJob(job)}>重试</Button>
                <Button size="sm" variant="secondary" disabled={!canManuallyRefundGenerationJob(job)} onClick={() => refundJob(job)}>退回</Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={loadingAssetJobId === job.id}
                  disabled={job.status !== 'completed' || !job.assetId}
                  onClick={() => void viewAsset(job)}
                >
                  资产
                </Button>
              </div>
            ) },
          ]}
          serverPagination={control.pagination}
          serverLoading={control.loading}
          onServerNavigate={control.navigate}
          onRowClick={job => void openJobDetail(job)}
        />
      </PageShell>

      {previewAsset && (
        <AssetPreviewModal
          key={`admin-job-asset-${previewAsset.id}`}
          asset={previewAsset}
          mode="readonly"
          rootFolderId={previewAsset.folderId}
          showReuseAction={false}
          onClose={() => setPreviewAsset(null)}
          onDownload={downloadAdminAsset}
        />
      )}
    </>
  );
}

const UNRESOLVED_PROVIDER_RUN_STATUSES = new Set([
  'prepared',
  'submitting',
  'submitted',
  'submission-unknown',
  'provider-running',
  'provider-succeeded',
  'archiving',
  'settlement-pending',
  'delivery-failed',
  'manual-review',
]);

function canRetryGenerationJob(job: AdminGenerationJob) {
  return job.status === 'failed'
    && job.creditStatus === 'refunded'
    && !job.assetId
    && !UNRESOLVED_PROVIDER_RUN_STATUSES.has(job.providerRunStatus ?? '');
}

const UNCERTAIN_SUBMISSION_STAGES = new Set(['submission-unknown', 'manual-review']);

type GenerationJobWithProviderResult = AdminGenerationJob & {
  providerResultAvailable?: boolean;
};

export function isUncertainGenerationSubmission(job: AdminGenerationJob) {
  return job.status === 'processing'
    && UNCERTAIN_SUBMISSION_STAGES.has(job.processingStage ?? '')
    && job.creditStatus === 'held'
    && !job.assetId
    && (job as GenerationJobWithProviderResult).providerResultAvailable !== true;
}

export function canManuallyRefundGenerationJob(job: AdminGenerationJob) {
  const terminalHeld = (job.status === 'failed' || job.status === 'canceled')
    && job.creditStatus === 'held';
  return terminalHeld || isUncertainGenerationSubmission(job);
}

export function getGenerationRefundConfirmation(job: AdminGenerationJob) {
  if (isUncertainGenerationSubmission(job)) {
    return {
      title: '确认高风险退回积分？',
      description: `${job.id} 的供应商提交结果未知。供应商可能已经计费，必须先人工核验供应商账单；此操作只退回站内积分，不代表上游未计费。`,
      confirmLabel: '高风险退回积分',
    };
  }
  return {
    title: '确认退回积分？',
    description: `${job.id} 仅会在任务已失败或取消且积分仍冻结时执行；已过期批次不会重新恢复到账户。`,
    confirmLabel: '退回积分',
  };
}
