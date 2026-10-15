import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import * as mutations from '../api/mutations';
import { privateQueryKey } from '../api/queryClient';
import * as queries from '../api/queries';
import { uploadRealPortraitFile } from '../api/realPortraitUpload';
import type { PortraitAssetKind, RealPortraitActorList } from '../data/realPortraits';
import type { AppTab } from './routing';

interface UseRealPortraitsOptions {
  activeTab: AppTab;
  accountEmail: string;
  sessionEpoch: number;
}

const PORTRAIT_NOTICE_VERSION = 'real-portrait-portrait-notice-v2';
const SENSITIVE_NOTICE_VERSION = 'real-portrait-sensitive-face-notice-v2';
export const REAL_PORTRAIT_COMMERCIAL_PURPOSE =
  '经本人授权，将含本人肖像的 AI 视频用于合法的商品宣传、品牌营销、广告投放和商业展示，可发布至品牌官网、电商平台、TikTok、抖音、小红书、微信视频号、数字广告平台及线下展示渠道，并可为适配渠道进行必要的剪辑、裁切、字幕、配音、画幅和版式调整；不得出售、转授权真人肖像，不得用于模型训练、身份冒用、虚假代言或其他违法违规用途';

export function useRealPortraits({ activeTab, accountEmail, sessionEpoch }: UseRealPortraitsOptions) {
  const queryClient = useQueryClient();
  const queryKey = privateQueryKey(sessionEpoch, 'real-portraits', 'actors');
  const enabled = Boolean(accountEmail) && (activeTab === 'real-portraits' || activeTab === 'ai-studio');
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => queries.getRealPortraitActors(signal),
    enabled,
    staleTime: 15_000,
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  const createActor = useCallback(async (alias: string) => {
    const actor = await mutations.createRealPortraitActor(alias);
    queryClient.setQueryData<RealPortraitActorList>(queryKey, current => current
      ? {
          ...current,
          items: [actor, ...current.items],
          capacity: {
            ...current.capacity,
            usage: { ...current.capacity.usage, profiles: current.capacity.usage.profiles + 1 },
          },
        }
      : current);
    void refresh();
    return actor;
  }, [queryClient, queryKey, refresh]);

  const activateActor = useCallback(async (actorId: string) => {
    const result = await mutations.requestRealPortraitActivation(actorId, {
      purpose: REAL_PORTRAIT_COMMERCIAL_PURPOSE,
      commercialUse: true,
      portraitNoticeVersion: PORTRAIT_NOTICE_VERSION,
      sensitiveInfoNoticeVersion: SENSITIVE_NOTICE_VERSION,
    });
    replaceActor(queryClient, queryKey, result.actor);
    void refresh();
    return result;
  }, [queryClient, queryKey, refresh]);

  const revokeActor = useCallback(async (actorId: string) => {
    const actor = await mutations.revokeOwnedRealPortraitActor(actorId);
    replaceActor(queryClient, queryKey, actor);
    void refresh();
    return actor;
  }, [queryClient, queryKey, refresh]);

  const deleteActor = useCallback(async (actorId: string) => {
    await mutations.deleteRealPortraitActor(actorId);
    queryClient.setQueryData<RealPortraitActorList>(queryKey, current => current
      ? {
          ...current,
          items: current.items.filter(actor => actor.id !== actorId),
          capacity: {
            ...current.capacity,
            usage: {
              ...current.capacity.usage,
              profiles: Math.max(0, current.capacity.usage.profiles - 1),
            },
          },
        }
      : current);
    void refresh();
  }, [queryClient, queryKey, refresh]);

  const saveQuotaSelection = useCallback(async (retainedActorIds: string[], activeActorIds: string[]) => {
    const capacity = await mutations.selectRealPortraitQuotaActors(retainedActorIds, activeActorIds);
    queryClient.setQueryData<RealPortraitActorList>(queryKey, current => current ? { ...current, capacity } : current);
    void refresh();
  }, [queryClient, queryKey, refresh]);

  const uploadActorImage = useCallback(async (
    actorId: string,
    kind: PortraitAssetKind,
    file: File,
    onProgress?: (progress: number) => void,
  ) => {
    const asset = await uploadRealPortraitFile({ actorId, kind, file, onProgress });
    void refresh();
    return asset;
  }, [refresh]);

  const deleteActorImage = useCallback(async (actorId: string, portraitAssetId: string) => {
    await mutations.deleteRealPortraitAsset(actorId, portraitAssetId);
    void refresh();
  }, [refresh]);

  const clearRealPortraitState = useCallback(() => {
    queryClient.removeQueries({ queryKey });
  }, [queryClient, queryKey]);

  return {
    realPortraits: query.data ?? null,
    realPortraitsLoading: query.isFetching,
    realPortraitsError: query.error,
    refreshRealPortraits: refresh,
    createRealPortraitActor: createActor,
    activateRealPortraitActor: activateActor,
    revokeRealPortraitActor: revokeActor,
    deleteRealPortraitActor: deleteActor,
    saveRealPortraitQuotaSelection: saveQuotaSelection,
    uploadRealPortraitActorImage: uploadActorImage,
    deleteRealPortraitActorImage: deleteActorImage,
    clearRealPortraitState,
  };
}

function replaceActor(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: readonly unknown[],
  actor: RealPortraitActorList['items'][number],
) {
  queryClient.setQueryData<RealPortraitActorList>(queryKey, current => current
    ? { ...current, items: current.items.map(item => item.id === actor.id ? actor : item) }
    : current);
}
