import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  computeProviderOperationalUsageManifestSha256,
  parseProviderOperationalUsageManifest,
  PROVIDER_OPERATIONAL_USAGE_MANIFEST_VERSION,
  type JsonValue,
  type ProviderOperationalUsageManifest,
  type ProviderOperationalUsageRecordV1,
} from '../domain/providerOperationalUsageManifest.js';

export interface ProviderOperationalUsageManifestBuildInput {
  manifestId: string;
  generatedAt?: string;
  records: ProviderOperationalUsageRecordV1[];
}

export interface ProviderOperationalUsageManifestWriteResult {
  manifestPath: string;
  manifestSha256: string;
  byteLength: number;
  recordCount: number;
}

export interface ProviderOperationalUsageEvidenceWriteResult {
  evidencePath: string;
  evidenceSha256: string;
  byteLength: number;
}

export interface ProviderOperationalUsageManifestRuntimeConfig {
  outputPath: string;
  costOwnerUserId: string;
  sourceRunId: string;
}

export function buildProviderOperationalUsageManifest(
  input: ProviderOperationalUsageManifestBuildInput,
): ProviderOperationalUsageManifest {
  return parseProviderOperationalUsageManifest({
    manifestVersion: PROVIDER_OPERATIONAL_USAGE_MANIFEST_VERSION,
    manifestId: input.manifestId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    records: input.records,
  });
}

/**
 * manifest 使用同文件系统临时 inode + hard link 发布，最终路径已存在时 fail closed，
 * 不允许 canary 重跑覆盖历史证据。
 */
export async function writeProviderOperationalUsageManifest(
  outputPath: string,
  input: ProviderOperationalUsageManifestBuildInput,
): Promise<ProviderOperationalUsageManifestWriteResult> {
  const manifest = buildProviderOperationalUsageManifest(input);
  await verifyManifestEvidenceFiles(manifest);
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const bytes = Buffer.from(serialized);
  const manifestSha256 = computeProviderOperationalUsageManifestSha256(bytes);
  const manifestPath = await writeImmutableBytes(outputPath, bytes);

  return {
    manifestPath,
    manifestSha256,
    byteLength: bytes.byteLength,
    recordCount: manifest.records.length,
  };
}

/**
 * canary 先把实际 Provider 观测写成独立不可变证据文件，再用该文件的原始字节
 * SHA256 构造 manifest。这样 evidencePath 与 evidenceSha256 始终指向同一事实。
 */
export async function writeProviderOperationalUsageEvidence(
  outputPath: string,
  evidence: JsonValue,
): Promise<ProviderOperationalUsageEvidenceWriteResult> {
  const bytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
  const evidenceSha256 = createHash('sha256').update(bytes).digest('hex');
  const evidencePath = await writeImmutableBytes(outputPath, bytes);
  await verifyProviderOperationalUsageEvidenceFile(evidencePath, evidenceSha256);
  return { evidencePath, evidenceSha256, byteLength: bytes.byteLength };
}

export async function writeProviderOperationalUsageCanaryBundle(input: {
  manifestPath: string;
  manifestId: string;
  generatedAt?: string;
  evidence: JsonValue;
  buildRecords: (
    evidence: ProviderOperationalUsageEvidenceWriteResult,
  ) => ProviderOperationalUsageRecordV1[];
}) {
  const evidence = await writeProviderOperationalUsageEvidence(
    evidencePathForManifest(input.manifestPath),
    input.evidence,
  );
  const manifest = await writeProviderOperationalUsageManifest(input.manifestPath, {
    manifestId: input.manifestId,
    generatedAt: input.generatedAt,
    records: input.buildRecords(evidence),
  });
  return { ...manifest, ...evidence };
}

export async function verifyProviderOperationalUsageEvidenceFile(
  evidencePath: string,
  expectedSha256: string,
) {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw manifestWriterError('PROVIDER_OPERATIONAL_USAGE_EVIDENCE_SHA256_INVALID');
  }
  const bytes = await readFile(resolve(evidencePath));
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw manifestWriterError('PROVIDER_OPERATIONAL_USAGE_EVIDENCE_FILE_HASH_MISMATCH');
  }
  return actualSha256;
}

