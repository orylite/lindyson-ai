import { createHash, timingSafeEqual } from 'node:crypto';
import { parse } from 'node-html-parser';
import { env } from '../config/env.js';
import type { PaymentChannelCredentials, PaymentSurface, PaymentWayCode } from './paymentChannelService.js';

export type PaymentNotifyPayload = Record<string, string>;

export interface PaymentOrderRequest {
  merchantOrderNo: string;
  wayCode: PaymentWayCode;
  amount: number;
  subject: string;
  body: string;
  clientIp?: string;
  localOrderId: string;
  surface: PaymentSurface;
  returnOrigin: string;
}

export interface PaymentOrderData {
  payOrderId: string;
  mchOrderNo: string;
  orderState: number;
  payDataType?: string;
  payData?: string;
  errCode?: string;
  errMsg?: string;
}

export type PaymentLaunch =
  | { type: 'url'; url: string }
  | { type: 'form'; action: string; method: 'GET' | 'POST'; fields: Array<{ name: string; value: string }> }
  | { type: 'qr'; codeUrl: string };

const MAX_DESKTOP_QR_URL_BYTES = 2_048;
const MAX_PAYMENT_URL_BYTES = 16_384;

export interface PaymentQueryData {
  payOrderId: string;
  mchOrderNo: string;
  mchNo: string;
  appId: string;
  wayCode: string;
  amount: number;
  currency: string;
  state: number;
  createdAt?: number;
  expiredTime?: number;
  errCode?: string;
  errMsg?: string;
}

export interface CloseOrderData {
  errCode?: string;
  errMsg?: string;
  alreadyAbsent?: boolean;
}

export interface RefundOrderData {
  refundOrderId: string;
  mchRefundNo: string;
  state: number;
  errCode?: string;
  errMsg?: string;
}

export interface RefundQueryData extends RefundOrderData {
  payOrderId: string;
  mchOrderNo: string;
  payAmount: number;
  refundAmount: number;
  currency: string;
}

interface ApiResponse<T> {
  code: number;
  msg?: string;
  sign?: string;
  data?: T;
}

export async function createPaymentOrder(config: PaymentChannelCredentials, order: PaymentOrderRequest) {
  const payload = signedRequest(config, {
    mchNo: config.mchNo,
    appId: config.appId,
    mchOrderNo: order.merchantOrderNo,
    wayCode: order.wayCode,
    amount: order.amount,
    currency: 'CNY',
    clientIp: order.clientIp,
    subject: order.subject,
    body: order.body,
    notifyUrl: `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/payments/notify`,
    ...(order.surface === 'mobile'
      ? { returnUrl: `${order.returnOrigin.replace(/\/$/, '')}/app?payment=return&order=${encodeURIComponent(order.localOrderId)}` }
      : {}),
    expiredTime: env.PAYMENT_ORDER_EXPIRES_SECONDS,
    divisionMode: 0,
  });
  return execute<PaymentOrderData>(config, 'api/pay/unifiedOrder', payload);
}

export async function queryPaymentOrder(config: PaymentChannelCredentials, merchantOrderNo: string) {
  const payload = signedRequest(config, {
    mchNo: config.mchNo,
    appId: config.appId,
    mchOrderNo: merchantOrderNo,
  });
  return execute<PaymentQueryData>(config, 'api/pay/query', payload);
}

export async function closePaymentOrder(
  config: PaymentChannelCredentials,
  merchantOrderNo: string,
  payOrderId?: string | null,
) {
  const payload = signedRequest(config, {
    mchNo: config.mchNo,
    appId: config.appId,
    ...(payOrderId ? { payOrderId } : { mchOrderNo: merchantOrderNo }),
  });
  try {
    return await execute<CloseOrderData>(config, 'api/pay/close', payload);
  } catch (error) {
    if (isMissingProviderTrade(error)) {
      return { errCode: 'TRADE_NOT_EXIST', errMsg: '上游交易不存在', alreadyAbsent: true };
    }
    throw error;
  }
}

