import type { ReactNode } from 'react';
import type {
  AdminAuditLog,
  AdminApiCostAttempt,
  AdminApiCostAttemptFilters,
  AdminApiCostDashboard,
  AdminApiCostFilters,
  AdminApiCostLoadState,
  AdminApiCostOverviewSnapshot,
  AdminApiCostPageKind,
  AdminApiCostPaginationState,
  AdminApiCostTask,
  AdminApiCostUser,
  AdminCreditLedgerEntry,
  AdminGenerationJob,
  AdminInvoiceRequest,
  AdminOrder,
  AdminOverviewSummary,
  AdminPaymentChannel,
  AdminPlan,
  AdminTicket,
  AdminUser,
  AdminUserSubscriptionUpdate,
  PlatformAnnouncement,
  TicketMessage
} from '../data/admin';
import type { ADMIN_TABS } from '../state/routing';
import type { Asset } from '../data/assets';
import type { ConsumptionSettings } from '../data/consumption';
import type { FeatureFlags } from '../data/featureFlags';
import type { ExactCursorPagination,PagePosition } from '../api/cursor';
import type { AdminRealPortraitCapacity } from '../api/queries';

export type AdminTab = (typeof ADMIN_TABS)[number];

export type OrderTimeRange = 'today' | 'seven-days' | 'month' | 'all';

export interface AdminListControl<Filters extends Record<string, unknown>> {
  filters: Filters;
  setFilters: (filters: Filters) => void;
  pagination?: ExactCursorPagination;
  loading: boolean;
  error: Error | null;
  navigate: (position: PagePosition) => void;
}

export interface AdminListControls {
  announcements: AdminListControl<{ search?: string }>;
  users: AdminListControl<{ search?: string; status?: AdminUser['status'] }>;
  orders: AdminListControl<{ search?: string; status?: AdminOrder['status']; userId?: string; from?: string; to?: string }>;
  invoices: AdminListControl<{ search?: string; status?: AdminInvoiceRequest['status']; userId?: string; orderId?: string }>;
  tickets: AdminListControl<{ search?: string; status?: AdminTicket['status']; priority?: AdminTicket['priority'] }>;
  jobs: AdminListControl<{ search?: string; status?: AdminGenerationJob['status']; userId?: string }>;
  credits: AdminListControl<{ search?: string; type?: AdminCreditLedgerEntry['type']; userId?: string; relatedOrderId?: string; relatedJobId?: string }>;
  audit: AdminListControl<{ search?: string; risk?: AdminAuditLog['risk']; module?: string }>;
}

export interface AdminTkPromptEngineSettingsUpdate {
  generationCredits?: number;
  available?: boolean;
}

