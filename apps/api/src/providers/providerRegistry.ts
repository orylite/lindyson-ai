import type { ProviderTaskInput } from './fakeProvider.js';
import { isSeedanceModelLabel } from '../domain/seedanceModels.js';
import { isSeedreamModelLabel } from '../domain/seedreamModels.js';
import { env } from '../config/env.js';

type ProviderSelectionInput = Pick<ProviderTaskInput, 'kind' | 'model'> & {
  providerTaskId?: string | null;
};

interface ProviderSelectionOptions {
  arkApiKey?: string;
  nodeEnv?: 'development' | 'test' | 'production';
  fakeProviderEnabled?: boolean;
}

export async function runProvider(input: ProviderTaskInput) {
  if (supportsArkSeedreamProvider(input)) {
    if (env.ARK_API_KEY) {
      const { runArkSeedreamProvider } = await import('./arkSeedreamProvider.js');
      return runArkSeedreamProvider(input);
    }
    if (!isFakeProviderEnabled()) {
      throw providerUnavailable('未配置 ARK_API_KEY，且当前环境未显式启用 Fake Provider。');
    }
    return runFakeProvider(input);
  }

  if (supportsArkSeedanceProvider(input)) {
    if (env.ARK_API_KEY) {
      const { runArkSeedanceProvider } = await import('./arkSeedanceProvider.js');
      return runArkSeedanceProvider(input);
    }
    if (!isFakeProviderEnabled()) {
      throw providerUnavailable('未配置 ARK_API_KEY，且当前环境未显式启用 Fake Provider。');
    }
    return runFakeProvider(input);
  }

  if (!isFakeProviderEnabled()) {
    throw providerUnavailable(`当前环境不支持生成模型：${input.model}`);
  }
  return runFakeProvider(input);
}

export function supportsArkSeedanceProvider(input: Pick<ProviderTaskInput, 'kind' | 'model'>) {
  return input.kind === 'video' && isSeedanceModelLabel(input.model);
}

export function supportsArkSeedreamProvider(input: Pick<ProviderTaskInput, 'kind' | 'model'>) {
  return input.kind === 'image' && isSeedreamModelLabel(input.model);
}

/**
 * 在创建 generation_provider_run 时固定实际适配器，不能等供应商返回 task id 后再改。
 * 这既保证 run 身份不可变，也避免开发/测试的 Fake fallback 被误记为方舟调用。
 */
export function selectGenerationProviderName(
  input: ProviderSelectionInput,
  options: ProviderSelectionOptions = {},
) {
  if (input.providerTaskId) {
    return input.providerTaskId.startsWith('fake-') ? 'fake-provider' : 'volcengine-ark';
  }

  const arkApiKey = options.arkApiKey ?? env.ARK_API_KEY;
  const nodeEnv = options.nodeEnv ?? env.NODE_ENV;
  const fakeProviderEnabled = options.fakeProviderEnabled ?? env.ENABLE_FAKE_PROVIDER;
  const isArkTask = supportsArkSeedanceProvider(input) || supportsArkSeedreamProvider(input);

  if (isArkTask && arkApiKey) return 'volcengine-ark';
  if (isFakeProviderEnabled(nodeEnv, fakeProviderEnabled)) return 'fake-provider';
  return 'volcengine-ark';
}

export function isFakeProviderEnabled(
  nodeEnv = env.NODE_ENV,
  explicitlyEnabled = env.ENABLE_FAKE_PROVIDER,
) {
  return nodeEnv !== 'production' && explicitlyEnabled;
}

export async function resumeProviderTask(input: ProviderTaskInput, providerTaskId: string) {
  if (supportsArkSeedreamProvider(input) && !providerTaskId.startsWith('fake-')) {
    const { resumeArkSeedreamProvider } = await import('./arkSeedreamProvider.js');
    return resumeArkSeedreamProvider(input, providerTaskId);
  }

  if (supportsArkSeedanceProvider(input) && !providerTaskId.startsWith('fake-')) {
    const {
      buildSeedanceProviderFailure,
      classifySeedanceProviderError,
      notifyArkSeedanceUsageObserved,
      readArkSeedanceTask,
      recoverArkSeedanceTaskResult,
      tryRequestArkSeedanceTaskCancellation,
    } = await import('./arkSeedanceProvider.js');
    if (await input.isCancellationRequested?.()) {
      await tryRequestArkSeedanceTaskCancellation(providerTaskId);
    }
    const status = await readArkSeedanceTask(providerTaskId);
    if (['queued', 'pending', 'running', 'processing', 'created'].includes(status.status)) return null;
    if (['failed', 'error', 'cancelled', 'canceled', 'expired'].includes(status.status)) {
      await notifyArkSeedanceUsageObserved(input, providerTaskId, status);
      return {
        ...buildSeedanceProviderFailure(
          status.status === 'expired'
            ? 'system-timeout'
            : classifySeedanceProviderError(status.errorMessage ?? '', status.errorCode),
          status.errorMessage || `Seedance 任务失败：${status.status}`,
          providerTaskId,
          status.usage,
          status.status,
          { providerErrorCode: status.errorCode },
        ),
        terminal: true,
      };
    }
    if (['succeeded', 'success', 'completed', 'done'].includes(status.status)) {
      return recoverArkSeedanceTaskResult({ ...input, providerTaskId });
    }
    return null;
  }

  // Fake provider 是确定性的，重新执行不会创建外部计费任务，但仍须遵守环境开关。
  if (providerTaskId.startsWith('fake-')) {
    if (!isFakeProviderEnabled()) {
      throw providerUnavailable('当前环境未显式启用 Fake Provider，不能恢复 Fake 任务。');
    }
    return runFakeProvider({ ...input, onProviderSubmissionStarted: undefined });
  }
  return null;
}

async function runFakeProvider(input: ProviderTaskInput) {
  const provider = await import('./fakeProvider.js');
  return provider.runFakeProvider(input);
}

function providerUnavailable(message: string) {
  return Object.assign(new Error(message), {
    statusCode: 503,
    code: 'PROVIDER_UNAVAILABLE',
  });
}
