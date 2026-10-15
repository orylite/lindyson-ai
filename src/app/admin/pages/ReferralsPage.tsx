import { ReferralRewards } from '../../components/ReferralRewards';
import { PageShell } from '../components/AdminPageShared';

export function AdminReferralsPage() {
  return (
    <PageShell title="邀约奖励" subtitle="配置首付积分奖励，查询邀请记录并处理退款后的奖励核对。">
      <ReferralRewards admin />
    </PageShell>
  );
}
