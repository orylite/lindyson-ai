import {
  Activity,
  BarChart3,
  Bot,
  Coins,
  CreditCard,
  FileText,
  Fingerprint,
  LifeBuoy,
  Megaphone,
  Package,
  Palette,
  PauseCircle,
  Receipt,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { AdminTab } from '../types';

export interface AdminNavItem {
  id: AdminTab;
  label: string;
  icon: LucideIcon;
}

export const ADMIN_NAV: AdminNavItem[] = [
  { id: 'overview', label: '仪表盘', icon: BarChart3 },
  { id: 'referrals', label: '邀约奖励', icon: Users },
  { id: 'announcements', label: '平台公告', icon: Megaphone },
  { id: 'plans', label: '订阅套餐', icon: Package },
  { id: 'real-portrait-capacity', label: '真人容量', icon: Fingerprint },
  { id: 'consumption-settings', label: '积分消耗', icon: SlidersHorizontal },
  { id: 'feature-flags', label: '功能开关', icon: PauseCircle },
  { id: 'payment-channel', label: '支付通道', icon: CreditCard },
  { id: 'orders', label: '订单管理', icon: Receipt },
  { id: 'users', label: '用户管理', icon: Users },
  { id: 'tickets', label: '工单管理', icon: LifeBuoy },
  { id: 'invoices', label: '发票管理', icon: FileText },
  { id: 'api-usage', label: '成本看盘', icon: Activity },
  { id: 'credits', label: '积分流水', icon: Coins },
  { id: 'jobs', label: '生成任务', icon: Bot },
  { id: 'audit', label: '操作审计', icon: ShieldCheck },
  { id: 'design-system', label: '设计规范', icon: Palette },
];
