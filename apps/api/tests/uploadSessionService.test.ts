import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  withTransaction: vi.fn(),
  createUploadSignature: vi.fn(),
  copyStoredObject: vi.fn(),
  readStoredObjectSize: vi.fn(),
  readUploadedMediaMetadata: vi.fn(),
  validateUploadedMediaDecoding: vi.fn(),
  createUploadedImageThumbnail: vi.fn(),
  createUploadedVideoPreview: vi.fn(),
  enqueueUploadSession: vi.fn(),
  resolveAssetFolderId: vi.fn(),
  scheduleObjectDeletion: vi.fn(),
  mapAssetRow: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
  withTransaction: mocks.withTransaction,
}));
vi.mock('../src/storage/storageService.js', () => ({
  UPLOAD_MAX_BYTES: 1024 * 1024 * 1024,
  buildPublicUrl: (key: string) => `https://storage.example.com/${key}`,
  buildUploadStagingObjectKey: ({ userId, sessionId, filename }: Record<string, string>) => `users/${userId}/upload-staging/${sessionId}/${filename}`,
  buildUploadFinalObjectKey: ({ userId, sessionId, filename }: Record<string, string>) => `users/${userId}/uploads/${sessionId}/${filename}`,
  createUploadSignature: mocks.createUploadSignature,
  copyStoredObject: mocks.copyStoredObject,
  readStoredObjectSize: mocks.readStoredObjectSize,
}));
vi.mock('../src/domain/uploadedVideoPreview.js', () => ({
  buildUploadedImageThumbnailKey: (_userId: string, sessionId: string) => `thumb/${sessionId}.webp`,
  buildUploadedVideoThumbnailKey: (_userId: string, sessionId: string) => `thumb/${sessionId}.jpg`,
  createUploadedImageThumbnail: mocks.createUploadedImageThumbnail,
  createUploadedVideoPreview: mocks.createUploadedVideoPreview,
  readUploadedMediaMetadata: mocks.readUploadedMediaMetadata,
  validateUploadedMediaDecoding: mocks.validateUploadedMediaDecoding,
}));
vi.mock('../src/queues/uploadQueue.js', () => ({ enqueueUploadSession: mocks.enqueueUploadSession }));
vi.mock('../src/domain/assetFolders.js', () => ({ resolveAssetFolderId: mocks.resolveAssetFolderId }));
vi.mock('../src/domain/assetDeletionService.js', () => ({ scheduleObjectDeletion: mocks.scheduleObjectDeletion }));
vi.mock('../src/domain/assets.js', () => ({ mapAssetRow: mocks.mapAssetRow }));

import {
  createOrReplayUploadSession,
  enqueueRecoverableUploadSessions,
  processUploadSession,
  queueUploadCompletion,
} from '../src/domain/uploadSessionService.js';

const input = {
  filename: 'clip.mp4',
  contentType: 'video/mp4',
  sizeBytes: 1024,
  source: 'uploaded-video' as const,
  folderId: null,
  idempotencyKey: 'upload-session-stable-key',
};

