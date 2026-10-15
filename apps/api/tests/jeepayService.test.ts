import { describe, expect, it, vi } from 'vitest';
import {
  closePaymentOrder,
  createPaymentOrder,
  createPaymentSign,
  normalizePaymentNotifyPayload,
  normalizePaymentLaunch,
  verifyApiResponse,
  verifyPaymentSign,
} from '../src/payments/jeepayService.js';
import { env } from '../src/config/env.js';

describe('支付协议签名', () => {
  it('与官方 MD5 签名样例一致', () => {
    const params = {
      mchNo: 'M1682391685',
      appId: '6447428682ca7458118af79f',
      mchOrderNo: 'mho1694051705945',
      wayCode: 'ALI_BAR',
      amount: 1,
      currency: 'CNY',
      clientIp: '192.166.1.132',
      subject: '商品标题',
      body: '商品描述',
      notifyUrl: 'https://www.jeequan.com',
      reqTime: '1694051706',
      version: '1.0',
      signType: 'MD5',
      channelExtra: '{"authCode":"284957415846666792"}',
    };
    const apiKey = 'UNpEETkvMpqC9oDLBr9S2X7U92k462h3zhHiy7hj4xbw23PiWhMv6TCAQ2vh8PzynZXZYo9n6puxHkAHG7li6LZi8IpaQrshzydnBll64iKlb4U59ggiyCTaHJeqffiW';
    expect(createPaymentSign(params, apiKey)).toBe('924065BA077FA461A9B06D2E76E9ED3C');
  });

  it('动态解析通知并忽略 sign 字段参与验签', () => {
    const apiKey = 'secret';
    const payload = normalizePaymentNotifyPayload({
      mchOrderNo: ['order-1'],
      amount: 100,
      state: '2',
    });
    const sign = createPaymentSign(payload, apiKey);
    expect(verifyPaymentSign({ ...payload, sign }, apiKey)).toBe(true);
    expect(verifyPaymentSign({ ...payload, amount: '101', sign }, apiKey)).toBe(false);
  });

  it('只接受 code 成功且 data 签名正确的响应', () => {
    const apiKey = 'secret';
    const data = { payOrderId: 'P1', mchOrderNo: 'order-1', orderState: 1 };
    const sign = createPaymentSign(data, apiKey);
    expect(verifyApiResponse({ code: 0, data, sign }, apiKey)).toEqual(data);
    expect(() => verifyApiResponse({ code: 0, data, sign: 'BAD' }, apiKey)).toThrow('支付服务响应校验失败');
  });

  it('桌面 WAP 统一下单不提交 returnUrl 或 channelExtra', async () => {
    const apiKey = 'secret';
    const data = {
      payOrderId: 'P1',
      mchOrderNo: 'order-1',
      orderState: 1,
      payDataType: 'payurl',
      payData: 'https://openapi.alipay.com/gateway.do?order=P1',
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data,
      sign: createPaymentSign(data, apiKey),
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await createPaymentOrder({
        enabled: true,
        apiBase: 'https://pay.example.com',
        mchNo: 'M100',
        appId: 'APP100',
        apiKey,
        hasApiKey: true,
        desktopWayCode: 'ALI_WAP',
        mobileWayCode: 'ALI_WAP',
        updatedAt: null,
      }, {
        merchantOrderNo: 'order-1',
        wayCode: 'ALI_WAP',
        surface: 'pc',
        amount: 100,
        subject: '测试订单',
        body: '测试订单 年付',
        clientIp: '203.0.113.10',
        localOrderId: '11111111-1111-4111-8111-111111111111',
        returnOrigin: 'https://www.lindyson.com',
      });
      const requestBody = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(requestBody.expiredTime).toBe(7200);
      expect(requestBody.wayCode).toBe('ALI_WAP');
      expect(requestBody).not.toHaveProperty('channelExtra');
      expect(requestBody).not.toHaveProperty('returnUrl');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('移动 WAP 统一下单保留站内返回地址', async () => {
    const apiKey = 'secret';
    const data = {
      payOrderId: 'P2',
      mchOrderNo: 'order-2',
      orderState: 1,
      payDataType: 'payurl',
      payData: 'https://openapi.alipay.com/gateway.do?order=P2',
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data,
      sign: createPaymentSign(data, apiKey),
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await createPaymentOrder({
        enabled: true,
        apiBase: 'https://pay.example.com',
        mchNo: 'M100',
        appId: 'APP100',
        apiKey,
        hasApiKey: true,
        desktopWayCode: 'ALI_WAP',
        mobileWayCode: 'ALI_WAP',
        updatedAt: null,
      }, {
        merchantOrderNo: 'order-2',
        wayCode: 'ALI_WAP',
        surface: 'mobile',
        amount: 100,
        subject: '测试订单',
        body: '测试订单 年付',
        clientIp: '203.0.113.10',
        localOrderId: '22222222-2222-4222-8222-222222222222',
        returnOrigin: 'https://www.lindyson.cn',
      });
      const requestBody = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(requestBody.wayCode).toBe('ALI_WAP');
      expect(requestBody).not.toHaveProperty('channelExtra');
      expect(requestBody.returnUrl).toBe(
        'https://www.lindyson.cn/app?payment=return&order=22222222-2222-4222-8222-222222222222',
      );
      expect(requestBody.notifyUrl).toBe(
        `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/payments/notify`,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('拒绝非支付网关或支付宝域名的启动地址', () => {
    const config = {
      enabled: true,
      apiBase: 'https://pay.example.com',
      mchNo: 'M100',
      appId: 'APP100',
      apiKey: 'secret',
      hasApiKey: true,
      desktopWayCode: 'ALI_WAP' as const,
      mobileWayCode: 'ALI_WAP' as const,
      updatedAt: null,
    };
    expect(() => normalizePaymentLaunch({
      payOrderId: 'P1',
      mchOrderNo: 'order-1',
      orderState: 1,
      payDataType: 'payUrl',
      payData: 'https://evil.example/phishing',
    }, config, 'mobile')).toThrow('支付页面地址不受信任');
  });

  it('桌面端将 Jeepay 返回的支付宝 payurl 转为直链二维码', () => {
    const config = {
      enabled: true,
      apiBase: 'https://pay.example.com',
      mchNo: 'M100',
      appId: 'APP100',
      apiKey: 'secret',
      hasApiKey: true,
      desktopWayCode: 'ALI_WAP' as const,
      mobileWayCode: 'ALI_WAP' as const,
      updatedAt: null,
    };
    expect(normalizePaymentLaunch({
      payOrderId: 'P1',
      mchOrderNo: 'order-1',
      orderState: 1,
      payDataType: 'payurl',
      payData: 'https://openapi.alipay.com/gateway.do?order=P1',
    }, config, 'pc')).toEqual({
      type: 'qr',
      codeUrl: 'https://openapi.alipay.com/gateway.do?order=P1',
    });
  });

  it('桌面二维码拒绝 Jeepay 网关首跳，移动端继续允许', () => {
    const config = {
      enabled: true,
      apiBase: 'https://pay.example.com',
      mchNo: 'M100',
      appId: 'APP100',
      apiKey: 'secret',
      hasApiKey: true,
      desktopWayCode: 'ALI_WAP' as const,
      mobileWayCode: 'ALI_WAP' as const,
      updatedAt: null,
    };
    const payment = {
      payOrderId: 'P1',
      mchOrderNo: 'order-1',
      orderState: 1,
      payDataType: 'payurl',
      payData: 'https://pay.example.com/cashier?order=P1',
    };

    expect(() => normalizePaymentLaunch(payment, config, 'pc')).toThrow('支付二维码地址不受信任');
    expect(normalizePaymentLaunch(payment, config, 'mobile')).toEqual({
      type: 'url',
      url: 'https://pay.example.com/cashier?order=P1',
    });
  });

  it('移动端将 payurl 保持为跳转链接', () => {
    const config = {
      enabled: true,
      apiBase: 'https://pay.example.com',
      mchNo: 'M100',
      appId: 'APP100',
      apiKey: 'secret',
      hasApiKey: true,
      desktopWayCode: 'ALI_WAP' as const,
      mobileWayCode: 'ALI_WAP' as const,
      updatedAt: null,
    };
    expect(normalizePaymentLaunch({
      payOrderId: 'P1',
      mchOrderNo: 'order-1',
      orderState: 1,
      payDataType: 'payUrl',
      payData: 'https://openapi.alipay.com/gateway.do?order=P1',
    }, config, 'mobile')).toEqual({
      type: 'url',
      url: 'https://openapi.alipay.com/gateway.do?order=P1',
    });
  });

  it('桌面端拒绝表单和 codeUrl，避免抓取或执行第三方页面', () => {
    const config = {
      enabled: true,
      apiBase: 'https://pay.example.com',
      mchNo: 'M100',
      appId: 'APP100',
      apiKey: 'secret',
      hasApiKey: true,
      desktopWayCode: 'ALI_WAP' as const,
      mobileWayCode: 'ALI_WAP' as const,
      updatedAt: null,
    };
    expect(() => normalizePaymentLaunch({
      payOrderId: 'P1',
      mchOrderNo: 'order-1',
      orderState: 1,
      payDataType: 'form',
      payData: '<form action="https://openapi.alipay.com/gateway.do" method="post"><input name="biz_content" value="signed"></form>',
    }, config, 'pc')).toThrow();
    expect(() => normalizePaymentLaunch({
      payOrderId: 'P1',
      mchOrderNo: 'order-1',
      orderState: 1,
      payDataType: 'codeUrl',
      payData: 'https://qr.alipay.com/bax01234example',
    }, config, 'pc')).toThrow();
  });

  it('移动端继续安全解析 Jeepay 表单', () => {
    const config = {
      enabled: true,
      apiBase: 'https://pay.example.com',
      mchNo: 'M100',
      appId: 'APP100',
      apiKey: 'secret',
      hasApiKey: true,
      desktopWayCode: 'ALI_WAP' as const,
      mobileWayCode: 'ALI_WAP' as const,
      updatedAt: null,
    };
    expect(normalizePaymentLaunch({
      payOrderId: 'P1',
      mchOrderNo: 'order-1',
      orderState: 1,
      payDataType: 'form',
      payData: '<form action="https://openapi.alipay.com/gateway.do" method="post"><input name="biz_content" value="signed"></form>',
    }, config, 'mobile')).toEqual({
      type: 'form',
      action: 'https://openapi.alipay.com/gateway.do',
      method: 'POST',
      fields: [{ name: 'biz_content', value: 'signed' }],
    });
  });

  it('关单优先使用 Jeepay 支付订单号', async () => {
    const apiKey = 'secret';
    const data = {};
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data,
      sign: createPaymentSign(data, apiKey),
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await closePaymentOrder({
        enabled: true,
        apiBase: 'https://pay.example.com',
        mchNo: 'M100',
        appId: 'APP100',
        apiKey,
        hasApiKey: true,
        desktopWayCode: 'ALI_WAP',
        mobileWayCode: 'ALI_WAP',
        updatedAt: null,
      }, 'order-1', 'P1');
      const requestBody = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(requestBody.payOrderId).toBe('P1');
      expect(requestBody).not.toHaveProperty('mchOrderNo');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('关单返回上游交易不存在时视为已不可支付', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 9999,
      msg: '系统：交易不存在',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await closePaymentOrder({
        enabled: true,
        apiBase: 'https://pay.example.com',
        mchNo: 'M100',
        appId: 'APP100',
        apiKey: 'secret',
        hasApiKey: true,
        desktopWayCode: 'ALI_WAP',
        mobileWayCode: 'ALI_WAP',
        updatedAt: null,
      }, 'order-1', 'P1');
      expect(result).toMatchObject({ alreadyAbsent: true, errCode: 'TRADE_NOT_EXIST' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('桌面支付直链遵守 2048 个 UTF-8 字节上限', () => {
    const config = {
      enabled: true,
      apiBase: 'https://pay.example.com',
      mchNo: 'M100',
      appId: 'APP100',
      apiKey: 'secret',
      hasApiKey: true,
      desktopWayCode: 'ALI_WAP' as const,
      mobileWayCode: 'ALI_WAP' as const,
      updatedAt: null,
    };
    const accepted = `https://openapi.alipay.com/gateway.do?token=${'a'.repeat(1_900)}`;
    expect(normalizePaymentLaunch({
      payOrderId: 'P1',
      mchOrderNo: 'order-1',
      orderState: 1,
      payDataType: 'payurl',
      payData: accepted,
    }, config, 'pc')).toEqual({ type: 'qr', codeUrl: accepted });

    expect(() => normalizePaymentLaunch({
      payOrderId: 'P2',
      mchOrderNo: 'order-2',
      orderState: 1,
      payDataType: 'payurl',
      payData: `https://openapi.alipay.com/gateway.do?token=${'中'.repeat(680)}`,
    }, config, 'pc')).toThrow('支付链接长度不正确');

    expect(() => normalizePaymentLaunch({
      payOrderId: 'P3',
      mchOrderNo: 'order-3',
      orderState: 1,
      payDataType: 'payurl',
      payData: `https://openapi.alipay.com/gateway.do?token=${'中'.repeat(600)}`,
    }, config, 'pc')).toThrow('支付链接长度不正确');
  });

  it('移动跳转链接不受桌面二维码容量上限影响', () => {
    const config = {
      enabled: true,
      apiBase: 'https://pay.example.com',
      mchNo: 'M100',
      appId: 'APP100',
      apiKey: 'secret',
      hasApiKey: true,
      desktopWayCode: 'ALI_WAP' as const,
      mobileWayCode: 'ALI_WAP' as const,
      updatedAt: null,
    };
    const payData = `https://openapi.alipay.com/gateway.do?token=${'a'.repeat(3_000)}`;
    expect(normalizePaymentLaunch({
      payOrderId: 'P1',
      mchOrderNo: 'order-1',
      orderState: 1,
      payDataType: 'payurl',
      payData,
    }, config, 'mobile')).toEqual({ type: 'url', url: payData });
  });
});
