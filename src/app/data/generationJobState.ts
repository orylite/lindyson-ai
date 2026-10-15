import type { AdminGenerationJob } from './admin';

export function generationJobDisplayStatus(job: Pick<AdminGenerationJob, 'status' | 'processingStage'>) {
  if (job.status === 'processing'
    && ['submission-unknown', 'manual-review'].includes(job.processingStage ?? '')) {
    return job.processingStage!;
  }
  return job.status;
}

export function generationJobReviewMessage(job: Pick<AdminGenerationJob, 'status' | 'processingStage'>) {
  const status = generationJobDisplayStatus(job);
  if (status === 'submission-unknown') {
    return '提交结果未知，已暂停自动重试。请核验供应商任务和账单后，再决定恢复任务或人工退回积分；当前不能确认上游是否已计费。';
  }
  if (status === 'manual-review') {
    return '任务需要人工核验。请检查供应商任务、生成结果和账单，再决定后续处理。';
  }
  return null;
}