describe('uploadSessionService', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.withTransaction.mockImplementation(async callback => callback({ query: mocks.poolQuery }));
    mocks.createUploadSignature.mockImplementation(async (request: { objectKey: string }) => ({
      driver: 'local', method: 'PUT', uploadUrl: 'http://localhost/upload', headers: { 'content-type': 'video/mp4' },
      objectKey: request.objectKey,
      expiresAt: '2099-01-01T00:00:00.000Z', maxSizeBytes: 1024,
    }));
    mocks.enqueueUploadSession.mockResolvedValue(undefined);
    mocks.validateUploadedMediaDecoding.mockResolvedValue(undefined);
    mocks.createUploadedImageThumbnail.mockImplementation(async ({ thumbnailKey }) => thumbnailKey);
    mocks.createUploadedVideoPreview.mockImplementation(async ({ thumbnailKey }) => ({
      thumbnailKey, width: 16, height: 16, durationSeconds: 1,
    }));
  });

  it('同键同请求在 waiting-upload 时重签同一 staging key，不创建新会话', async () => {
    const existing = sessionRow({ request_hash: requestHash(input) });
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([existing]))
      .mockResolvedValueOnce(queryResult([{ ...existing, expires_at: '2099-01-01T00:00:00.000Z' }]));

    const result = await createOrReplayUploadSession('user-1', input);

    expect(result.signature).toEqual(expect.objectContaining({
      objectKey: existing.object_key,
      sessionId: existing.id,
    }));
    expect(mocks.createUploadSignature).toHaveBeenCalledWith(expect.objectContaining({ objectKey: existing.object_key }));
    expect(mocks.resolveAssetFolderId).not.toHaveBeenCalled();
  });

  it.each(['processing', 'completed'] as const)('%s 会话重放只返回 session，不重新签发写权限', async status => {
    const existing = sessionRow({
      request_hash: requestHash(input),
      status,
      processing_stage: status === 'completed' ? 'completed' : 'probing',
    });
    mocks.poolQuery.mockResolvedValueOnce(queryResult([existing]));

    await expect(createOrReplayUploadSession('user-1', input)).resolves.toMatchObject({ signature: null });
    expect(mocks.createUploadSignature).not.toHaveBeenCalled();
  });

  it('同幂等键请求事实变化时返回明确 409', async () => {
    mocks.poolQuery.mockResolvedValueOnce(queryResult([sessionRow({ request_hash: 'different' })]));
    await expect(createOrReplayUploadSession('user-1', input)).rejects.toMatchObject({
      statusCode: 409,
      code: 'UPLOAD_IDEMPOTENCY_CONFLICT',
    });
  });

  it('complete 只把 waiting-upload 原子推进 queued，并用下一个 attempt 的稳定 job id 入队', async () => {
    const pending = sessionRow();
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([pending]))
      .mockResolvedValueOnce(queryResult([{ ...pending, processing_stage: 'queued' }]));

    const result = await queueUploadCompletion('user-1', pending.id);

    expect(result).toMatchObject({ status: 'pending', processingStage: 'queued' });
    expect(mocks.enqueueUploadSession).toHaveBeenCalledWith(pending.id, 1);
  });

  it('上游交接使用同一事务，租约检查失败时不会修改上传状态或发布队列', async () => {
    const leaseLost = Object.assign(new Error('导入租约失效'), { code: 'MCP_FILE_TIMEOUT' });
    const beforeQueue = vi.fn(async (client) => {
      expect(client.query).toBe(mocks.poolQuery);
      throw leaseLost;
    });

    await expect(queueUploadCompletion('user-1', 'session-1', { beforeQueue })).rejects.toBe(leaseLost);

    expect(beforeQueue).toHaveBeenCalledOnce();
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.enqueueUploadSession).not.toHaveBeenCalled();
  });

  it('已取消的交接不启动事务或发布队列', async () => {
    const signal = AbortSignal.abort(new Error('worker stopping'));
    await expect(queueUploadCompletion('user-1', 'session-1', { signal })).rejects.toBe(signal.reason);
    expect(mocks.withTransaction).not.toHaveBeenCalled();
    expect(mocks.enqueueUploadSession).not.toHaveBeenCalled();
  });

  it('等待会话锁期间取消，事务拒绝且不推进 queued', async () => {
    const controller = new AbortController();
    const reason = new Error('deadline exceeded');
    const pending = sessionRow();
    mocks.poolQuery.mockImplementationOnce(async () => {
      controller.abort(reason);
      return queryResult([pending]);
    });

    await expect(queueUploadCompletion('user-1', pending.id, { signal: controller.signal }))
      .rejects.toBe(reason);
    expect(mocks.poolQuery).toHaveBeenCalledOnce();
    expect(mocks.enqueueUploadSession).not.toHaveBeenCalled();
  });

  it('入队状态写入期间取消仍让事务拒绝，不能在事务外发布队列', async () => {
    const controller = new AbortController();
    const reason = new Error('deadline exceeded');
    const pending = sessionRow();
    mocks.poolQuery.mockResolvedValueOnce(queryResult([pending])).mockImplementationOnce(async () => {
      controller.abort(reason);
      return queryResult([{ ...pending, processing_stage: 'queued' }]);
    });

    await expect(queueUploadCompletion('user-1', pending.id, { signal: controller.signal }))
      .rejects.toBe(reason);
    expect(mocks.enqueueUploadSession).not.toHaveBeenCalled();
  });

  it('complete 发现签名过期时先持久化 expired 与删除 Outbox，再在事务外返回 410', async () => {
    const pending = sessionRow({ expires_at: '2000-01-01T00:00:00.000Z' });
    const expired = sessionRow({
      ...pending,
      status: 'expired',
      processing_stage: 'expired',
      error_code: 'UPLOAD_SESSION_EXPIRED',
      error_message: '上传签名及宽限期已过期',
    });
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([pending]))
      .mockResolvedValueOnce(queryResult([expired]));

    await expect(queueUploadCompletion('user-1', pending.id)).rejects.toMatchObject({
      statusCode: 410,
      code: 'UPLOAD_SESSION_EXPIRED',
    });
    expect(mocks.scheduleObjectDeletion).toHaveBeenCalledWith(
      expect.anything(),
      pending.object_key,
      [],
      expect.any(Date),
    );
  });

  it('恢复器会将取消请求后崩溃且租约过期的 processing 会话终态化并安排清理', async () => {
    const canceled = sessionRow({
      status: 'canceled',
      processing_stage: 'canceled',
      cancel_requested_at: '2026-07-16T10:00:00.000Z',
      error_code: 'UPLOAD_CANCELED',
      error_message: '上传已取消',
    });
    mocks.poolQuery
      .mockResolvedValueOnce(queryResult([canceled]))
      .mockResolvedValueOnce(queryResult([]));

    await expect(enqueueRecoverableUploadSessions(10)).resolves.toBe(0);
    expect(String(mocks.poolQuery.mock.calls[0]?.[0])).toContain("SET status = 'canceled'");
    expect(mocks.scheduleObjectDeletion).toHaveBeenCalledWith(
      expect.anything(),
      canceled.final_object_key,
      [],
      null,
    );
  });

  it('完成资产与 session 的同一事务会为 staging key 写入延迟删除 Outbox', async () => {
    const claimed = sessionRow({
      source: 'uploaded-image', asset_type: 'image', content_type: 'image/png', filename: 'cover.png',
      asset_name: 'cover', status: 'processing', processing_stage: 'sealing', attempt: 1,
      lease_token: '00000000-0000-4000-8000-000000000099',
      lease_expires_at: '2099-01-01T00:00:00.000Z',
      folder_id: '00000000-0000-4000-8000-000000000055',
      final_object_key: 'users/user-1/uploads/00000000-0000-4000-8000-000000000001/cover.png',
    });
    installSuccessfulProcessingQueries(claimed);
    mocks.readStoredObjectSize.mockResolvedValue(1024);
    mocks.readUploadedMediaMetadata.mockResolvedValue({
      width: 1, height: 1, durationSeconds: null, hasVideo: true, hasAudio: false,
      formatName: 'png_pipe', frameCount: 1, videoCodec: 'png', majorBrand: null,
    });

    await expect(processUploadSession(claimed.id)).resolves.toEqual({ skipped: false, assetId: 'asset-1' });
    expect(mocks.resolveAssetFolderId).toHaveBeenCalledWith(expect.anything(), {
      userId: claimed.user_id,
      source: claimed.source,
      folderId: claimed.folder_id,
    });
    const sessionLockIndex = mocks.poolQuery.mock.calls.findIndex(([sql]) => (
      String(sql).includes("WHERE id = $1 AND status = 'processing'") && String(sql).includes('FOR UPDATE')
    ));
    expect(sessionLockIndex).toBeGreaterThanOrEqual(0);
    expect(mocks.resolveAssetFolderId.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.poolQuery.mock.invocationCallOrder[sessionLockIndex]!,
    );
    expect(mocks.validateUploadedMediaDecoding).toHaveBeenCalledWith({
      objectKey: claimed.final_object_key,
      assetType: 'image',
    });
    expect(mocks.scheduleObjectDeletion).toHaveBeenCalledWith(
      expect.anything(),
      claimed.object_key,
      [],
      expect.any(Date),
    );
  });

  it('目录删除先提交后使用数据库最新主目录完成资产，而不使用 worker 的旧目录快照', async () => {
    const oldFolderId = '00000000-0000-4000-8000-000000000055';
    const rootFolderId = '00000000-0000-4000-8000-000000000066';
    const claimed = audioProcessingSession({ folder_id: oldFolderId });
    const locked = {
      ...claimed,
      folder_id: rootFolderId,
      asset_name: '数据库最新音频名称',
    };
    installSuccessfulAudioProcessingQueries(claimed, [locked], [locked]);
    mocks.resolveAssetFolderId.mockResolvedValue(rootFolderId);
    installSuccessfulAudioMetadata();

    await expect(processUploadSession(claimed.id)).resolves.toEqual({ skipped: false, assetId: 'asset-1' });

    expect(mocks.resolveAssetFolderId).toHaveBeenCalledTimes(1);
    expect(mocks.resolveAssetFolderId).toHaveBeenCalledWith(expect.anything(), {
      userId: claimed.user_id,
      source: 'uploaded-audio',
      folderId: rootFolderId,
    });
    const insert = mocks.poolQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO assets'));
    expect(insert?.[1]?.slice(0, 6)).toEqual([
      claimed.user_id,
      rootFolderId,
      '数据库最新音频名称',
      'audio',
      'uploaded-audio',
      claimed.final_object_key,
    ]);
    expect(insert?.[1]?.[1]).not.toBe(oldFolderId);
  });

  it('观察旧目录后目录已删除时跨事务重读新主目录并只插入一份资产', async () => {
    const oldFolderId = '00000000-0000-4000-8000-000000000055';
    const rootFolderId = '00000000-0000-4000-8000-000000000066';
    const claimed = audioProcessingSession({ folder_id: oldFolderId });
    const moved = { ...claimed, folder_id: rootFolderId };
    installSuccessfulAudioProcessingQueries(claimed, [claimed, moved], [moved]);
    mocks.resolveAssetFolderId
      .mockRejectedValueOnce(Object.assign(new Error('旧目录已删除'), { code: 'ASSET_FOLDER_INVALID' }))
      .mockResolvedValueOnce(rootFolderId);
    installSuccessfulAudioMetadata();

    await expect(processUploadSession(claimed.id)).resolves.toEqual({ skipped: false, assetId: 'asset-1' });

    // claim 一次，持久化位置重试两次。
    expect(mocks.withTransaction).toHaveBeenCalledTimes(3);
    expect(mocks.resolveAssetFolderId).toHaveBeenCalledTimes(2);
    expect(mocks.resolveAssetFolderId.mock.calls.map(([, input]) => input.folderId)).toEqual([
      oldFolderId,
      rootFolderId,
    ]);
    const inserts = mocks.poolQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO assets'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.[1]?.[1]).toBe(rootFolderId);
  });

  it('锁目录后发现会话位置变化会释放事务并有限重试', async () => {
    const oldFolderId = '00000000-0000-4000-8000-000000000055';
    const rootFolderId = '00000000-0000-4000-8000-000000000066';
    const claimed = audioProcessingSession({ folder_id: oldFolderId });
    const moved = { ...claimed, folder_id: rootFolderId };
    installSuccessfulAudioProcessingQueries(claimed, [claimed, moved], [moved, moved]);
    mocks.resolveAssetFolderId
      .mockResolvedValueOnce(oldFolderId)
      .mockResolvedValueOnce(rootFolderId);
    installSuccessfulAudioMetadata();

    await expect(processUploadSession(claimed.id)).resolves.toEqual({ skipped: false, assetId: 'asset-1' });

    expect(mocks.withTransaction).toHaveBeenCalledTimes(3);
    const inserts = mocks.poolQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO assets'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.[1]?.[1]).toBe(rootFolderId);
  });

  it('缩略图 Put 成功但 session CAS 丢失时将 TOS 孤儿对象写入删除 Outbox', async () => {
    const claimed = sessionRow({
      source: 'uploaded-image', asset_type: 'image', content_type: 'image/png', filename: 'cover.png',
      asset_name: 'cover', status: 'processing', processing_stage: 'sealing', attempt: 1,
      lease_token: '00000000-0000-4000-8000-000000000099',
      lease_expires_at: '2099-01-01T00:00:00.000Z',
      final_object_key: 'users/user-1/uploads/00000000-0000-4000-8000-000000000001/cover.png',
    });
    const orphanThumbnailKey = `thumb/${claimed.id}.webp`;
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes("SET status = 'processing'")) return queryResult([claimed]);
      if (query.includes('SELECT 1 FROM upload_sessions')) return queryResult([{ '?column?': 1 }]);
      if (query.includes('SET sealed_at = COALESCE')) return queryResult([claimed]);
      // 新 worker 已接管：旧 lease token 不得把缩略图 key 写入 session。
      // 必须先匹配 SET 子句；该 SQL 的 WHERE 同样包含 processing_stage = 'thumbnailing'。
      if (query.includes('SET thumbnail_key = $3')) return queryResult([]);
      if (query.includes('SET processing_stage = $3') || query.includes("processing_stage = 'thumbnailing'")) {
        return queryResult([claimed]);
      }
      if (query.includes('SET status = CASE')) return queryResult([]);
      return queryResult([]);
    });
    mocks.readStoredObjectSize.mockResolvedValue(1024);
    mocks.readUploadedMediaMetadata.mockResolvedValue({
      width: 1, height: 1, durationSeconds: null, hasVideo: true, hasAudio: false,
      formatName: 'png_pipe', frameCount: 1, videoCodec: 'png', majorBrand: null,
    });
    mocks.createUploadedImageThumbnail.mockResolvedValue(orphanThumbnailKey);

    await expect(processUploadSession(claimed.id)).rejects.toMatchObject({ code: 'UPLOAD_LEASE_LOST' });
    expect(mocks.scheduleObjectDeletion).toHaveBeenCalledWith(
      expect.anything(),
      orphanThumbnailKey,
      [],
      expect.any(Date),
    );
  });

  it('音频会话拒绝包含视频流的伪装文件且不进入完整解码或资产事务', async () => {
    const claimed = sessionRow({
      filename: 'music.mp3', content_type: 'audio/mpeg', source: 'uploaded-audio', asset_type: 'audio',
      status: 'processing', processing_stage: 'sealing', attempt: 1,
      lease_token: '00000000-0000-4000-8000-000000000099',
      lease_expires_at: '2099-01-01T00:00:00.000Z',
      final_object_key: 'users/user-1/uploads/00000000-0000-4000-8000-000000000001/music.mp3',
    });
    installFailedProcessingQueries(claimed);
    mocks.readStoredObjectSize.mockResolvedValue(1024);
    mocks.readUploadedMediaMetadata.mockResolvedValue({
      width: 16, height: 16, durationSeconds: 1, hasVideo: true, hasAudio: true,
      formatName: 'mp3', frameCount: 1, videoCodec: 'h264', majorBrand: null,
    });

    await expect(processUploadSession(claimed.id)).rejects.toMatchObject({ code: 'UPLOAD_MEDIA_DETECTION_FAILED' });
    expect(mocks.validateUploadedMediaDecoding).not.toHaveBeenCalled();
  });

  it('视频缩略图失败不会静默完成，且上传成功前不写入 thumbnail key', async () => {
    const claimed = sessionRow({
      status: 'processing', processing_stage: 'sealing', attempt: 1,
      lease_token: '00000000-0000-4000-8000-000000000099',
      lease_expires_at: '2099-01-01T00:00:00.000Z',
    });
    installFailedProcessingQueries(claimed, true);
    mocks.readStoredObjectSize.mockResolvedValue(1024);
    mocks.readUploadedMediaMetadata.mockResolvedValue({
      width: 16, height: 16, durationSeconds: 1, hasVideo: true, hasAudio: false,
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2', frameCount: 24, videoCodec: 'h264', majorBrand: 'isom',
    });
    mocks.createUploadedVideoPreview.mockRejectedValue(Object.assign(new Error('thumbnail failed'), {
      code: 'UPLOAD_THUMBNAIL_FAILED',
    }));

    await expect(processUploadSession(claimed.id)).rejects.toMatchObject({ code: 'UPLOAD_THUMBNAIL_FAILED' });
    expect(mocks.poolQuery.mock.calls.some(([sql]) => (
      String(sql).includes("processing_stage = 'thumbnailing'") && String(sql).includes('thumbnail_key = $3')
    ))).toBe(false);
    expect(mocks.enqueueUploadSession).toHaveBeenCalledWith(claimed.id, 2);
  });

  it('媒体工具错误不把 TOS 签名 URL 写入会话或 BullMQ 失败原因', async () => {
    const claimed = sessionRow({
      status: 'processing', processing_stage: 'sealing', attempt: 1,
      lease_token: '00000000-0000-4000-8000-000000000099',
      lease_expires_at: '2099-01-01T00:00:00.000Z',
    });
    installFailedProcessingQueries(claimed, true);
    mocks.readStoredObjectSize.mockResolvedValue(1024);
    mocks.readUploadedMediaMetadata.mockResolvedValue({
      width: 16, height: 16, durationSeconds: 1, hasVideo: true, hasAudio: false,
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2', frameCount: 24, videoCodec: 'h264', majorBrand: 'isom',
    });
    const signedUrl = 'https://tos.invalid/video.mp4?X-Tos-Signature=do-not-persist';
    mocks.createUploadedVideoPreview.mockRejectedValue(Object.assign(
      new Error(`ffmpeg failed for ${signedUrl}`),
      { code: 'UPLOAD_THUMBNAIL_FAILED' },
    ));

    const failure = await processUploadSession(claimed.id).catch(error => error as Error & { code?: string });
    expect(failure).toMatchObject({ code: 'UPLOAD_THUMBNAIL_FAILED', message: '缩略图生成失败，请重试' });
    expect(JSON.stringify(failure)).not.toContain('X-Tos-Signature');
    if (!(failure instanceof Error)) throw new Error('预期上传处理抛出安全错误');
    expect(failure.message).not.toContain('tos.invalid');

    const failedUpdate = mocks.poolQuery.mock.calls.find(([sql]) => String(sql).includes('SET status = CASE'));
    expect(failedUpdate?.[1]?.[3]).toBe('缩略图生成失败，请重试');
    expect(JSON.stringify(failedUpdate?.[1])).not.toContain('X-Tos-Signature');
    expect(JSON.stringify(failedUpdate?.[1])).not.toContain('tos.invalid');
  });

  it('声明大小与 staging 实际大小不一致时永久失败，不复制也不自动重试', async () => {
    const claimed = sessionRow({
      status: 'processing', processing_stage: 'sealing', attempt: 1,
      lease_token: '00000000-0000-4000-8000-000000000099',
      lease_expires_at: '2099-01-01T00:00:00.000Z',
    });
    mocks.poolQuery.mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes("SET status = 'processing'")) return queryResult([claimed]);
      if (query.includes('SELECT 1 FROM upload_sessions')) return queryResult([{ '?column?': 1 }]);
      if (query.includes('SET status = CASE')) return queryResult([{ ...claimed, status: 'failed', processing_stage: 'failed', retryable: false }]);
      return queryResult([]);
    });
    mocks.readStoredObjectSize.mockResolvedValueOnce(1000);

    await expect(processUploadSession(claimed.id)).rejects.toMatchObject({ code: 'UPLOAD_SIZE_MISMATCH' });
    expect(mocks.copyStoredObject).not.toHaveBeenCalled();
    expect(mocks.enqueueUploadSession).not.toHaveBeenCalled();
  });
});

