import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  createImageThumbnailBuffer,
  parseMediaProbeOutput,
  runMediaCommandBuffer,
} from '../src/storage/mediaProcessor.js';

describe('mediaProcessor', () => {
  it('图片缩略图通过内存流生成 512px 内的 WebP', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const output = await createImageThumbnailBuffer(Readable.from([png]));

    expect(output.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(output.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it('媒体子进程超时时使用 SIGKILL 终止并只拒绝一次', async () => {
    await expect(runMediaCommandBuffer(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { timeoutMs: 30, maxOutputBytes: 1024 },
    )).rejects.toThrow('执行超时');
  });

  it('媒体子进程 stdout 超限时立即终止，不继续缓存', async () => {
    await expect(runMediaCommandBuffer(
      process.execPath,
      ['-e', "process.stdout.write('x'.repeat(4096))"],
      { timeoutMs: 1000, maxOutputBytes: 128 },
    )).rejects.toThrow('stdout 超出 128 字节上限');
  });

  it('音频内的 attached picture 不被误识别为可播放视频流', () => {
    const metadata = parseMediaProbeOutput(JSON.stringify({
      streams: [
        { codec_type: 'audio', codec_name: 'mp3' },
        {
          codec_type: 'video', codec_name: 'mjpeg', width: 600, height: 600,
          disposition: { attached_pic: 1 },
        },
      ],
      format: { duration: '12.5', format_name: 'mp3' },
    }));

    expect(metadata).toMatchObject({
      hasAudio: true,
      hasVideo: false,
      width: null,
      height: null,
      durationSeconds: 12.5,
      videoCodec: null,
    });
  });

  it('同时存在封面和真实视频时只读取可播放视频元数据', () => {
    const metadata = parseMediaProbeOutput(JSON.stringify({
      streams: [
        {
          codec_type: 'video', codec_name: 'mjpeg', width: 600, height: 600,
          disposition: { attached_pic: 1 },
        },
        {
          codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080,
          duration: '5', nb_frames: '120', disposition: { attached_pic: 0 },
        },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
      format: { duration: '5', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
    }));

    expect(metadata).toMatchObject({
      hasAudio: true,
      hasVideo: true,
      width: 1920,
      height: 1080,
      durationSeconds: 5,
      frameCount: 120,
      videoCodec: 'h264',
    });
  });
});
