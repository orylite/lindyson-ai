import { describe, expect, it } from 'vitest';
import {
  materializeReviewedFactPack,
  materializeTkPromptEvidenceProfile,
  tkPromptImageMimeType,
} from '../src/domain/tkPromptEngineService.js';

const imageIds = [
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000202',
] as const;

describe('TK Prompt Engine 事实动作闭包', () => {
  it('事实分析把动作绑定为稳定 ID、支撑事实与原图来源', () => {
    const profile = materializeTkPromptEvidenceProfile(factAnalysis(), images());
    expect(profile.demonstrableActions).toEqual([{
      actionId: 'action-001',
      text: '手部按下左侧结构',
      supportingFactIds: ['visible-001'],
      sourceImageAssetIds: [imageIds[0]],
    }, {
      actionId: 'action-002',
      text: '手部旋转右侧旋钮',
      supportingFactIds: ['visible-002'],
      sourceImageAssetIds: [imageIds[1]],
    }]);
  });

  it('用户拒绝支撑事实后过滤对应动作且保留其余稳定 actionId', () => {
    const profile = materializeTkPromptEvidenceProfile(factAnalysis(), images());
    const factPack = materializeReviewedFactPack({
      evidenceProfile: profile,
      evidenceReview: {
        productName: '参考商品',
        category: '家居用品',
        rejectedVisibleFactIds: ['visible-001'],
        userConfirmedFacts: [],
        forbiddenClaims: [],
      },
      creativeInput: {
        targetMarket: 'United States',
        targetAudience: '',
        verifiedOffer: '',
        appearance: { mode: 'product_closeup' },
        availableScenes: [],
        availableAssets: [],
      },
    });

    expect(factPack.facts.map(fact => fact.factId)).toEqual(['visible-002']);
    expect(factPack.demonstrableActions).toEqual([{
      actionId: 'action-002',
      text: '手部旋转右侧旋钮',
      supportingFactIds: ['visible-002'],
      sourceImageAssetIds: [imageIds[1]],
    }]);
  });

  it('Provider 动作引用越界事实序号时返回明确合同错误', () => {
    const invalid = factAnalysis();
    invalid.demonstrableActions[0]!.supportingFactIndexes = [2];
    expect(() => materializeTkPromptEvidenceProfile(invalid, images()))
      .toThrow(/存在的图片事实序号/u);
  });

  it('无后缀商品图使用已完成上传会话的可信 JPEG/PNG 类型', () => {
    expect(tkPromptImageMimeType({
      objectKey: 'users/user/uploads/session/product',
      uploadContentType: 'image/jpeg',
    })).toBe('image/jpeg');
    expect(tkPromptImageMimeType({
      objectKey: 'users/user/uploads/session/product',
      uploadContentType: 'image/png',
    })).toBe('image/png');
  });

  it('已有上传类型不可信时拒绝且不按伪造后缀降级，缺失记录只允许安全后缀回退', () => {
    expect(() => tkPromptImageMimeType({
      objectKey: 'users/user/uploads/session/product.jpg',
      uploadContentType: 'text/plain',
    })).toThrow(/可信 JPEG、PNG 或 WebP/u);
    expect(tkPromptImageMimeType({
      objectKey: 'users/user/historical/product.webp',
    })).toBe('image/webp');
    expect(() => tkPromptImageMimeType({
      objectKey: 'users/user/historical/product',
    })).toThrow(/可信 JPEG、PNG 或 WebP/u);
  });
});

function factAnalysis() {
  return {
    productName: '参考商品',
    category: '家居用品',
    confidence: 'high' as const,
    visibleFacts: [{
      text: '左侧有可按压结构',
      sourceImageIndexes: [0],
      confidence: 'high' as const,
    }, {
      text: '右侧有可旋转旋钮',
      sourceImageIndexes: [1],
      confidence: 'high' as const,
    }],
    internalHypotheses: [],
    demonstrableActions: [{
      actionId: 'action-001',
      text: '手部按下左侧结构',
      supportingFactIndexes: [0],
    }, {
      actionId: 'action-002',
      text: '手部旋转右侧旋钮',
      supportingFactIndexes: [1],
    }],
  };
}

function images() {
  return imageIds.map((assetId, index) => ({
    assetId,
    name: `product-${index + 1}.png`,
    url: `https://assets.example.com/product-${index + 1}.png`,
    mimeType: 'image/png' as const,
    sizeBytes: 1_024,
  }));
}
