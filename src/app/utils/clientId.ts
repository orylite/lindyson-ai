let fallbackSequence = 0;

/** 仅用于尚未持久化的客户端草稿标识；服务端保存后会替换为正式 ID。 */
export function createClientId(prefix: string, suffix?: string | number) {
  const randomId = globalThis.crypto?.randomUUID?.() ?? createFallbackId();
  return suffix === undefined
    ? `${prefix}-${randomId}`
    : `${prefix}-${suffix}-${randomId}`;
}

function createFallbackId() {
  fallbackSequence += 1;
  return `${Date.now().toString(36)}-${fallbackSequence.toString(36).padStart(4, '0')}`;
}