function requestHash(value: typeof input) {
  return createHash('sha256').update(JSON.stringify({
    filename: value.filename,
    contentType: value.contentType,
    sizeBytes: value.sizeBytes,
    source: value.source,
    folderId: value.folderId,
  })).digest('hex');
}

function sessionRow(patch: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    user_id: 'user-1',
    object_key: 'users/user-1/upload-staging/00000000-0000-4000-8000-000000000001/clip.mp4',
    filename: 'clip.mp4',
    content_type: 'video/mp4',
    max_size_bytes: 1024,
    status: 'pending',
    asset_id: null,
    expires_at: '2099-01-01T00:00:00.000Z',
    completed_at: null,
    updated_at: '2026-07-16T10:00:00.000Z',
    idempotency_key: input.idempotencyKey,
    request_hash: requestHash(input),
    source: 'uploaded-video',
    asset_type: 'video',
    asset_name: 'clip',
    folder_id: null as string | null,
    final_object_key: 'users/user-1/uploads/00000000-0000-4000-8000-000000000001/clip.mp4',
    thumbnail_key: null,
    actual_size_bytes: null,
    sealed_at: null,
    sealed_size_bytes: null,
    retryable: false,
    attempt: 0,
    lease_token: null,
    lease_expires_at: null,
    heartbeat_at: null,
    processing_stage: 'waiting-upload',
    error_code: null,
    error_message: null,
    cancel_requested_at: null,
    retention_until: '2099-01-02T00:00:00.000Z',
    ...patch,
  };
}