export interface AdminLayoutProps {
  routePath: string;
  onNavigate: (path: string) => void;
  onExit: () => void;
  plans: AdminPlan[];
  announcements: PlatformAnnouncement[];
  orders: AdminOrder[];
  users: AdminUser[];
  tickets: AdminTicket[];
  invoiceRequests: AdminInvoiceRequest[];
  overview: AdminOverviewSummary | null;
  generationJobs: AdminGenerationJob[];
  creditLedger: AdminCreditLedgerEntry[];
  listControls: AdminListControls;
  navigationSummary: {
    openTickets: number;
    pendingInvoices: number;
    activeJobs: number;
    manualReviewPayments: number;
    manualReviewRefunds: number;
    asOf: string;
  } | null;
  realPortraitCapacity: AdminRealPortraitCapacity | null;
  realPortraitCapacityLoading: boolean;
  realPortraitCapacityError: Error | null;
  orderSummary: {
    totalCount: number;
    totalAmount: number;
    paidCount: number;
    paidAmount: number;
    pendingCount: number;
    refundedCount: number;
    refundedAmount: number;
    failedCount: number;
    failedAmount: number;
  } | null;
  auditLogs: AdminAuditLog[];
  consumptionSettings: ConsumptionSettings;
  featureFlags: FeatureFlags;
  paymentChannel: AdminPaymentChannel;
  apiCostDashboard: AdminApiCostDashboard;
  apiCostOverview: AdminApiCostOverviewSnapshot | null;
  apiCostUsers: AdminApiCostUser[];
  apiCostTasks: AdminApiCostTask[];
  apiCostAttempts: AdminApiCostAttempt[];
  apiCostPagination: AdminApiCostPaginationState;
  apiCostLoadState: AdminApiCostLoadState;
  onApiCostOverviewLoad: (filters?: AdminApiCostFilters, taskFilters?: AdminApiCostFilters) => Promise<void>;
  onApiCostTasksLoad: (filters?: AdminApiCostFilters) => Promise<void>;
  onApiCostOverviewRefresh: (filters?: AdminApiCostFilters) => Promise<void>;
  onApiCostOperatingCancel: () => void;
  onApiCostAuditLoad: (filters?: AdminApiCostAttemptFilters) => Promise<void>;
  onApiCostAuditCancel: () => void;
  onApiCostPageNavigate: (kind: AdminApiCostPageKind, position: PagePosition) => Promise<void>;
  onApiCostSync: (filters?: AdminApiCostFilters) => Promise<void>;
  onRefreshCurrentPage: () => Promise<void>;
  onOrderDetailLoad: (id: string) => Promise<{ order: AdminOrder; invoice: AdminInvoiceRequest | null; creditLedger: AdminCreditLedgerEntry[] }>;
  onJobDetailLoad: (id: string) => Promise<AdminGenerationJob>;
  onOrderRefund: (order: AdminOrder) => Promise<void>;
  onOrderRefundSync: (order: AdminOrder) => Promise<void>;
  onAdminAssetLoad: (assetId: string) => Promise<Asset>;
  onGenerationRetry: (job: AdminGenerationJob) => Promise<void>;
  onGenerationRefund: (job: AdminGenerationJob) => Promise<void>;
  onPlanSave: (plan: AdminPlan) => Promise<void>;
  onAnnouncementCreate: (payload: { title: string; content: string; pinned: boolean }) => Promise<void>;
  onAnnouncementUpdate: (id: string, payload: Partial<{ title: string; content: string; pinned: boolean }>) => Promise<void>;
  onAnnouncementDelete: (id: string) => Promise<void>;
  onFeatureFlagsChange: (flags: FeatureFlags) => Promise<void>;
  onPaymentChannelSave: (payload: Omit<AdminPaymentChannel, 'hasApiKey' | 'updatedAt'> & { apiKey?: string }) => Promise<AdminPaymentChannel>;
  onUserStatusChange: (user: AdminUser, status: AdminUser['status']) => Promise<void>;
  onUserSubscriptionChange: (user: AdminUser, payload: AdminUserSubscriptionUpdate) => Promise<AdminUser>;
  onUserCreditsAdjust: (user: AdminUser, mainDelta: number, addonDelta: number, note: string) => Promise<AdminUser>;
  onInvoiceStatusChange: (request: AdminInvoiceRequest, status: AdminInvoiceRequest['status']) => Promise<void>;
  onTicketStatusChange: (ticket: AdminTicket, status: AdminTicket['status']) => Promise<void>;
  onTicketMessagesLoad: (ticketId: string) => Promise<TicketMessage[]>;
  onTicketRead: (ticketId: string) => Promise<void>;
  onTicketReply: (ticketId: string, message: string) => Promise<TicketMessage>;
  onConsumptionCreditsChange: (id: string, payload: { credits?: number; referenceVideoCredits?: number; available?: boolean }) => Promise<void>;
  onSeedance25AvailabilityChange: (available: boolean) => Promise<void>;
  onTkPromptEngineSettingsChange: (payload: AdminTkPromptEngineSettingsUpdate) => Promise<void>;
}

export interface DetailState {
  title: string;
  subtitle?: string;
  content: ReactNode;
  wide?: boolean;
  extraWide?: boolean;
  bodyMode?: 'default' | 'fixed-content';
}

export interface ConfirmState {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}