export async function verifyWrittenProviderOperationalUsageManifest(result: ProviderOperationalUsageManifestWriteResult) {
  const bytes = await readFile(result.manifestPath);
  const actualSha256 = computeProviderOperationalUsageManifestSha256(bytes);
  if (actualSha256 !== result.manifestSha256) {
    throw manifestWriterError('PROVIDER_OPERATIONAL_USAGE_MANIFEST_POST_WRITE_HASH_MISMATCH');
  }
  return actualSha256;
}

export function hashProviderIdentifier(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (/^sha256:[0-9a-f]{16}(?:[0-9a-f]{48})?$/.test(normalized)) return normalized;
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}

export function hashOperationalUsageEvidence(evidence: Record<string, JsonValue>) {
  return createHash('sha256').update(JSON.stringify(sortJsonValue(evidence))).digest('hex');
}

export function providerOperationalUsageManifestRuntimeConfig(environment: NodeJS.ProcessEnv = process.env) {
  const outputPath = environment.PROVIDER_OPERATIONAL_USAGE_MANIFEST_PATH?.trim() || null;
  const costOwnerUserId = environment.PROVIDER_OPERATIONAL_USAGE_COST_OWNER_USER_ID?.trim() || null;
  const sourceRunId = environment.PROVIDER_OPERATIONAL_USAGE_SOURCE_RUN_ID?.trim() || null;
  const values = [outputPath, costOwnerUserId, sourceRunId];
  if (values.some(value => value === null) && values.some(value => value !== null)) {
    throw manifestWriterError('PROVIDER_OPERATIONAL_USAGE_MANIFEST_CONFIG_INCOMPLETE');
  }
  if (costOwnerUserId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(costOwnerUserId)) {
    throw manifestWriterError('PROVIDER_OPERATIONAL_USAGE_COST_OWNER_INVALID');
  }
  if (sourceRunId && sourceRunId.length > 1024) {
    throw manifestWriterError('PROVIDER_OPERATIONAL_USAGE_SOURCE_RUN_ID_INVALID');
  }
  return { outputPath, costOwnerUserId, sourceRunId };
}

export function requireProviderOperationalUsageManifestRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ProviderOperationalUsageManifestRuntimeConfig {
  const config = providerOperationalUsageManifestRuntimeConfig(environment);
  if (!config.outputPath || !config.costOwnerUserId || !config.sourceRunId) {
    throw manifestWriterError('PROVIDER_OPERATIONAL_USAGE_MANIFEST_CONFIG_REQUIRED');
  }
  return {
    outputPath: resolve(config.outputPath),
    costOwnerUserId: config.costOwnerUserId,
    sourceRunId: config.sourceRunId,
  };
}

function sortJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJsonValue(item)]),
  );
}

async function verifyManifestEvidenceFiles(manifest: ProviderOperationalUsageManifest) {
  const evidenceFiles = new Map<string, string>();
  for (const record of manifest.records) {
    const previousSha256 = evidenceFiles.get(record.evidencePath);
    if (previousSha256 && previousSha256 !== record.evidenceSha256) {
      throw manifestWriterError('PROVIDER_OPERATIONAL_USAGE_EVIDENCE_PATH_CONFLICT');
    }
    evidenceFiles.set(record.evidencePath, record.evidenceSha256);
  }
  await Promise.all([...evidenceFiles].map(([evidencePath, evidenceSha256]) => (
    verifyProviderOperationalUsageEvidenceFile(evidencePath, evidenceSha256)
  )));
}

function evidencePathForManifest(manifestPath: string) {
  const absolutePath = resolve(manifestPath);
  return absolutePath.endsWith('.json')
    ? `${absolutePath.slice(0, -'.json'.length)}.evidence.json`
    : `${absolutePath}.evidence.json`;
}

async function writeImmutableBytes(outputPath: string, bytes: Buffer) {
  const finalPath = resolve(outputPath);
  const directory = dirname(finalPath);
  const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });

  let temporaryCreated = false;
  try {
    const handle = await open(temporaryPath, 'wx', 0o600);
    temporaryCreated = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporaryPath, finalPath);
    await unlink(temporaryPath);
    temporaryCreated = false;
  } catch (error) {
    if (temporaryCreated) await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return finalPath;
}

function manifestWriterError(code: string) {
  return Object.assign(new Error(code), { code });
}