function queryResult(rows: unknown[]) {
  return { rowCount: rows.length, rows };
}

function audioProcessingSession(patch: Record<string, unknown> = {}) {
  return sessionRow({
    filename: 'music.mp3',
    content_type: 'audio/mpeg',
    source: 'uploaded-audio',
    asset_type: 'audio',
    asset_name: 'music',
    status: 'processing',
    processing_stage: 'sealing',
    attempt: 1,
    lease_token: '00000000-0000-4000-8000-000000000099',
    lease_expires_at: '2099-01-01T00:00:00.000Z',
    folder_id: '00000000-0000-4000-8000-000000000055',
    final_object_key: 'users/user-1/uploads/00000000-0000-4000-8000-000000000001/music.mp3',
    ...patch,
  });
}

function installSuccessfulAudioMetadata() {
  mocks.readStoredObjectSize.mockResolvedValue(1024);
  mocks.readUploadedMediaMetadata.mockResolvedValue({
    width: null,
    height: null,
    durationSeconds: 1,
    hasVideo: false,
    hasAudio: true,
    formatName: 'mp3',
    frameCount: null,
    videoCodec: null,
    majorBrand: null,
  });
}

function installSuccessfulAudioProcessingQueries(
  claimed: ReturnType<typeof sessionRow>,
  observedRows: Array<ReturnType<typeof sessionRow>>,
  lockedRows: Array<ReturnType<typeof sessionRow>>,
) {
  let observedIndex = 0;
  let lockedIndex = 0;
  mocks.poolQuery.mockImplementation(async (sql: unknown) => {
    const query = String(sql);
    if (query.includes("SET status = 'processing'")) return queryResult([claimed]);
    if (query.includes('SELECT 1 FROM upload_sessions')) return queryResult([{ '?column?': 1 }]);
    if (query.includes('SET sealed_at = COALESCE')) return queryResult([claimed]);
    if (query.includes('SET processing_stage = $3')) return queryResult([claimed]);
    if (query.includes('SELECT user_id, source, folder_id')) {
      return queryResult([observedRows[Math.min(observedIndex++, observedRows.length - 1)]!]);
    }
    if (query.includes('WHERE id = $1 AND status = \'processing\'') && query.includes('FOR UPDATE')) {
      return queryResult([lockedRows[Math.min(lockedIndex++, lockedRows.length - 1)]!]);
    }
    if (query.includes('INSERT INTO assets')) return queryResult([{ id: 'asset-1' }]);
    if (query.includes("SET status = 'completed'")) return queryResult([{ ...claimed, status: 'completed' }]);
    return queryResult([]);
  });
}

