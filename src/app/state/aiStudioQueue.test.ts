import { describe, expect, it } from 'vitest';
import type { AdminGenerationJob } from '../data/admin';
import type { Asset } from '../data/assets';
import { buildAIStudioQueueItems } from './aiStudioQueue';

describe('AI Studio 生成队列映射', () => {
  it('按 kind 独立映射图片队列及图片配置', () => {
    const queue = buildAIStudioQueueItems([
      job({
        id: 'image-job',
        kind: 'image',
        model: 'Seedream 5.0 Pro',
        configData: { aspectRatio: '3:2', resolution: '2K', optimizePromptMode: 'fast' },
      }),
      job({ id: 'video-job', kind: 'video' }),
    ], [], 'image');

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      id: 'image-job',
      kind: 'image',
      ratio: '3:2',
      res: '2K',
      dur: '-',
    });
  });

  it('按提交时间倒序展示视频任务并保留终态任务', () => {
    const queue = buildAIStudioQueueItems([
      job({
        id: 'job-failed',
        status: 'failed',
        createdAtIso: '2026-07-01T10:03:00.000Z',
        failReason: '供应商返回失败',
      }),
      job({
        id: 'job-done',
        status: 'completed',
        createdAtIso: '2026-07-01T10:01:00.000Z',
        assetId: 'asset-done',
      }),
      job({
        id: 'job-processing',
        status: 'processing',
        createdAtIso: '2026-07-01T10:02:00.000Z',
      }),
    ], [
      asset('asset-done'),
    ]);

    expect(queue.map(item => item.id)).toEqual(['job-failed', 'job-processing', 'job-done']);
    expect(queue.map(item => item.status)).toEqual(['failed', 'generating', 'done']);
    expect(queue[2]).toMatchObject({
      ratio: '9:16',
      res: '720p',
      dur: '15',
      previewReady: true,
      thumbnail: 'https://cdn.example.com/thumb.jpg',
      displayStatus: 'done',
    });
    expect(queue[0].failReason).toBe('供应商返回失败');
  });

  it('首尾帧 adaptive 比例在队列中显示为跟随首帧', () => {
    const [item] = buildAIStudioQueueItems([
      job({
        id: 'seedance-25-adaptive',
        model: 'Seedance 2.5',
        configData: {
          mode: 'first-last',
          aspectRatio: 'adaptive',
          resolution: '720p',
          durationSeconds: 30,
        },
      }),
    ], []);

    expect(item).toMatchObject({
      model: 'Seedance 2.5',
      ratio: '跟随首帧',
      res: '720p',
      dur: '30',
    });
  });

  it('图片和视频队列都保留 API 返回的脱敏中文失败原因', () => {
    const jobs = [
      job({
        id: 'video-policy-failed',
        kind: 'video',
        status: 'failed',
        failReason: '参考视频涉及真人或隐私信息，请更换后重试。',
      }),
      job({
        id: 'image-policy-failed',
        kind: 'image',
        status: 'failed',
        failReason: '生成内容未通过内容审核，请调整提示词或参考素材后重试。',
      }),
    ];

    expect(buildAIStudioQueueItems(jobs, [], 'video')[0]?.failReason)
      .toBe('参考视频涉及真人或隐私信息，请更换后重试。');
    expect(buildAIStudioQueueItems(jobs, [], 'image')[0]?.failReason)
      .toBe('生成内容未通过内容审核，请调整提示词或参考素材后重试。');
  });

  it('完成任务会优先使用队列接口返回的缩略图，不依赖资产是否位于当前卡片页', () => {
    const [item] = buildAIStudioQueueItems([
      job({
        id: 'job-done-outside-current-page',
        status: 'completed',
        assetId: 'asset-outside-current-page',
        assetThumbnailUrl: 'https://cdn.example.com/queue-thumb.jpg',
        assetAvailable: true,
      }),
    ], []);

    expect(item).toMatchObject({
      status: 'done',
      displayStatus: 'done',
      assetId: 'asset-outside-current-page',
      previewReady: true,
      thumbnail: 'https://cdn.example.com/queue-thumb.jpg',
    });
  });

  it('用户删除生成素材后保留结算记录，并标记为不可预览', () => {
    const [item] = buildAIStudioQueueItems([
      job({
        id: 'job-deleted-asset',
        status: 'completed',
        assetId: 'asset-deleted',
        assetAvailable: false,
        assetThumbnailUrl: 'https://cdn.example.com/should-not-render.jpg',
      }),
    ], []);

    expect(item).toMatchObject({
      status: 'done',
      assetUnavailable: true,
      previewReady: false,
      thumbnail: undefined,
      stateMessage: '素材已删除，无法预览或下载。',
    });
  });

  it('取消确认和未知提交期间保留冻结状态且不虚报退款', () => {
    const [cancelPending, submissionUnknown] = buildAIStudioQueueItems([
      job({
        id: 'cancel-pending',
        status: 'processing',
        processingStage: 'cancel-requested',
        cancelState: 'pending-provider',
        creditStatus: 'held',
        refundedCredits: 0,
      }),
      job({
        id: 'submission-unknown',
        status: 'processing',
        processingStage: 'submission-unknown',
        creditStatus: 'held',
        refundedCredits: 0,
      }),
    ], []);

    expect(cancelPending).toMatchObject({
      displayStatus: 'generating',
      creditSummary: '冻结 80 积分',
      stateMessage: '取消请求已受理；供应商结果确认前积分继续冻结。',
    });
    expect(submissionUnknown).toMatchObject({
      displayStatus: 'generating',
      creditSummary: '冻结 80 积分',
      stateMessage: '供应商提交结果未知，系统不会重复提交或提前退款，正在等待核对。',
    });
  });

  it('归档和结算仍使用四段主状态，特殊结算事实作为次级说明', () => {
    const [archiving, settlementPending] = buildAIStudioQueueItems([
      job({ id: 'archiving', status: 'processing', processingStage: 'archiving' }),
      job({ id: 'settlement-pending', status: 'processing', processingStage: 'settlement-pending' }),
    ], []);

    expect(archiving).toMatchObject({ displayStatus: 'archiving' });
    expect(settlementPending).toMatchObject({
      displayStatus: 'archiving',
      stateMessage: '视频已生成，积分正在结算；最终实扣以账户流水为准。',
    });
  });

  it('终态仅按真实积分结算状态展示退款或计费', () => {
    const queue = buildAIStudioQueueItems([
      job({
        id: 'failed-held',
        status: 'failed',
        creditStatus: 'held',
        refundedCredits: 0,
      }),
      job({
        id: 'canceled-settled',
        status: 'canceled',
        creditStatus: 'settled',
        settledCredits: 80,
        refundedCredits: 0,
      }),
    ], []);

    expect(queue.find(item => item.id === 'failed-held')).toMatchObject({
      creditSummary: '冻结 80 积分',
      stateMessage: '积分仍冻结，等待自动恢复或人工核对。',
    });
    expect(queue.find(item => item.id === 'canceled-settled')).toMatchObject({
      creditSummary: '已扣 80 积分',
      stateMessage: '供应商已产生计费用量，已结算 80 积分。',
    });
  });

  it('全额退款只显示积分摘要，部分退款才说明过期积分', () => {
    const queue = buildAIStudioQueueItems([
      job({
        id: 'full-refund',
        status: 'canceled',
        creditStatus: 'refunded',
        refundedCredits: 80,
      }),
      job({
        id: 'partial-refund',
        status: 'canceled',
        creditStatus: 'refunded',
        refundedCredits: 50,
      }),
    ], []);

    const fullRefund = queue.find(item => item.id === 'full-refund');
    expect(fullRefund?.creditSummary).toBe('已退 80 / 预扣 80 积分');
    expect(fullRefund).not.toHaveProperty('stateMessage');
    expect(queue.find(item => item.id === 'partial-refund')?.stateMessage)
      .toContain('30 积分所属批次已过期');
  });
});

