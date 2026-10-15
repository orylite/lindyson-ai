import { describe, expect, it } from 'vitest';
import {
  PROMPT_WIZARD_FLAT_SCALAR_IMAGE_PROBE_RESULT,
  verifyPromptWizardFlatScalarImageContract,
} from '../src/tools/verifyPromptWizardFlatScalarContract.js';

describe('V6 Flat Scalar 候选镜像语义探针', () => {
  it('执行生产布局与 Schema 生成器并覆盖 15 批五种语言', () => {
    expect(verifyPromptWizardFlatScalarImageContract()).toEqual({
      caseCount: 15,
      voiceoverCaseCount: 10,
      languageCount: 5,
    });
    expect(PROMPT_WIZARD_FLAT_SCALAR_IMAGE_PROBE_RESULT)
      .toBe('prompt-wizard-flat-scalars-v2-contract=passed');
  });
});
