import { generationCreditSnapshotSchema } from '@lindyson/api-contracts';
import { toIsoDateTime, toInt } from './serialization.js';

export interface CreditLedgerRow {
  id: string;
  user_id: string;
  type: string;
  bucket: string;
  settlement_status: string;
  amount: unknown;
  balance: unknown;
  source: string;
  operator: string;
  note: string;
  related_order_id: string | null;
  related_job_id: string | null;
  related_asset_id: string | null;
  generation_snapshot?: unknown;
  created_at: Date | string;
}

export interface AdminCreditLedgerRow extends CreditLedgerRow {
  user_name: string;
  email: string;
}

/**
 * 用户端流水不带用户身份或后台操作人字段。
 */
export function mapUserCreditLedgerRow(row: CreditLedgerRow) {
  const generationSnapshot = generationCreditSnapshotSchema.safeParse(row.generation_snapshot);
  return {
    id: row.id,
    type: row.type,
    bucket: row.bucket,
    settlementStatus: row.settlement_status,
    amount: toInt(row.amount),
    balance: toInt(row.balance),
    source: row.source,
    note: row.note,
    relatedOrderId: row.related_order_id,
    relatedJobId: row.related_job_id,
    relatedAssetId: row.related_asset_id,
    generationSnapshot: generationSnapshot.success ? generationSnapshot.data : null,
    createdAt: toIsoDateTime(row.created_at),
  };
}

/**
 * 后台流水显式映射允许暴露的 DTO 字段，避免将 SQL 原始行直接返回。
 */
export function mapAdminCreditLedgerRow(row: AdminCreditLedgerRow) {
  return {
    ...mapUserCreditLedgerRow(row),
    userId: row.user_id,
    userName: row.user_name,
    email: row.email,
    operator: row.operator,
  };
}
