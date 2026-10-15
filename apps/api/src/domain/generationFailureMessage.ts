import type { GenerationStatus, JobFailureCategory } from './types.js';

const FAILURE_MESSAGE = {
  insufficientCredits: '当前积分不足，请充值后重试。',
  canceled: '任务已取消。',
  timeout: '生成超时，请稍后重试。',
  inputTextPolicy: '提示词未通过内容审核，请修改后重试。',
  inputImagePolicy: '参考图片未通过内容审核，请更换后重试。',
  inputVideoPolicy: '参考视频未通过内容审核，请更换后重试。',
  inputAudioPolicy: '参考音频未通过内容审核，请更换后重试。',
  inputImagePrivacy: '参考图片涉及真人或隐私信息，请更换后重试。',
  inputVideoPrivacy: '参考视频涉及真人或隐私信息，请更换后重试。',
  inputAudioPrivacy: '参考音频涉及真人或隐私信息，请更换后重试。',
  outputPolicy: '生成内容未通过内容审核，请调整提示词或参考素材后重试。',
  copyright: '生成内容可能涉及版权限制，请调整提示词或参考素材后重试。',
  unavailableReference: '参考素材已删除或不可访问，请重新选择后再生成。',
  invalidReferenceFormat: '参考素材格式不符合模型要求，请重新选择后再生成。',
  invalidParameters: '参考素材或生成参数不符合模型要求，请调整后重试。',
  modelUnavailable: '当前模型暂不可用，请稍后重试或选择其他模型。',
  throttled: '当前生成请求较多，请稍后重试。',
  deliveryFailed: '生成结果保存失败，请稍后重新生成。',
  privacyWithheld: '真人授权已撤回或已过期，生成结果未保存或交付，本次预扣积分已退回。',
  genericPolicy: '提示词或参考素材不符合内容规范，请调整后重试。',
  unavailable: '生成服务暂时不可用，请稍后重试。',
} as const;

/**
 * 用户端不能展示供应商原始报错、请求 ID 或内部实现细节；后台仍保留原始失败原因用于排查。
 */
export function getUserVisibleGenerationFailureReason(
  category: JobFailureCategory | string | null | undefined,
  reason: unknown,
  status?: GenerationStatus | string | null,
) {
  if (status === 'canceled') return FAILURE_MESSAGE.canceled;
  if (status && status !== 'failed') return null;

  const rawReason = typeof reason === 'string' ? reason.trim() : '';
  const isTerminalFailure = status === 'failed';
  if (!rawReason && !isTerminalFailure) return null;

  if (isPrivacyWithheld(rawReason)) return FAILURE_MESSAGE.privacyWithheld;
  if (isUnavailableReferenceError(rawReason)) {
    return FAILURE_MESSAGE.unavailableReference;
  }
  if (isInvalidReferenceFormatError(rawReason)) {
    return FAILURE_MESSAGE.invalidReferenceFormat;
  }
  if (isInputImagePrivacyError(rawReason)) return FAILURE_MESSAGE.inputImagePrivacy;
  if (isInputVideoPrivacyError(rawReason)) return FAILURE_MESSAGE.inputVideoPrivacy;
  if (isInputAudioPrivacyError(rawReason)) return FAILURE_MESSAGE.inputAudioPrivacy;
  if (isCopyrightPolicyError(rawReason)) return FAILURE_MESSAGE.copyright;
  if (isInputImagePolicyError(rawReason)) return FAILURE_MESSAGE.inputImagePolicy;
  if (isInputVideoPolicyError(rawReason)) return FAILURE_MESSAGE.inputVideoPolicy;
  if (isInputAudioPolicyError(rawReason)) return FAILURE_MESSAGE.inputAudioPolicy;
  if (isOutputPolicyError(rawReason)) return FAILURE_MESSAGE.outputPolicy;
  if (isInputTextPolicyError(rawReason)) {
    return FAILURE_MESSAGE.inputTextPolicy;
  }
  if (isInvalidParametersError(rawReason)) return FAILURE_MESSAGE.invalidParameters;
  if (isModelUnavailableError(rawReason)) return FAILURE_MESSAGE.modelUnavailable;
  if (isThrottledError(rawReason)) return FAILURE_MESSAGE.throttled;
  if (isDeliveryFailure(rawReason)) return FAILURE_MESSAGE.deliveryFailed;
  if (isTimeoutError(rawReason)) return FAILURE_MESSAGE.timeout;

  if (category === 'insufficient-credits') return FAILURE_MESSAGE.insufficientCredits;
  if (category === 'content-policy') return FAILURE_MESSAGE.genericPolicy;
  if (category === 'system-timeout') return FAILURE_MESSAGE.timeout;
  if (category === 'user-canceled') return FAILURE_MESSAGE.canceled;
  return FAILURE_MESSAGE.unavailable;
}

