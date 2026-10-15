import type { PromptWizardCreativeBrief } from '@lindyson/api-contracts';
import type { PromptWizardPlanIndex } from './promptWizardPlanCount.js';
import type { PromptWizardStrategy } from './promptWizardStrategy.js';

/**
 * 方案扩写阶段使用的中立创意上下文。
 *
 * 该类型由 3.0 创意导演产出的 Concept Preview 确定性转换而来，
 * 是创意路线到双方案脚本扩写的中立内部上下文。
 */
export interface PromptWizardConceptAssignment {
  planIndex: PromptWizardPlanIndex;
  candidateId: string;
  direction: PromptWizardCreativeBrief['direction'];
  strategy: PromptWizardStrategy;
  targetAudience: string;
  audienceMotivation: string;
  openingAction: string;
  scene: string;
  perspective: string;
  painExpression: string;
  progression: string;
  proofAction: string;
  midpointEscalation: string;
  visibleResult: string;
  evidenceIds: string[];
  evidenceFactIds: string[];
  cameraSoundGrammar: string;
  cta: string;
  fingerprint: PromptWizardConceptFingerprint;
  score: PromptWizardConceptScore;
  conservative: boolean;
  providerContext: {
    creativePremise: string;
    opening: string;
    proof: string;
    progression: string;
    midpointEscalation: string;
    visibleResult: string;
    cameraAndSound: string;
    cta: string;
  };
}

export interface PromptWizardConceptFingerprint {
  audienceMotivation: string;
  openingAction: string;
  scene: string;
  perspective: string;
  evidenceMode: string;
  cameraSoundGrammar: string;
}

export interface PromptWizardConceptScore {
  visualStop: number;
  productSpecificity: number;
  evidenceCredibility: number;
  novelty: number;
  directionPurity: number;
  marketingFit: number;
  feasibility: number;
  total: number;
}

export function promptWizardConceptFingerprintDifference(
  left: PromptWizardConceptFingerprint,
  right: PromptWizardConceptFingerprint,
) {
  const keys = Object.keys(left) as Array<keyof PromptWizardConceptFingerprint>;
  return keys.reduce((count, key) => count + Number(left[key] !== right[key]), 0);
}
