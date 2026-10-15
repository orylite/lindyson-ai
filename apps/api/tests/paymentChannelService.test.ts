import { describe, expect, it, vi } from 'vitest';
import {
  decryptPaymentSecret,
  encryptPaymentSecret,
  getPaymentChannelAdminView,
  getUnchangedPaymentChannelView,
  normalizePaymentApiBase,
  savePaymentChannel,
} from '../src/payments/paymentChannelService.js';

describe('支付通道密钥存储', () => {
  const masterKey = Buffer.alloc(32, 7).toString('base64');

  it('使用 AES-GCM 加密且可正确解密', () => {
    const encrypted = encryptPaymentSecret('payment-api-key', masterKey);
    expect(encrypted.ciphertext).not.toContain('payment-api-key');
    expect(decryptPaymentSecret(encrypted, masterKey)).toBe('payment-api-key');
  });

  it('拒绝长度不正确的主密钥', () => {
    expect(() => encryptPaymentSecret('secret', Buffer.alloc(16).toString('base64'))).toThrow('支付通道加密主密钥格式不正确');
  });

  it('空配置的桌面和移动支付均默认使用 ALI_WAP', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    };
    await expect(getPaymentChannelAdminView(client as never)).resolves.toMatchObject({
      desktopWayCode: 'ALI_WAP',
      mobileWayCode: 'ALI_WAP',
    });
  });

  it('生产环境拒绝 HTTP 支付服务地址，开发环境保留本地调试兼容', () => {
    expect(() => normalizePaymentApiBase('http://pay.example.com/', 'production'))
      .toThrow('生产环境支付 API 基础地址必须使用 HTTPS');
    expect(normalizePaymentApiBase('https://pay.example.com/', 'production'))
      .toBe('https://pay.example.com');
    expect(normalizePaymentApiBase('http://localhost:8080/', 'development'))
      .toBe('http://localhost:8080');
  });

  it('由调用方传入事务客户端保存配置并保留既有密钥', async () => {
    const existing = paymentChannelRow();
    const updated = paymentChannelRow({
      api_base: 'https://new-pay.example.com',
      mch_no: 'M200',
      app_id: 'APP200',
    });
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [existing], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updated], rowCount: 1 }),
    };

    await expect(savePaymentChannel(client as never, 'admin-1', {
      enabled: true,
      apiBase: 'https://new-pay.example.com/',
      mchNo: 'M200',
      appId: 'APP200',
      desktopWayCode: 'ALI_WAP',
      mobileWayCode: 'ALI_WAP',
    })).resolves.toMatchObject({
      enabled: true,
      apiBase: 'https://new-pay.example.com',
      hasApiKey: true,
    });
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('pg_advisory_xact_lock'),
      ['payment-channel:jeepay'],
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FOR UPDATE'),
      ['jeepay'],
    );
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('COALESCE(EXCLUDED.api_key_ciphertext'),
      expect.arrayContaining(['jeepay', 'https://new-pay.example.com', 'admin-1']),
    );
  });

  it('只有包括明文密钥在内的实际配置完全一致时才判定为无变化', async () => {
    const encrypted = encryptPaymentSecret('payment-api-key', masterKey);
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [paymentChannelRow({
          api_key_ciphertext: encrypted.ciphertext,
          api_key_iv: encrypted.iv,
          api_key_tag: encrypted.tag,
        })],
        rowCount: 1,
      }),
    };
    const input = {
      enabled: true,
      apiBase: 'https://pay.example.com/',
      mchNo: 'M100',
      appId: 'APP100',
      apiKey: 'payment-api-key',
      desktopWayCode: 'ALI_WAP' as const,
      mobileWayCode: 'ALI_WAP' as const,
    };

    await expect(getUnchangedPaymentChannelView(client as never, input, masterKey))
      .resolves.toMatchObject({ apiBase: 'https://pay.example.com', hasApiKey: true });
    await expect(getUnchangedPaymentChannelView(client as never, {
      ...input,
      apiKey: 'different-api-key',
    }, masterKey)).resolves.toBeNull();
  });
});

function paymentChannelRow(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'jeepay',
    enabled: true,
    api_base: 'https://pay.example.com',
    mch_no: 'M100',
    app_id: 'APP100',
    api_key_ciphertext: 'ciphertext',
    api_key_iv: 'iv',
    api_key_tag: 'tag',
    desktop_way_code: 'ALI_WAP',
    mobile_way_code: 'ALI_WAP',
    updated_at: '2026-07-11T10:00:00.000Z',
    ...overrides,
  };
}
