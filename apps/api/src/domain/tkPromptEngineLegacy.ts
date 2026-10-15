/** 仅用于持久化旧快照读取；新请求仍按严格契约拒绝已移除字段。 */
export function omitStoredTkPromptField(value: unknown, field: 'publishLanguage' | 'publishPack'): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = { ...value } as Record<string, unknown>;
  delete result[field];
  return result;
}
