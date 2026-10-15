import type { Adapter, AdapterPayload } from 'oidc-provider';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { hashSecret, seal, unseal } from './security.js';

const UNUSED_CLIENT_TTL_SECONDS = 24 * 60 * 60;

/** 原始令牌不作为数据库键；OAuth payload 加密，授权码消费通过 CAS 防止并发重放。 */
export class PostgresOAuthAdapter implements Adapter {
  constructor(private readonly kind: string) {}
  private key(id: string) {
    return hashSecret(`${this.kind}:${id}`);
  }
  async upsert(id: string, payload: AdapterPayload, expiresIn?: number) {
    const key = this.key(id);
    // 动态注册的 Client 默认只保留 24 小时；一旦有授权（Grant）落地就改为长期保留，避免未使用的注册记录无限堆积。
    if (this.kind === 'Client' && expiresIn === undefined) expiresIn = UNUSED_CLIENT_TTL_SECONDS;
    await pool.query(
      `INSERT INTO mcp_oauth_states (kind,id_hash,payload_encrypted,grant_id,uid_hash,user_code_hash,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $7::integer IS NULL THEN NULL ELSE now() + make_interval(secs => $7) END)
       ON CONFLICT (kind,id_hash) DO UPDATE SET payload_encrypted=EXCLUDED.payload_encrypted,
         grant_id=EXCLUDED.grant_id,uid_hash=EXCLUDED.uid_hash,user_code_hash=EXCLUDED.user_code_hash,expires_at=EXCLUDED.expires_at`,
      [
        this.kind,
        key,
        seal(JSON.stringify(payload), env.MCP_OAUTH_SECRET!, `oauth:${key}`),
        payload.grantId ?? null,
        payload.uid ? hashSecret(payload.uid) : null,
        payload.userCode ? hashSecret(payload.userCode) : null,
        expiresIn ?? null,
      ],
    );
    if (this.kind === 'Grant' && typeof payload.clientId === 'string') {
      await pool.query(
        "UPDATE mcp_oauth_states SET expires_at=NULL WHERE kind='Client' AND id_hash=$1 AND expires_at IS NOT NULL",
        [hashSecret(`Client:${payload.clientId}`)],
      );
    }
  }
  private async read(column: 'id_hash' | 'uid_hash' | 'user_code_hash', value: string) {
    const result = await pool.query<{
      id_hash: string;
      payload_encrypted: string;
      consumed_at: Date | null;
    }>(
      `SELECT id_hash,payload_encrypted,consumed_at FROM mcp_oauth_states
       WHERE kind=$1 AND ${column}=$2 AND (expires_at IS NULL OR expires_at > now()) LIMIT 1`,
      [this.kind, value],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const payload = JSON.parse(
      unseal(row.payload_encrypted, env.MCP_OAUTH_SECRET!, `oauth:${row.id_hash}`),
    ) as AdapterPayload;
    if (row.consumed_at) payload.consumed = Math.floor(new Date(row.consumed_at).getTime() / 1000);
    return payload;
  }
  find(id: string) {
    return this.read('id_hash', this.key(id));
  }
  findByUid(uid: string) {
    return this.read('uid_hash', hashSecret(uid));
  }
  findByUserCode(code: string) {
    return this.read('user_code_hash', hashSecret(code));
  }
  async consume(id: string) {
    const result = await pool.query(
      `UPDATE mcp_oauth_states SET consumed_at=now() WHERE kind=$1 AND id_hash=$2 AND consumed_at IS NULL RETURNING id_hash`,
      [this.kind, this.key(id)],
    );
    if (!result.rowCount) throw new Error('MCP_OAUTH_TOKEN_ALREADY_CONSUMED');
  }
  async destroy(id: string) {
    await pool.query('DELETE FROM mcp_oauth_states WHERE kind=$1 AND id_hash=$2', [
      this.kind,
      this.key(id),
    ]);
  }
  async revokeByGrantId(grantId: string) {
    await pool.query('DELETE FROM mcp_oauth_states WHERE grant_id=$1', [grantId]);
    await pool.query(
      'UPDATE mcp_connections SET revoked_at=COALESCE(revoked_at,now()) WHERE grant_id=$1',
      [grantId],
    );
  }
}
