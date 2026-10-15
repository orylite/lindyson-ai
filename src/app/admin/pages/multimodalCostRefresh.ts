let refreshHandler: (() => Promise<void>) | null = null;

export function registerMultimodalCostRefresh(handler: () => Promise<void>) {
  refreshHandler = handler;
  return () => {
    if (refreshHandler === handler) refreshHandler = null;
  };
}

export async function refreshMultimodalCost() {
  if (!refreshHandler) throw new Error('多模态成本看盘尚未就绪，请稍后重试');
  await refreshHandler();
}
