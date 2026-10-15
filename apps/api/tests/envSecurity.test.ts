import { describe, expect, it } from 'vitest';
import {
  assertPromptWizardRetryConfiguration,
  assertRealPortraitProviderConfiguration,
  assertPrivateProductionStorage,
  assertSecureProductionCorsOrigin,
  assertSecureProductionInfrastructureUrls,
  assertSecureProductionJwtSecret,
  assertSecureProductionPublicUrls,
  assertStorageDriverConfiguration,
} from '../src/config/env.js';

describe('生产环境配置校验', () => {
  it('真人素材供应商在 fake 与 volcengine 模式都要求真实法务披露配置', () => {
    const base = {
      NODE_ENV: 'test' as const,
      REAL_PORTRAIT_PROVIDER_MODE: 'fake' as const,
      REAL_PORTRAIT_TOKEN_ENCRYPTION_KEY: 'real-portrait-test-encryption-key-32-bytes',
    };
    expect(() => assertRealPortraitProviderConfiguration(base)).toThrow(/个人信息处理者/);
    expect(() => assertRealPortraitProviderConfiguration({
      ...base,
      REAL_PORTRAIT_CONTROLLER_NAME: '测试运营主体',
      REAL_PORTRAIT_PROCESSOR_NAME: '测试受托处理方',
      REAL_PORTRAIT_PRIVACY_CONTACT: 'privacy@example.test',
      REAL_PORTRAIT_PRIVACY_POLICY_URL: 'https://example.test/privacy',
    })).not.toThrow();
  });

  it('正式火山模式额外要求专用 Assets API AK/SK', () => {
    expect(() => assertRealPortraitProviderConfiguration({
      NODE_ENV: 'production',
      REAL_PORTRAIT_PROVIDER_MODE: 'volcengine',
      REAL_PORTRAIT_TOKEN_ENCRYPTION_KEY: 'real-portrait-production-key-32-bytes',
      REAL_PORTRAIT_CONTROLLER_NAME: '正式运营主体',
      REAL_PORTRAIT_PROCESSOR_NAME: '正式受托处理方',
      REAL_PORTRAIT_PRIVACY_CONTACT: 'privacy@example.com',
      REAL_PORTRAIT_PRIVACY_POLICY_URL: 'https://example.com/privacy',
    })).toThrow(/AK\/SK/);
  });

  it('提示词向导拒绝突破 120s/180s/240s 硬预算', () => {
    expect(() => assertPromptWizardRetryConfiguration(retryConfig({
      PROMPT_WIZARD_TIMEOUT_MS: 120_001,
    }))).toThrow(/120 秒硬上限/);
    expect(() => assertPromptWizardRetryConfiguration(retryConfig({
      PROMPT_WIZARD_REQUEST_BUDGET_MS: 180_001,
    }))).toThrow(/180 秒硬上限/);
    expect(() => assertPromptWizardRetryConfiguration(retryConfig({
      PROMPT_WIZARD_BATCH_BUDGET_MS: 240_001,
    }))).toThrow(/240 秒硬上限/);
  });

  it('提示词向导仍拒绝单次超时超过请求预算或请求预算超过批次预算', () => {
    expect(() => assertPromptWizardRetryConfiguration(retryConfig({
      PROMPT_WIZARD_TIMEOUT_MS: 100_000,
      PROMPT_WIZARD_REQUEST_BUDGET_MS: 90_000,
    }))).toThrow(/单次尝试超时/);
    expect(() => assertPromptWizardRetryConfiguration(retryConfig({
      PROMPT_WIZARD_REQUEST_BUDGET_MS: 180_000,
      PROMPT_WIZARD_BATCH_BUDGET_MS: 170_000,
    }))).toThrow(/批次总预算/);
  });

  it('提示词向导重试配置接受 120s 单次、180s 请求和 240s 批次边界', () => {
    expect(() => assertPromptWizardRetryConfiguration(retryConfig())).not.toThrow();
    expect(() => assertPromptWizardRetryConfiguration(retryConfig({
      PROMPT_WIZARD_RETRY_BASE_DELAY_MS: 9_000,
    }))).toThrow(/基础等待/);
    expect(() => assertPromptWizardRetryConfiguration(retryConfig({
      PROMPT_WIZARD_MAX_RETRIES: 2,
    }))).toThrow(/最多只能配置一次/);
  });

  it.each([
    'dev-only-change-this-secret',
    'change-this-to-a-long-random-secret',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'too-short',
  ])('拒绝弱 JWT_SECRET：%s', secret => {
    expect(() => assertSecureProductionJwtSecret('production', secret)).toThrow(/JWT_SECRET/);
  });

  it('接受足够长且非示例值的随机密钥', () => {
    expect(() => assertSecureProductionJwtSecret(
      'production',
      'R5L9hKx7!mQ2pV8zN4cT6wY1sD3fG0jB',
    )).not.toThrow();
  });

  it('开发和测试环境可以继续使用本地默认值', () => {
    expect(() => assertSecureProductionJwtSecret('test', 'dev-only-change-this-secret')).not.toThrow();
  });

  it.each(['*', 'http://app.example.com', 'https://app.example.com/path', 'not-an-origin'])(
    '生产 Cookie 会话拒绝不安全 CORS 来源：%s',
    origin => {
      expect(() => assertSecureProductionCorsOrigin('production', origin)).toThrow(/CORS_ORIGIN/);
    },
  );

  it('生产 Cookie 会话允许明确的多个 HTTPS 来源', () => {
    expect(() => assertSecureProductionCorsOrigin(
      'production',
      'https://app.example.com,https://admin.example.com',
    )).not.toThrow();
  });

  it('生产公开地址必须使用无路径 HTTPS 来源', () => {
    expect(() => assertSecureProductionPublicUrls('production', {
      PUBLIC_BASE_URL: 'http://api.example.com',
      APP_BASE_URL: 'https://app.example.com/reset',
    })).toThrow(/HTTPS/);
    expect(() => assertSecureProductionPublicUrls('production', {
      PUBLIC_BASE_URL: 'https://api.example.com',
      APP_BASE_URL: 'https://app.example.com',
    })).not.toThrow();
  });

  it('生产环境拒绝公开对象存储基础地址', () => {
    expect(() => assertPrivateProductionStorage(
      'production',
      'https://public-assets.example.com',
    )).toThrow(/STORAGE_PUBLIC_BASE_URL/);
    expect(() => assertPrivateProductionStorage('production', undefined)).not.toThrow();
    expect(() => assertPrivateProductionStorage('test', 'http://localhost:4300/storage')).not.toThrow();
  });

  it('TOS 驱动缺少私有存储配置或生产使用 HTTP 时拒绝启动', () => {
    expect(() => assertStorageDriverConfiguration('production', 'tos', {})).toThrow(/TOS/);
    expect(() => assertStorageDriverConfiguration('production', 'tos', {
      endpoint: 'http://tos.example.com',
      bucket: 'private-bucket',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
    })).toThrow(/HTTPS/);
    expect(() => assertStorageDriverConfiguration('production', 'tos', {
      endpoint: 'https://tos.example.com',
      bucket: 'private-bucket',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
    })).not.toThrow();
  });

  it('生产数据库和 Redis 不能继续使用默认或无密码连接', () => {
    expect(() => assertSecureProductionInfrastructureUrls(
      'production',
      'postgres://lindyson:lindyson@postgres:5432/lindyson',
      'redis://redis:6379',
    )).toThrow();
    expect(() => assertSecureProductionInfrastructureUrls(
      'production',
      'postgres://app:strong-db-password@postgres:5432/lindyson',
      'redis://:strong-redis-password@redis:6379',
    )).not.toThrow();
  });
});

function retryConfig(overrides: Partial<Parameters<typeof assertPromptWizardRetryConfiguration>[0]> = {}) {
  return {
    PROMPT_WIZARD_TIMEOUT_MS: 120_000,
    PROMPT_WIZARD_REQUEST_BUDGET_MS: 180_000,
    PROMPT_WIZARD_BATCH_BUDGET_MS: 240_000,
    PROMPT_WIZARD_MAX_RETRIES: 1,
    PROMPT_WIZARD_RETRY_BASE_DELAY_MS: 1_000,
    PROMPT_WIZARD_RETRY_MAX_DELAY_MS: 8_000,
    ...overrides,
  };
}
