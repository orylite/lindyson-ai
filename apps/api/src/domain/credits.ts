import type { CreditBucket } from './types.js';

export function bucketForUsage(mainCreditsUsed: number, addonCreditsUsed: number): CreditBucket {
  if (mainCreditsUsed > 0 && addonCreditsUsed > 0) return 'mixed';
  if (mainCreditsUsed > 0) return 'main';
  if (addonCreditsUsed > 0) return 'addon';
  return 'system';
}