function installSuccessfulProcessingQueries(claimed: ReturnType<typeof sessionRow>) {
  const persistedThumbnailKey = claimed.asset_type === 'image'
    ? `thumb/${claimed.id}.webp`
    : claimed.asset_type === 'video'
      ? `thumb/${claimed.id}.jpg`
      : claimed.thumbnail_key;
  mocks.poolQuery.mockImplementation(async (sql: unknown) => {
    const query = String(sql);
    if (query.includes("SET status = 'processing'")) return queryResult([claimed]);
    if (query.includes('SELECT 1 FROM upload_sessions')) return queryResult([{ '?column?': 1 }]);
    if (query.includes('SET sealed_at = COALESCE')) return queryResult([claimed]);
    if (query.includes('SET processing_stage = $3')) return queryResult([claimed]);
    if (query.includes("SET processing_stage = 'thumbnailing'")) return queryResult([claimed]);
    if (query.includes('SET thumbnail_key = $3')) return queryResult([{ ...claimed, thumbnail_key: persistedThumbnailKey }]);
    if (query.includes('SELECT user_id, source, folder_id')) return queryResult([claimed]);
    if (query.includes('WHERE id = $1 AND status = \'processing\'') && query.includes('FOR UPDATE')) {
      return queryResult([{
        ...claimed,
        thumbnail_key: persistedThumbnailKey,
        sealed_at: '2026-07-16T10:00:00.000Z',
        sealed_size_bytes: 1024,
      }]);
    }
    if (query.includes('INSERT INTO assets')) return queryResult([{ id: 'asset-1' }]);
    if (query.includes("SET status = 'completed'")) return queryResult([{ ...claimed, status: 'completed' }]);
    return queryResult([]);
  });
}

function installFailedProcessingQueries(claimed: ReturnType<typeof sessionRow>, retryAutomatically = false) {
  mocks.poolQuery.mockImplementation(async (sql: unknown) => {
    const query = String(sql);
    if (query.includes("SET status = 'processing'")) return queryResult([claimed]);
    if (query.includes('SELECT 1 FROM upload_sessions')) return queryResult([{ '?column?': 1 }]);
    if (query.includes('SET sealed_at = COALESCE')) return queryResult([claimed]);
    if (query.includes('SET processing_stage = $3') || query.includes("processing_stage = 'thumbnailing'")) {
      return queryResult([claimed]);
    }
    if (query.includes('SET status = CASE')) {
      return queryResult([{
        ...claimed,
        status: retryAutomatically ? 'pending' : 'failed',
        processing_stage: retryAutomatically ? 'queued' : 'failed',
        retryable: false,
        thumbnail_key: retryAutomatically ? `thumb/${claimed.id}.jpg` : claimed.thumbnail_key,
      }]);
    }
    return queryResult([]);
  });
}
