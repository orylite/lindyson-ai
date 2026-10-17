import net from 'node:net';

/**
 * Node 默认每个地址族只等 250ms 就换下一个。生产容器没有 IPv6 出口，
 * 香港到北京方舟的 IPv4 握手偶尔超过 250ms 时，IPv6 立即 ENETUNREACH，
 * 整个连接会在约 0.3 秒内以 ETIMEDOUT 失败。放宽单次尝试时间，仍保留双栈回退。
 */
export const AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS = 2_500;

export function configureOutboundNetworkDefaults() {
  net.setDefaultAutoSelectFamilyAttemptTimeout(AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS);
}
