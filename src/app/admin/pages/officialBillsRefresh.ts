type OfficialBillsRefresh = () => Promise<void>;

let activeRefresh: OfficialBillsRefresh | null = null;

export function registerOfficialBillsRefresh(refresh: OfficialBillsRefresh) {
  activeRefresh = refresh;
  return () => {
    if (activeRefresh === refresh) activeRefresh = null;
  };
}

export async function refreshOfficialBills() {
  if (!activeRefresh) return;
  await activeRefresh();
}
