const USERNAME_PATTERN = /^[\p{Script=Han}A-Za-z0-9 _-]+$/u;
const PASSWORD_LETTER_PATTERN = /[A-Za-z]/;
const PASSWORD_DIGIT_PATTERN = /\d/;
const PASSWORD_SPACE_PATTERN = /\s/;

export interface RegisterPayload {
  referralCode?: string;
  userName: string;
  email: string;
}

export function normalizeRegisterUserName(userName: string) {
  return userName.trim();
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function validateRegisterUserName(userName: string) {
  const normalized = normalizeRegisterUserName(userName);

  if (normalized.length < 2 || normalized.length > 30) return '用户名需为 2-30 个字符';
  if (!USERNAME_PATTERN.test(normalized)) return '用户名需为 2-30 个字符';

  return null;
}

export function validateRegisterPassword(password: string) {
  if (password.length < 8 || password.length > 128) return '密码需为 8-128 位，并包含字母和数字';
  if (PASSWORD_SPACE_PATTERN.test(password)) return '密码需为 8-128 位，并包含字母和数字';
  if (!PASSWORD_LETTER_PATTERN.test(password) || !PASSWORD_DIGIT_PATTERN.test(password)) return '密码需为 8-128 位，并包含字母和数字';

  return null;
}