function isPrivacyWithheld(reason: string) {
  return /privacy-withheld|真人授权.*(?:撤回|过期).*(?:未保存|未交付|不交付|抑制交付)/i.test(reason);
}

function isUnavailableReferenceError(reason: string) {
  return /参考(?:素材|图片|视频|音频).*(?:已删除|不可访问|不存在|不属于当前用户)|reference[_ -]?(asset|image|video|audio).*(unavailable|missing|deleted)|REFERENCE_ASSET_UNAVAILABLE/i.test(reason);
}

function isInvalidReferenceFormatError(reason: string) {
  return /role\s+must\s+be\s+specified|parameter.*content.*(not valid|invalid)|image contents/i.test(reason);
}

function isInputTextPolicyError(reason: string) {
  return /InputTextSensitiveContentDetected|input\s+text.*(?:sensitive\s+(?:content|information)|content\s+policy|privacy\s+information)/i.test(reason);
}

function isInputImagePrivacyError(reason: string) {
  return /InputImageSensitiveContentDetected\.PrivacyInformation|input\s+image.*(?:real\s+person|privacy\s+information)/i.test(reason);
}

function isInputVideoPrivacyError(reason: string) {
  return /InputVideoSensitiveContentDetected\.PrivacyInformation|input\s+video.*(?:real\s+person|privacy\s+information)/i.test(reason);
}

function isInputAudioPrivacyError(reason: string) {
  return /InputAudioSensitiveContentDetected\.PrivacyInformation|input\s+audio.*(?:real\s+person|privacy\s+information)/i.test(reason);
}

function isInputImagePolicyError(reason: string) {
  return /InputImageSensitiveContentDetected|input\s+image.*sensitive\s+(?:content|information)/i.test(reason);
}

function isInputVideoPolicyError(reason: string) {
  return /InputVideoSensitiveContentDetected|input\s+video.*sensitive\s+(?:content|information)/i.test(reason);
}

function isInputAudioPolicyError(reason: string) {
  return /InputAudioSensitiveContentDetected|input\s+audio.*sensitive\s+(?:content|information)/i.test(reason);
}

function isOutputPolicyError(reason: string) {
  return /Output(?:Image|Video)SensitiveContentDetected|output\s+(?:image|video).*sensitive\s+(?:content|information)/i.test(reason);
}

function isCopyrightPolicyError(reason: string) {
  return /copyright(?:ed)?(?:\s+content)?\s+(?:restriction|restrictions|infringement)|related\s+to\s+copyright|版权|著作权/i.test(reason);
}

function isInvalidParametersError(reason: string) {
  return /(?:code=)?(?:InvalidParameter|InvalidRequest|BadRequest)\b|invalid\s+(?:argument|parameter|request)|unsupported\s+(?:argument|parameter|configuration)|参数(?:无效|错误|不符合)|不支持当前配置|omni_reference_task_type|ratio\s+must\s+be\s+adaptive|duration\s+must\s+be\s+-1|(?:reference|参考)(?:\s+|_)?(?:image|video|audio|图片|视频|音频).*(?:count|duration|数量|时长).*(?:exceed|limit|超出|上限)/i.test(reason);
}

function isModelUnavailableError(reason: string) {
  return /ModelNotOpen|model.*(?:not\s+(?:open|available|found|supported)|unavailable)|API\s*Key.*(?:not\s+configured|missing)|API\s*Key\s*未配置|当前模型.*(?:未接入|未开通|不可用|不支持)|permission\s+denied|unauthorized|forbidden|HTTP\s+(?:401|403)\b/i.test(reason);
}

function isThrottledError(reason: string) {
  return /QuotaExceeded|TooManyRequests|rate[\s_-]*limit|too\s+many\s+requests|HTTP\s+429\b|限流|并发.*超|队列.*超|配额.*超/i.test(reason);
}

function isDeliveryFailure(reason: string) {
  return /归档.*失败|下载.*成片.*失败|成片.*响应体为空|Unable\s+to\s+calculate\s+hash|临时图片地址已失效|temporary.*(?:url|address).*(?:expired|unavailable)|delivery-failed|生成结果.*保存失败|(?:视频|图片|成片).*(?:解码|存储).*失败|(?:decode|archive|persist|storage).*(?:failed|failure)|任务完成但未返回.*(?:视频|图片|地址)/i.test(reason);
}

function isTimeoutError(reason: string) {
  return /超时|过期|timeout|timed\s+out|expired/i.test(reason);
}
