export interface ProviderStructuredJsonErrorOptions {
  emptyMessage: string;
  invalidMessage: string;
  emptyCode: string;
  invalidCode: string;
}

/**
 * 只恢复不会改变 JSON 业务语义的 Provider 格式噪声。任何候选最终仍必须
 * 通过 JSON.parse 和调用方的 Schema/领域门禁；截断、多对象和缺字段都不猜测。
 */
export function parseProviderStructuredJson(
  outputText: string | null | undefined,
  options: ProviderStructuredJsonErrorOptions,
) {
  if (!outputText?.trim()) {
    throw Object.assign(new Error(options.emptyMessage), { code: options.emptyCode });
  }
  const normalizedEnvelope = normalizePromptWizardJsonEnvelope(outputText);
  const escapedControls = escapeRawJsonStringControlCharacters(normalizedEnvelope);
  const extractedEnvelope = extractSinglePromptWizardJsonObject(escapedControls);
  const lexicallyRepaired = repairPromptWizardJsonLexicalNoise(extractedEnvelope);
  let initialCause: unknown;
  for (const candidate of [...new Set([
    normalizedEnvelope,
    escapedControls,
    extractedEnvelope,
    lexicallyRepaired,
  ])]) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      initialCause ??= new TypeError('Provider structured JSON root must be an object');
    } catch (cause) {
      initialCause ??= cause;
    }
  }
  throw Object.assign(new Error(options.invalidMessage), {
    code: options.invalidCode,
    cause: initialCause,
  });
}

/** 只移除首尾空白、BOM 和完整包裹正文的单层 JSON 代码围栏。 */
export function normalizePromptWizardJsonEnvelope(outputText: string) {
  const trimmed = outputText.trim();
  const fenced = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/iu.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}

/** 抽取唯一且括号完整的顶层对象；多个对象、数组或截断对象保持原样并拒绝。 */
export function extractSinglePromptWizardJsonObject(value: string) {
  if (value.trimStart().startsWith('[')) return value;
  const start = value.indexOf('{');
  if (start < 0) return value;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{' || character === '[') depth += 1;
    if (character === '}' || character === ']') depth -= 1;
    if (depth !== 0) continue;
    const suffix = value.slice(index + 1);
    if (/[{\[]/u.test(suffix)) return value;
    return value.slice(start, index + 1);
  }
  return value;
}

/** 修复非法反斜杠转义、正文裸双引号和尾逗号，不补字段或括号。 */
export function repairPromptWizardJsonLexicalNoise(value: string) {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (!inString) {
      if (character === ',') {
        const next = value.slice(index + 1).match(/^\s*([}\]])/u);
        if (next) continue;
      }
      result += character;
      if (character === '"') inString = true;
      continue;
    }
    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      const next = value[index + 1] ?? '';
      if (!/["\\/bfnrtu]/u.test(next)) result += '\\\\';
      else {
        result += character;
        escaped = true;
      }
      continue;
    }
    if (character === '"') {
      if (!isPromptWizardJsonStringClosingQuote(value, index)) {
        result += '\\"';
        continue;
      }
      inString = false;
    }
    result += character;
  }
  return result;
}

function isPromptWizardJsonStringClosingQuote(value: string, quoteIndex: number) {
  const suffix = value.slice(quoteIndex + 1);
  const next = suffix.match(/^\s*(.)/su)?.[1] ?? '';
  if (!next || next === '}' || next === ']') return true;
  if (next !== ',' && next !== ':') return false;
  const punctuationOffset = suffix.search(/\S/u);
  const afterPunctuation = suffix.slice(punctuationOffset + 1).match(/^\s*(.)/su)?.[1] ?? '';
  if (!afterPunctuation) return false;
  return /["{\[\]}\-0-9tfn]/u.test(afterPunctuation);
}

/** 将 JSON 字符串值中的裸控制字符改成等价 JSON 转义。 */
export function escapeRawJsonStringControlCharacters(value: string) {
  let result = '';
  let inString = false;
  let escaped = false;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (inString && codePoint <= 0x1f) {
      const encoded = JSON.stringify(character).slice(1, -1);
      result += escaped && encoded.startsWith('\\') ? encoded.slice(1) : encoded;
      escaped = false;
      continue;
    }
    result += character;
    if (!inString) {
      if (character === '"') inString = true;
      continue;
    }
    if (escaped) escaped = false;
    else if (character === '\\') escaped = true;
    else if (character === '"') inString = false;
  }
  return result;
}
