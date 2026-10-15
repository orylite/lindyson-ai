import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Writable, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type sharpFactory from '../../../../node_modules/sharp/lib/index.js';
import { env } from '../config/env.js';

const sharp = createRequire(import.meta.url)('sharp') as typeof sharpFactory;

class AsyncSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>) {
    if (this.active >= this.limit) {
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

sharp.cache({ files: 0, items: 20, memory: 64 });

const imageThumbnailSlots = new AsyncSemaphore(env.THUMBNAIL_IMAGE_CONCURRENCY);
const videoThumbnailSlots = new AsyncSemaphore(env.THUMBNAIL_VIDEO_CONCURRENCY);

export interface MediaMetadata {
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  formatName: string | null;
  frameCount: number | null;
  videoCodec: string | null;
  majorBrand: string | null;
}

export async function probeMedia(filePath: string): Promise<MediaMetadata> {
  const output = await runCommand('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,codec_name,width,height,duration,nb_frames:stream_disposition=attached_pic:format=format_name,duration:format_tags=major_brand',
    '-of',
    'json',
    filePath,
  ]);
  return parseMediaProbeOutput(output);
}

/** 仅导出纯解析边界，便于用固定 ffprobe JSON 验证媒体分类。 */
export function parseMediaProbeOutput(output: string): MediaMetadata {
  const parsed = JSON.parse(output) as {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      duration?: string;
      nb_frames?: string;
      disposition?: { attached_pic?: number };
    }>;
    format?: { duration?: string; format_name?: string; tags?: { major_brand?: string } };
  };
  // MP3/WAV 可以合法携带专辑封面，ffprobe 会把封面暴露为 video stream。
  // 它不是可播放视频，不应导致音频上传被误拒，也不应覆盖真实视频的元数据。
  const videoStream = parsed.streams?.find(stream => (
    stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1
  ));
  const duration = toFiniteNumber(videoStream?.duration ?? parsed.format?.duration);

  return {
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    durationSeconds: duration,
    hasVideo: Boolean(videoStream),
    hasAudio: Boolean(parsed.streams?.some(stream => stream.codec_type === 'audio')),
    formatName: parsed.format?.format_name ?? null,
    frameCount: toPositiveInteger(videoStream?.nb_frames),
    videoCodec: videoStream?.codec_name ?? null,
    majorBrand: parsed.format?.tags?.major_brand ?? null,
  };
}

/**
 * ffprobe 只读取容器和流元数据，无法证明整个媒体都可解码。上传封口后必须让
 * ffmpeg 消费目标流到 EOF；`-xerror` 会把损坏帧提升为非零退出码。
 */
export async function validateMediaDecoding(
  inputUrl: string,
  assetType: 'video' | 'image' | 'audio',
) {
  const mappings = assetType === 'video'
    ? ['-map', '0:v:0', '-map', '0:a?']
    : assetType === 'audio'
      ? ['-map', '0:a:0']
      : ['-map', '0:v:0'];
  await runMediaCommandBuffer('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-xerror',
    '-nostdin',
    '-i',
    inputUrl,
    ...mappings,
    '-f',
    'null',
    '-',
  ]);
}

export async function createVideoThumbnailBuffer(inputUrl: string) {
  return videoThumbnailSlots.run(() => runMediaCommandBuffer('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      inputUrl,
      '-frames:v',
      '1',
      '-vf',
      'scale=720:-1',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      'pipe:1',
    ]));
}

/** 图片从对象存储直接流入 libvips，输出为内存中的 512px WebP，不写本地文件。 */
export async function createImageThumbnailBuffer(input: Readable) {
  return imageThumbnailSlots.run(async () => {
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    const collector = new Writable({
      write(chunk, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        outputBytes += buffer.length;
        if (outputBytes > env.MEDIA_COMMAND_MAX_OUTPUT_BYTES) {
          callback(new Error(`图片缩略图超出 ${env.MEDIA_COMMAND_MAX_OUTPUT_BYTES} 字节上限`));
          return;
        }
        chunks.push(buffer);
        callback();
      },
    });
    const transformer = sharp({
      failOn: 'error',
      limitInputPixels: 100_000_000,
      sequentialRead: true,
    })
      .autoOrient()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 });

    await pipeline(input, transformer, collector);
    const output = Buffer.concat(chunks);
    if (output.length === 0) throw new Error('Sharp 未输出图片缩略图');
    return output;
  });
}

function runCommand(command: string, args: string[]) {
  return runMediaCommandBuffer(command, args).then(output => output.toString('utf8'));
}

export function runMediaCommandBuffer(
  command: string,
  args: string[],
  options: { timeoutMs?: number; maxOutputBytes?: number } = {},
) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeoutMs = options.timeoutMs ?? env.MEDIA_COMMAND_TIMEOUT_MS;
    const maxOutputBytes = options.maxOutputBytes ?? env.MEDIA_COMMAND_MAX_OUTPUT_BYTES;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const terminate = (error: Error) => {
      settle(() => {
        child.kill('SIGKILL');
        reject(error);
      });
    };
    const timeout = setTimeout(() => {
      terminate(new Error(`${command} 执行超时（${timeoutMs}ms）`));
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      if (settled) return;
      const buffer = Buffer.from(chunk);
      stdoutBytes += buffer.length;
      if (stdoutBytes > maxOutputBytes) {
        terminate(new Error(`${command} stdout 超出 ${maxOutputBytes} 字节上限`));
        return;
      }
      stdout.push(buffer);
    });
    child.stderr.on('data', chunk => {
      if (settled) return;
      const buffer = Buffer.from(chunk);
      stderrBytes += buffer.length;
      if (stderrBytes > maxOutputBytes) {
        terminate(new Error(`${command} stderr 超出 ${maxOutputBytes} 字节上限`));
        return;
      }
      stderr.push(buffer);
    });
    child.on('error', error => settle(() => reject(error)));
    child.on('close', code => {
      if (settled) return;
      if (code === 0) {
        settle(() => resolve(Buffer.concat(stdout)));
        return;
      }

      settle(() => reject(new Error(Buffer.concat(stderr).toString('utf8') || `${command} 执行失败`)));
    });
  });
}

function toFiniteNumber(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveInteger(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
