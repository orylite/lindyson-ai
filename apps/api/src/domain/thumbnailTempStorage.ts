import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function thumbnailTempRoot() {
  return path.resolve(env.THUMBNAIL_TEMP_ROOT ?? path.join(os.tmpdir(), 'lindyson-thumbnails'));
}

/**
 * 仅供确实无法使用内存管道的媒体工具使用。当前 Sharp 与 FFmpeg 缩略图链路
 * 均不调用此函数；保留这个受控边界，避免以后出现散落且无法回收的临时文件。
 */
export async function withThumbnailTempDirectory<T>(
  jobId: string,
  leaseToken: string,
  run: (directory: string) => Promise<T>,
) {
  assertUuid(jobId, '缩略图任务 ID');
  assertUuid(leaseToken, '缩略图租约 token');
  const root = thumbnailTempRoot();
  const directory = path.join(root, jobId, leaseToken);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  try {
    return await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
    await removeEmptyDirectory(path.dirname(directory));
  }
}

export async function writeThumbnailTempFile(directory: string, filename: string, body: Buffer | Uint8Array) {
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) throw new Error('非法缩略图临时文件名');
  const root = thumbnailTempRoot();
  const target = path.resolve(directory, filename);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error('缩略图临时文件超出允许目录');
  await fs.writeFile(target, body, { flag: 'wx', mode: 0o600 });
  return target;
}

export async function sweepOrphanThumbnailTempDirectories(now = Date.now()) {
  const root = thumbnailTempRoot();
  const jobEntries = await readDirectories(root);
  let scanned = 0;
  let removed = 0;
  let active = 0;
  let bytes = 0;

  for (const job of jobEntries) {
    if (!UUID_PATTERN.test(job.name)) continue;
    const jobPath = path.join(root, job.name);
    for (const lease of await readDirectories(jobPath)) {
      if (!UUID_PATTERN.test(lease.name)) continue;
      scanned += 1;
      const leasePath = path.join(jobPath, lease.name);
      const stats = await fs.lstat(leasePath).catch(() => null);
      if (!stats?.isDirectory() || stats.isSymbolicLink()) continue;
      bytes += await directorySize(leasePath);
      if (now - stats.mtimeMs < env.THUMBNAIL_TEMP_MAX_AGE_MS) continue;
      if (await hasActiveThumbnailLease(job.name, lease.name)) {
        active += 1;
        continue;
      }
      await fs.rm(leasePath, { recursive: true, force: true });
      removed += 1;
    }
    await removeEmptyDirectory(jobPath);
  }

  return { scanned, removed, active, bytes };
}

async function hasActiveThumbnailLease(jobId: string, leaseToken: string) {
  const result = await pool.query(
    `SELECT 1
     FROM upload_sessions
     WHERE id = $1 AND lease_token = $2 AND status = 'processing' AND lease_expires_at > now()
     UNION ALL
     SELECT 1
     FROM generation_provider_runs
     WHERE id = $1 AND lease_token = $2 AND lease_expires_at > now()
     UNION ALL
     SELECT 1
     FROM generation_tasks
     WHERE id = $1 AND claim_token = $2 AND status = 'processing' AND lease_expires_at > now()
     LIMIT 1`,
    [jobId, leaseToken],
  );
  return Boolean(result.rowCount);
}

async function readDirectories(directory: string) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink());
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

async function removeEmptyDirectory(directory: string) {
  try {
    await fs.rmdir(directory);
  } catch (error) {
    if (isMissing(error) || isNotEmpty(error)) return;
    throw error;
  }
}

async function directorySize(directory: string): Promise<number> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return 0;
    throw error;
  }

  let bytes = 0;
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      bytes += await directorySize(target);
      continue;
    }
    if (!entry.isFile()) continue;
    const stats = await fs.lstat(target).catch(() => null);
    if (stats?.isFile() && !stats.isSymbolicLink()) bytes += stats.size;
  }
  return bytes;
}

function assertUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} 无效`);
}

function isMissing(error: unknown) {
  return Boolean(error) && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT';
}

function isNotEmpty(error: unknown) {
  return Boolean(error) && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOTEMPTY';
}
