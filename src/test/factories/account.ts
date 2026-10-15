import type { AccountProfile } from '../../app/data/account';
import type { AdminUser } from '../../app/data/admin';
import type { RegisterPayload } from '../../app/state/auth';
import { normalizeEmail,normalizeRegisterUserName } from '../../app/state/auth';

export function createRegisteredAccountUser({ userName, email, now = new Date() }: RegisterPayload & { now?: Date }) {
  const normalizedUserName = normalizeRegisterUserName(userName);
  const normalizedEmail = normalizeEmail(email);
  const registeredAt = formatDate(now, true);

  const account: AccountProfile = {
    userName: normalizedUserName,
    email: normalizedEmail,
    role: 'user',
    planCode: 'free',
    planName: '免费版',
    portraitEntitlements: { enabled: true, profileLimit: 1, activeLimit: 1, assetsPerActor: 1 },
    hasActiveSubscription: false,
    billingCycle: 'monthly',
    mainCredits: 0,
    addonCredits: 0,
    availableCredits: 0,
    totalCredits: 0,
    resetDate: '-',
    expiresAt: '-',
  };

  const user: AdminUser = {
    id: 'usr-test',
    userName: normalizedUserName,
    email: normalizedEmail,
    planId: null,
    planCode: null,
    planName: '免费版',
    billingCycle: 'monthly',
    planCycleStartedAt: formatDate(now),
    mainCredits: 0,
    addonCredits: 0,
    credits: 0,
    totalCredits: 0,
    planResetAt: null,
    planExpiresAt: null,
    activeSubscriptionOrderId: null,
    status: 'active',
    registeredAt,
    lastActiveAt: registeredAt,
    orderCount: 0,
    apiCalls: 0,
    ticketCount: 0,
    acquisition: null,
  };

  return { account, user };
}

function formatDate(date: Date, includeTime = false) {
  const value = date.toISOString().slice(0, includeTime ? 16 : 10).replace('T', ' ');
  return value;
}
