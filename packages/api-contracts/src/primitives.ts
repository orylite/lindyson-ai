import { z } from 'zod';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** 第一方上传会话允许的单文件绝对上限（1 GiB）。 */
export const MAX_UPLOAD_SIZE_BYTES = 1024 * 1024 * 1024;

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(jsonValueSchema),
  z.record(jsonValueSchema),
]));

export const jsonObjectSchema = z.record(jsonValueSchema);
export const uuidSchema = z.string().uuid();
export const nonemptyStringSchema = z.string().trim().min(1);
export const emailSchema = z.string().trim().email().transform(value => value.toLowerCase());
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const nullableIsoDateSchema = isoDateSchema.nullable();
export const nullableIsoDateTimeSchema = isoDateTimeSchema.nullable();
export const unavailableDateTimeSchema = z.union([isoDateTimeSchema, z.literal('-')]);
export const finiteNumberSchema = z.number().finite();
export const integerSchema = z.number().int().finite();
export const nonnegativeIntegerSchema = integerSchema.nonnegative();
export const positiveIntegerSchema = integerSchema.positive();
export const percentageIntegerSchema = nonnegativeIntegerSchema.max(100);
export const idempotencyKeySchema = z.string().trim().min(8).max(128);
export const cursorSchema = z.string().trim().min(1).max(1024);

export function createSafeUrlSchema(options: {
  protocols: readonly string[];
  maxLength?: number;
  allowAboutBlank?: boolean;
}) {
  return z.string().min(1).max(options.maxLength ?? 16_384).superRefine((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'URL 格式无效' });
      return;
    }
    if (!options.protocols.includes(url.protocol) || url.username || url.password) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'URL 协议或凭据不受允许' });
      return;
    }
    if (url.protocol === 'about:' && (!options.allowAboutBlank || url.pathname !== 'blank')) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: '仅允许 about:blank' });
    }
  });
}

export const httpUrlSchema = createSafeUrlSchema({ protocols: ['http:', 'https:'] });
export const httpsUrlSchema = createSafeUrlSchema({ protocols: ['https:'] });
export const paymentUrlSchema = createSafeUrlSchema({
  protocols: ['https:', 'about:'],
  allowAboutBlank: true,
});

export const uuidParamsSchema = z.object({ id: uuidSchema }).strict();
export const emptyObjectSchema = z.object({}).strict();
export const okResponseSchema = z.object({ ok: z.literal(true) });

export const pagePositionSchema = z.enum(['first', 'previous', 'next', 'last']);

export const fourWayCursorPaginationSchema = z.object({
  limit: positiveIntegerSchema,
  hasPrevious: z.boolean(),
  hasNext: z.boolean(),
  previousCursor: cursorSchema.nullable(),
  nextCursor: cursorSchema.nullable(),
});

export const exactCursorPaginationSchema = fourWayCursorPaginationSchema.extend({
  currentPage: nonnegativeIntegerSchema,
  totalPages: nonnegativeIntegerSchema,
  totalItems: nonnegativeIntegerSchema,
  snapshotCursor: cursorSchema,
});

export function createFourWayCursorPageSchema<Item extends z.ZodTypeAny>(itemSchema: Item) {
  return z.object({
    items: z.array(itemSchema),
    pagination: fourWayCursorPaginationSchema,
  });
}

export function createExactCursorPageSchema<Item extends z.ZodTypeAny>(itemSchema: Item) {
  return z.object({
    items: z.array(itemSchema),
    pagination: exactCursorPaginationSchema,
  });
}

export const apiErrorSchema = z.object({
  message: nonemptyStringSchema,
  code: z.string().trim().min(1).max(64),
  requestId: z.string().trim().min(1).max(200),
});

export const validationIssueSchema = z.object({
  code: nonemptyStringSchema,
  path: z.array(z.union([z.string(), z.number().int()])),
  message: nonemptyStringSchema,
}).passthrough();

export const validationErrorSchema = apiErrorSchema.extend({
  code: z.literal('VALIDATION_ERROR'),
  issues: z.array(validationIssueSchema),
});

/** Fastify 的统一 JSON 错误响应；校验错误优先保留 issues，其余错误只输出公共字段。 */
export const apiErrorResponseSchema = z.union([validationErrorSchema, apiErrorSchema]);

export type ApiErrorDto = z.infer<typeof apiErrorSchema>;
export type ValidationErrorDto = z.infer<typeof validationErrorSchema>;
export type ApiErrorResponseDto = z.infer<typeof apiErrorResponseSchema>;