export function normalizePaymentLaunch(
  payment: PaymentOrderData,
  config: PaymentChannelCredentials,
  surface: PaymentSurface,
): PaymentLaunch {
  const payData = payment.payData?.trim();
  if (!payData) throw new Error('支付服务未返回支付数据');
  const payDataType = payment.payDataType?.trim().toLowerCase();

  if (payDataType === 'payurl') {
    const maxUrlBytes = surface === 'pc' ? MAX_DESKTOP_QR_URL_BYTES : MAX_PAYMENT_URL_BYTES;
    if (Buffer.byteLength(payData, 'utf8') > maxUrlBytes) throw new Error('支付链接长度不正确');
    const url = parseHttpsPaymentUrl(
      payData,
      config,
      surface === 'pc' ? '支付二维码' : '支付页面',
      surface !== 'pc',
    );
    const normalizedUrl = url.toString();
    if (Buffer.byteLength(normalizedUrl, 'utf8') > maxUrlBytes) throw new Error('支付链接长度不正确');
    return surface === 'pc'
      ? { type: 'qr', codeUrl: normalizedUrl }
      : { type: 'url', url: normalizedUrl };
  }

  if (payDataType === 'form') {
    if (surface === 'pc') throw new Error('桌面支付未返回可生成二维码的支付链接');
    return parsePaymentForm(payData, config);
  }

  if (payDataType === 'codeurl') throw new Error('支付服务返回了不支持的二维码数据');

  throw new Error('支付服务返回了不支持的支付数据类型');
}

export async function createRefundOrder(config: PaymentChannelCredentials, input: {
  merchantOrderNo: string;
  merchantRefundNo: string;
  amount: number;
  clientIp?: string;
}) {
  const payload = signedRequest(config, {
    mchNo: config.mchNo,
    appId: config.appId,
    mchOrderNo: input.merchantOrderNo,
    mchRefundNo: input.merchantRefundNo,
    refundAmount: input.amount,
    currency: 'CNY',
    clientIp: input.clientIp,
    refundReason: '订单退款',
    notifyUrl: `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/payments/refunds/notify`,
  });
  return execute<RefundOrderData>(config, 'api/refund/refundOrder', payload);
}

export async function queryRefundOrder(config: PaymentChannelCredentials, merchantRefundNo: string) {
  const payload = signedRequest(config, {
    mchNo: config.mchNo,
    appId: config.appId,
    mchRefundNo: merchantRefundNo,
  });
  return execute<RefundQueryData>(config, 'api/refund/query', payload);
}

