import { describe,expect,it } from 'vitest';
import type { ImageGenerationAnnotation } from '../data/admin';
import { getImageAnnotationCanvasBackgroundStyle,nextAnnotationToken,normalizeBboxCoordinates,normalizeImagePoint,removeAnnotationToken } from './ImageAnnotationCanvas';

describe('Seedream 交互编辑画布底纹', () => {
  it('仅在预览就绪时启用两级网格，关闭时保留中性画布底色', () => {
    const activeStyle = getImageAnnotationCanvasBackgroundStyle(true);
    expect(activeStyle.backgroundColor).toBe('#090912');
    expect(activeStyle.backgroundImage?.split('linear-gradient')).toHaveLength(5);
    expect(activeStyle.backgroundSize).toBe('96px 96px, 96px 96px, 24px 24px, 24px 24px');
    expect(activeStyle.backgroundPosition).toBe('center center');

    expect(getImageAnnotationCanvasBackgroundStyle(false)).toEqual({
      backgroundColor: '#090912',
      backgroundImage: 'none',
    });
  });
});

describe('Seedream 交互编辑坐标', () => {
  const transformedImageRect = { left: 120, top: 80, width: 400, height: 200 };

  it('使用实际图片矩形换算坐标，不把 object-contain 留白计入图片', () => {
    expect(normalizeImagePoint(320, 180, transformedImageRect)).toEqual({ x: 500, y: 500 });
    expect(normalizeImagePoint(120, 80, transformedImageRect)).toEqual({ x: 0, y: 0 });
    expect(normalizeImagePoint(520, 280, transformedImageRect)).toEqual({ x: 999, y: 999 });
  });

  it('点在图片外时拒绝创建，拖框结束点允许钳制到边界', () => {
    expect(normalizeImagePoint(100, 60, transformedImageRect)).toBeNull();
    expect(normalizeImagePoint(600, 300, transformedImageRect, true)).toEqual({ x: 999, y: 999 });
    expect(normalizeImagePoint(0, 0, transformedImageRect, true)).toEqual({ x: 0, y: 0 });
  });

  it('反向拖框始终输出左上到右下的坐标顺序', () => {
    expect(normalizeBboxCoordinates({ x: 800, y: 700 }, { x: 120, y: 90 }))
      .toEqual({ x1: 120, y1: 90, x2: 800, y2: 700 });
  });
});

describe('Seedream 标记 token', () => {
  it('删除 token 时支持紧邻中文，并且不会误删更长编号', () => {
    expect(removeAnnotationToken('将@标记1的主体放到@标记10附近', '@标记1'))
      .toBe('将的主体放到@标记10附近');
  });

  it('删除后不复用既有最大编号，保持标记引用稳定', () => {
    const annotations: ImageGenerationAnnotation[] = [{
      token: '@标记3',
      assetId: 'asset-1',
      type: 'point',
      x: 500,
      y: 500,
    }];
    expect(nextAnnotationToken(annotations)).toBe('@标记4');
  });
});
