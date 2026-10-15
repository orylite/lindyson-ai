import { describe, expect, it } from 'vitest';
import { getAIStudioAspectRatioFrameSize } from './AIStudioCompactControls';

describe('AI Studio 画幅预览尺寸', () => {
  it('在固定舞台内保持横竖比并限制最大宽高', () => {
    const square = getAIStudioAspectRatioFrameSize('1:1', 136, 62);
    const portrait = getAIStudioAspectRatioFrameSize('9:16', 136, 62);
    const ultrawide = getAIStudioAspectRatioFrameSize('21:9', 136, 62);

    expect(square).toEqual({ width: 62, height: 62 });
    expect(portrait).toEqual({ width: 34.88, height: 62 });
    expect(ultrawide).toEqual({ width: 136, height: 58.29 });
  });

  it.each([
    ['1:1', 1],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['3:2', 3 / 2],
    ['2:3', 2 / 3],
    ['21:9', 21 / 9],
  ])('图片比例 %s 的缩略框保持真实宽高比', (ratio, expectedRatio) => {
    const frame = getAIStudioAspectRatioFrameSize(ratio, 28, 18);
    expect(frame).not.toBeNull();
    expect(frame!.width).toBeLessThanOrEqual(28);
    expect(frame!.height).toBeLessThanOrEqual(18);
    expect(frame!.width / frame!.height).toBeCloseTo(expectedRatio, 2);
  });

  it('自适应与非法比例不生成伪造的固定画幅', () => {
    expect(getAIStudioAspectRatioFrameSize('adaptive', 136, 62)).toBeNull();
    expect(getAIStudioAspectRatioFrameSize('0:9', 136, 62)).toBeNull();
    expect(getAIStudioAspectRatioFrameSize('9:0', 136, 62)).toBeNull();
  });
});
