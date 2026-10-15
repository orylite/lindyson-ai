export type CreditBucket = 'main' | 'addon' | 'mixed' | 'system';
export type GenerationKind = 'video' | 'image';
export type GenerationStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';
export type JobFailureCategory = 'insufficient-credits' | 'provider-failed' | 'content-policy' | 'user-canceled' | 'system-timeout';
export type ProviderUsageUnit = 'tokens' | 'credits';
export type ProviderBillableBasis = 'completion_tokens';

export interface ProviderUsageMetrics {
  generatedImages?: number | null;
  outputTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  billableTokens?: number | null;
  billableBasis?: ProviderBillableBasis | null;
  /** 供应商报告的终态时间；无法取得时保持为空，不能用任务创建时间伪造。 */
  providerTerminalAt?: string | null;
  /** 本系统首次观察到该次供应商用量的时间。 */
  usageObservedAt?: string | null;
}

export interface ProviderUsageObservation extends ProviderUsageMetrics {
  provider: string;
  providerTaskId: string;
  status: 'success' | 'failed';
  error?: string | null;
}

export interface ProviderResponseCheckpointInput {
  providerOperationId: string;
  providerRequestId: string | null;
  response: Record<string, unknown>;
  responseUrl: string;
  observedAt: string;
  responseUrlExpiresAt: string;
}

export interface CreditAllocation {
  mainCreditsUsed: number;
  addonCreditsUsed: number;
}

export interface AuthToken {
  id: string;
  email: string;
  role: 'user' | 'admin';
  authVersion: number;
}

export interface ProviderSuccess extends ProviderUsageMetrics {
  ok: true;
  provider?: string;
  providerTaskId: string;
  objectKey: string;
  thumbnailKey: string | null;
  publicUrl: string | null;
  thumbnailUrl: string | null;
  sizeBytes: number;
  width: number;
  height: number;
  durationSeconds: number | null;
  /** 视频时长的证据来源；成本报表只接受媒体探测值，不能把计划时长当实际输出时长。 */
  durationSource?: 'media-probe' | 'planned-fallback' | null;
  rawUnits: number | null;
  deductedUnits: number | null;
  usageUnit: ProviderUsageUnit;
}

export interface ProviderFailure extends ProviderUsageMetrics {
  ok: false;
  provider?: string;
  providerTaskId?: string;
  category: JobFailureCategory;
  reason: string;
  rawUnits?: number | null;
  deductedUnits?: number | null;
  usageUnit?: ProviderUsageUnit;
  terminal?: boolean;
  /** 供应商原始规范化状态，用于区分 canceled 与普通 failed。 */
  providerStatus?: string;
  /** 未明确给出时必须按 unknown 处理，禁止据此自动退款或扣款。 */
  billingDisposition?: 'unbilled' | 'billable' | 'unknown';
  /**
   * 创建请求的确定性结论。只有 not-created 且明确未计费时，worker 才能在没有
   * providerTaskId 的情况下自动失败并退回积分；缺失值必须按 unknown 处理。
   */
  submissionDisposition?: 'not-created' | 'unknown' | 'created';
  /** 供应商创建接口返回的 HTTP 状态，仅作为诊断证据。 */
  providerHttpStatus?: number;
  /** 供应商错误码，仅作为诊断证据。 */
  providerErrorCode?: string;
  /** 供应商请求 ID，仅作为诊断证据。 */
  providerRequestId?: string;
}

export type ProviderResult = ProviderSuccess | ProviderFailure;
