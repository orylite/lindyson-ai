let refreshHandler: (() => Promise<void>) | null = null;

export function registerImageCostRefresh(handler: () => Promise<void>) {
  refreshHandler = handler;
  return () => {
    if (refreshHandler === handler) refreshHandler = null;
  };
}

export async function refreshImageCost() {
  if (!refreshHandler) throw new Error('图片成本看盘尚未就绪，请稍后重试');
  await refreshHandler();
}
