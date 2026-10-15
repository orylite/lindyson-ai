export interface FeatureFlags {
  tiktokAccounts: boolean;
  tiktokPublish: boolean;
}

export const initialFeatureFlags: FeatureFlags = {
  tiktokAccounts: true,
  tiktokPublish: true,
};
