import bcrypt from 'bcryptjs';
import { z } from 'zod';

const PASSWORD_ROUNDS = 12;

export const passwordSchema = z.string()
  .min(8)
  .max(128)
  .regex(/[A-Za-z]/)
  .regex(/[0-9]/)
  .refine(value => !/\s/.test(value));

export function hashPassword(password: string) {
  return bcrypt.hash(password, PASSWORD_ROUNDS);
}

export function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}
