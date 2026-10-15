import { describe, expect, it } from 'vitest';
import { isPermanentImageDecodeFailure } from '../src/tools/backfillImageThumbnails.js';

describe('历史图片缩略图回填错误分类', () => {
  it.each([
    'Input buffer contains unsupported image format',
    'VipsJpeg: premature end of JPEG file',
    'VipsForeignLoad: unable to load from source',
    'Input image exceeds pixel limit',
  ])('明确的图片内容错误会永久使用占位图：%s', message => {
    const wrapped = Object.assign(new Error('上传图片缩略图生成失败'), {
      cause: new Error(message),
    });
    expect(isPermanentImageDecodeFailure(wrapped)).toBe(true);
  });

  it.each([
    'read ECONNRESET',
    'TOS request timed out',
    'InvalidAccessKeyId: The Access Key Id does not exist',
    'SignatureDoesNotMatch: invalid signature',
    'Service returned HTTP 503',
  ])('网络、存储和鉴权错误保持可重试：%s', message => {
    expect(isPermanentImageDecodeFailure(new Error(message))).toBe(false);
  });

  it('循环 cause 不会导致分类器死循环', () => {
    const error = new Error('暂时性错误') as Error & { cause?: unknown };
    error.cause = error;
    expect(isPermanentImageDecodeFailure(error)).toBe(false);
  });
});
