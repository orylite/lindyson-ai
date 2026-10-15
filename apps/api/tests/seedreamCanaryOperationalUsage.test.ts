import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseProviderOperationalUsageManifestJson } from '../src/domain/providerOperationalUsageManifest.js';

const mocks = vi.hoisted(() => ({
  runProvider: vi.fn(),
  deleteObject: vi.fn(async () => undefined),
}));

vi.mock('../src/config/env.js', () => ({
  env: {
    ARK_API_KEY: 'test-ark-key',
    STORAGE_DRIVER: 'tos',
  },
}));
vi.mock('../src/providers/arkSeedreamProvider.js', () => ({
  runArkSeedreamProvider: mocks.runProvider,
}));
vi.mock('../src/storage/storageService.js', () => ({
  deleteObject: mocks.deleteObject,
  getStoredObjectSize: vi.fn(),
  resolveObjectProcessingInput: vi.fn(),
}));
vi.mock('../src/storage/mediaProcessor.js', () => ({
  probeMedia: vi.fn(),
  validateMediaDecoding: vi.fn(),
}));

import { runSeedreamProviderCanary } from '../src/tools/canarySeedreamProvider.js';

const temporaryDirectories: string[] = [];
const originalEnvironment = {
  manifestPath: process.env.PROVIDER_OPERATIONAL_USAGE_MANIFEST_PATH,
  owner: process.env.PROVIDER_OPERATIONAL_USAGE_COST_OWNER_USER_ID,
  sourceRunId: process.env.PROVIDER_OPERATIONAL_USAGE_SOURCE_RUN_ID,
};

afterEach(async () => {
  mocks.runProvider.mockReset();
  mocks.deleteObject.mockClear();
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { recursive: true, force: true })
  )));
  restoreEnvironment('PROVIDER_OPERATIONAL_USAGE_MANIFEST_PATH', originalEnvironment.manifestPath);
  restoreEnvironment('PROVIDER_OPERATIONAL_USAGE_COST_OWNER_USER_ID', originalEnvironment.owner);
  restoreEnvironment('PROVIDER_OPERATIONAL_USAGE_SOURCE_RUN_ID', originalEnvironment.sourceRunId);
});

describe('Seedream canary 提交未知运营留证', () => {
  it('Provider submission callback 后网络异常仍写 unknown/missing-evidence manifest 且只调用一次', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'seedream-canary-operational-'));
    temporaryDirectories.push(directory);
    const manifestPath = join(directory, 'provider-operational-usage.json');
    process.env.PROVIDER_OPERATIONAL_USAGE_MANIFEST_PATH = manifestPath;
    process.env.PROVIDER_OPERATIONAL_USAGE_COST_OWNER_USER_ID = '00000000-0000-4000-8000-000000000001';
    process.env.PROVIDER_OPERATIONAL_USAGE_SOURCE_RUN_ID = 'seedream-network-timeout-1';
    const networkError = Object.assign(new Error('provider response timeout'), {
      code: 'SEEDREAM_SUBMISSION_UNKNOWN',
    });
    mocks.runProvider.mockImplementationOnce(async input => {
      await input.onProviderSubmissionStarted?.();
      throw networkError;
    });

    await expect(runSeedreamProviderCanary()).rejects.toBe(networkError);
    expect(mocks.runProvider).toHaveBeenCalledOnce();
    const manifest = parseProviderOperationalUsageManifestJson(await readFile(manifestPath));
    expect(manifest.records).toHaveLength(1);
    expect(manifest.records[0]).toMatchObject({
      sourceRunId: 'seedream-network-timeout-1',
      sourceItemKey: 'seedream-generation',
      status: 'unknown',
      providerReached: true,
      providerTaskId: null,
      providerOperationId: null,
      providerRequestId: null,
      valuation: {
        pricingStatus: 'missing-evidence',
        estimatedCostCny: null,
      },
    });
    expect(manifest.records[0]?.usageEvidence).toMatchObject({
      localCheckpointOperationId: null,
      providerOperationIdSha256: null,
      providerRequestIdSha256: null,
    });
    expect(JSON.parse(await readFile(
      join(directory, 'provider-operational-usage.evidence.json'),
      'utf8',
    ))).toMatchObject({
      status: 'unknown',
      providerOutcome: 'submission-started-response-unknown',
      localCheckpointOperationId: null,
      providerRequestId: null,
    });
    expect(mocks.deleteObject).toHaveBeenCalledTimes(2);
  });
});

function restoreEnvironment(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
