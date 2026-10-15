import type { PortraitEntitlements } from './realPortraits';

export interface AccountProfile {
  userName: string;
  email: string;
  role: 'user' | 'admin';
  planCode: string;
  planName: string;
  portraitEntitlements: PortraitEntitlements;
  hasActiveSubscription: boolean;
  billingCycle: 'monthly' | 'yearly';
  mainCredits: number;
  addonCredits: number;
  availableCredits: number;
  totalCredits: number;
  resetDate: string;
  expiresAt: string;
}