function job(patch: Partial<AdminGenerationJob> & Pick<AdminGenerationJob, 'id'>): AdminGenerationJob {
  return {
    id: patch.id,
    time: patch.time ?? '2026-07-01 18:00',
    createdAtIso: patch.createdAtIso,
    userName: '测试用户',
    email: 'test@example.com',
    kind: patch.kind ?? 'video',
    model: patch.model ?? 'Seedance 2.0',
    status: patch.status ?? 'queued',
    duration: '-',
    credits: 80,
    reservedCredits: 80,
    settledCredits: patch.settledCredits ?? (patch.status === 'completed' ? 80 : 0),
    refundedCredits: patch.refundedCredits ?? (patch.status === 'failed' || patch.status === 'canceled' ? 80 : 0),
    creditStatus: patch.creditStatus ?? (patch.status === 'completed' ? 'settled' : patch.status === 'failed' || patch.status === 'canceled' ? 'refunded' : 'held'),
    mainCreditsUsed: 80,
    addonCreditsUsed: 0,
    prompt: '测试提示词',
    config: '9:16 · 720p · 15s',
    configData: patch.configData ?? {
      aspectRatio: '9:16',
      resolution: '720p',
      durationSeconds: 15,
    },
    failCategory: patch.failCategory,
    failReason: patch.failReason,
    assetId: patch.assetId,
    assetName: patch.assetName,
    assetSource: patch.assetSource,
    assetThumbnailUrl: patch.assetThumbnailUrl,
    assetAvailable: patch.assetAvailable,
    retryCount: patch.retryCount ?? 0,
    attempt: patch.attempt,
    processingStage: patch.processingStage,
    cancelState: patch.cancelState,
  };
}

function asset(id: string): Asset {
  return {
    id,
    name: '生成视频',
    type: 'video',
    source: 'ai-video',
    folderId: 'folder-ai-video',
    size: '1 MB',
    duration: '15s',
    dimensions: '720x1280',
    createdAt: '2026-07-01 18:01',
    updatedAt: '2026-07-01',
    thumbnail: 'https://cdn.example.com/thumb.jpg',
    publicUrl: 'https://cdn.example.com/video.mp4',
    views: 0,
  };
}
