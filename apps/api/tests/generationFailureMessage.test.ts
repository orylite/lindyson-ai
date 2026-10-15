import { describe, expect, it } from 'vitest';
import { getUserVisibleGenerationFailureReason } from '../src/domain/generationFailureMessage.js';

describe('生成失败用户文案', () => {
  it.each([
    'ratio must be adaptive for first frame generation',
    'reference_video duration exceeds limit',
    'omni_reference_task_type is invalid',
  ])('将 Seedance 参数错误收敛为可操作的安全提示：%s', reason => {
    expect(getUserVisibleGenerationFailureReason('provider-error', reason, 'failed'))
      .toBe('参考素材或生成参数不符合模型要求，请调整后重试。');
  });

  it('不向用户暴露未识别的供应商原始错误', () => {
    expect(getUserVisibleGenerationFailureReason('provider-error', 'request_id=secret raw error', 'failed'))
      .toBe('生成服务暂时不可用，请稍后重试。');
  });
});