export function createPaymentSign(params: Record<string, unknown>, apiKey: string) {
  const entries = Object.entries(params)
    .filter(([key, value]) => key !== 'sign' && value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${stringValue(value)}`)
    .sort(caseInsensitiveCompare);
  const content = `${entries.join('&')}${entries.length ? '&' : ''}key=${apiKey}`;
  return createHash('md5').update(content, 'utf8').digest('hex').toUpperCase();
}

export function verifyPaymentSign(params: Record<string, unknown>, apiKey: string) {
  const actual = typeof params.sign === 'string' ? params.sign.toUpperCase() : '';
  const expected = createPaymentSign(params, apiKey);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function normalizePaymentNotifyPayload(body: unknown): PaymentNotifyPayload {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const output: PaymentNotifyPayload = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string') output[key] = value;
    else if (Array.isArray(value) && typeof value[0] === 'string') output[key] = value[0];
    else if (value !== undefined && value !== null) output[key] = String(value);
  }
  return output;
}

export function verifyApiResponse<T>(response: ApiResponse<T>, apiKey: string): T {
  if (response.code !== 0) {
    throw publicError('支付服务拒绝了本次请求', 502, true, {
      providerCode: response.code,
      providerMessage: safeProviderText(response.msg),
    });
  }
  if (!response.data || !response.sign || !verifyPaymentSign({ ...(response.data as object), sign: response.sign }, apiKey)) {
    throw publicError('支付服务响应校验失败', 502, false);
  }
  return response.data;
}

function parsePaymentForm(payData: string, config: PaymentChannelCredentials): PaymentLaunch {
  if (payData.length > 131_072) throw new Error('支付表单长度不正确');
  const root = parse(payData, { lowerCaseTagName: true });
  const forms = root.querySelectorAll('form');
  if (forms.length !== 1) throw new Error('支付表单结构不正确');

  const form = forms[0]!;
  const actionValue = form.getAttribute('action')?.trim();
  if (!actionValue || actionValue.length > 16_384) throw new Error('支付表单地址不正确');
  const action = parseHttpsPaymentUrl(actionValue, config);
  const methodValue = (form.getAttribute('method') ?? 'GET').trim().toUpperCase();
  if (methodValue !== 'GET' && methodValue !== 'POST') throw new Error('支付表单提交方式不正确');

  const inputs = form.querySelectorAll('input[name]');
  if (inputs.length === 0 || inputs.length > 128) throw new Error('支付表单字段不正确');
  const fields = inputs
    .filter(input => input.getAttribute('disabled') === undefined)
    .map(input => {
      const name = input.getAttribute('name')?.trim() ?? '';
      const value = input.getAttribute('value') ?? '';
      if (!name || name.length > 128 || value.length > 32_768) throw new Error('支付表单字段不正确');
      return { name, value };
    });
  if (fields.length === 0) throw new Error('支付表单字段不正确');

  return {
    type: 'form',
    action: action.toString(),
    method: methodValue,
    fields,
  };
}

function isMissingProviderTrade(error: unknown) {
  if (!(error instanceof Error)) return false;
  const providerMessage = (error as { providerMessage?: unknown }).providerMessage;
  return typeof providerMessage === 'string' && providerMessage.includes('交易不存在');
}

export function isDefinitiveMissingRefundOrder(error: unknown) {
  if (!(error instanceof Error) || (error as { definitive?: unknown }).definitive !== true) return false;
  const providerMessage = (error as { providerMessage?: unknown }).providerMessage;
  if (typeof providerMessage !== 'string') return false;
  const normalized = providerMessage.toLowerCase();
  return normalized.includes('退款')
    && (normalized.includes('不存在') || normalized.includes('not exist') || normalized.includes('not found'));
}

function parseHttpsPaymentUrl(
  value: string,
  config: PaymentChannelCredentials,
  label = '支付页面',
  allowGatewayHost = true,
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label}地址不正确`);
  }
  if (url.protocol !== 'https:' || !isAllowedPaymentHost(url.hostname, config, allowGatewayHost)) {
    throw new Error(`${label}地址不受信任`);
  }
  return url;
}

function isAllowedPaymentHost(hostname: string, config: PaymentChannelCredentials, allowGatewayHost: boolean) {
  const host = hostname.toLowerCase();
  const gatewayHost = new URL(config.apiBase).hostname.toLowerCase();
  return (allowGatewayHost && host === gatewayHost)
    || host === 'alipay.com'
    || host.endsWith('.alipay.com')
    || host === 'alipaydev.com'
    || host.endsWith('.alipaydev.com');
}

function signedRequest(config: PaymentChannelCredentials, input: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    ...input,
    reqTime: Date.now(),
    version: '1.0',
    signType: 'MD5',
  };
  return { ...payload, sign: createPaymentSign(payload, config.apiKey) };
}

async function execute<T>(config: PaymentChannelCredentials, path: string, payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.PAYMENT_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.apiBase}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw publicError('支付服务暂时不可用', 502, false);
    const body = await response.json() as ApiResponse<T>;
    return verifyApiResponse(body, config.apiKey);
  } catch (error) {
    if (isPublicError(error)) throw error;
    throw publicError('支付状态暂时无法确认，请稍后重试', 502, false);
  } finally {
    clearTimeout(timeout);
  }
}

function caseInsensitiveCompare(left: string, right: string) {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function stringValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value);
}

function publicError(
  message: string,
  statusCode: number,
  definitive: boolean,
  details: { providerCode?: number; providerMessage?: string } = {},
) {
  return Object.assign(new Error(message), { statusCode, exposeMessage: true, definitive, ...details });
}

function isPublicError(error: unknown): error is Error & { statusCode: number } {
  return error instanceof Error && typeof (error as { statusCode?: unknown }).statusCode === 'number';
}

function safeProviderText(value: string | undefined) {
  return value?.trim().slice(0, 256) || undefined;
}
