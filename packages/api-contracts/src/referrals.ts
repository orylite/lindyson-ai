import { z } from 'zod';
import { createExactCursorPageSchema, isoDateTimeSchema, nullableIsoDateTimeSchema, nonnegativeIntegerSchema, uuidSchema } from './primitives.js';
export const referralCodeSchema = z.string().trim().regex(/^(?:[A-Za-z0-9_-]{8}|[A-Za-z0-9_-]{16,64})$/);
export const referralSettingsSchema = z.object({ enabled: z.boolean(), inviterCredits: z.number().int().min(1).max(1_000_000), inviteeCredits: z.number().int().min(1).max(1_000_000) });
export const referralStatusSchema = z.enum(['waiting', 'rewarded', 'review', 'reversing', 'reversed', 'closed']);
export const referralRecordSchema = z.object({
  id: uuidSchema, inviter: z.string(), invitee: z.string(), createdAt: isoDateTimeSchema,
  orderId: uuidSchema.nullable(), refundedAt: nullableIsoDateTimeSchema, status: referralStatusSchema,
  inviterCredits: nonnegativeIntegerSchema, inviteeCredits: nonnegativeIntegerSchema,
  granted: nonnegativeIntegerSchema, reversed: nonnegativeIntegerSchema, held: nonnegativeIntegerSchema,
  consumed: nonnegativeIntegerSchema, reviewNote: z.string().nullable(),
});
export const referralPageSchema = createExactCursorPageSchema(referralRecordSchema);
export const referralSummarySchema = z.object({ settings: referralSettingsSchema, code: z.string().regex(/^[A-Z0-9]{8}$/),
  invited: nonnegativeIntegerSchema, earned: nonnegativeIntegerSchema });
