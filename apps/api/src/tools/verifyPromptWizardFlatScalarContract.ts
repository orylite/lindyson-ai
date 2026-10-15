import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPromptWizardProductionBrief } from '../domain/promptWizardCreativePlaybook.js';
import { buildPromptWizardEvidenceGraph } from '../domain/promptWizardEvidenceGraph.js';
import {
  buildPromptWizardRouteSetV6,
  promptWizardRouteContextsV6,
} from '../domain/promptWizardV6Routes.js';
import {
  createPromptWizardDraftWireV2JsonSchema,
  createPromptWizardFlatScalarLayout,
  type PromptWizardFlatScalarLayout,
  type PromptWizardUseDirectionDraftGenerationContext,
} from '../providers/promptWizardProvider.js';
import {
  PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES,
} from './canaryPromptWizardUseDirections.js';

export const PROMPT_WIZARD_FLAT_SCALAR_IMAGE_PROBE_RESULT =
  'prompt-wizard-flat-scalars-v2-contract=passed';

interface FlatScalarJsonSchema {
  type?: unknown;
  additionalProperties?: unknown;
  required?: unknown;
  properties?: unknown;
}

/**
 * 候选镜像中的可执行协议证明。这里调用生产布局和 Schema 生成器，而不是
 * grep 编译产物中的实现行，因此重排源码不会误伤，旧嵌套 Wire 也不能靠保留
 * 一个字符串绕过。探针不读取 Provider Key、不联网，也不创建任何业务数据。
 */
export function verifyPromptWizardFlatScalarImageContract() {
  flatScalarProbeAssert(
    PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.length === 15,
    'Flat Scalar 镜像探针要求固定 15 个 Canary 案例',
  );
  const voiceoverCases = PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.filter(
    testCase => testCase.targetLanguage !== null,
  );
  flatScalarProbeAssert(
    voiceoverCases.length === 10,
    'Flat Scalar 镜像探针要求固定 10 个口播案例',
  );
  const languageCounts = new Map<string, number>();
  for (const testCase of voiceoverCases) {
    languageCounts.set(
      testCase.targetLanguage!,
      (languageCounts.get(testCase.targetLanguage!) ?? 0) + 1,
    );
  }
  flatScalarProbeAssert(
    ['普通话', '英语', '西班牙语', '日语', '泰语'].every(
      language => languageCounts.get(language) === 2,
    ) && languageCounts.size === 5,
    'Flat Scalar 镜像探针要求五种语言各两个口播案例',
  );
  flatScalarProbeAssert(
    voiceoverCases[0]?.id === '服饰-10s-zh'
      && voiceoverCases[3]?.id === '家居-15s-zh',
    'Flat Scalar 镜像探针的普通话风险案例顺序无效',
  );

  for (const [caseIndex, testCase] of PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.entries()) {
    const evidenceGraph = buildPromptWizardEvidenceGraph(testCase.profile, 1);
    const routeSet = buildPromptWizardRouteSetV6({
      id: flatScalarProbeUuid(2_000 + caseIndex),
      runId: flatScalarProbeUuid(1_000 + caseIndex),
      runRevision: 1,
      profile: testCase.profile,
      evidenceGraph,
      productionBrief: buildPromptWizardProductionBrief(testCase.profile),
      createdAt: '2026-08-09T00:00:00.000Z',
    });
    const routeContext = promptWizardRouteContextsV6(routeSet)[0]!;
    const context = {
      profile: testCase.profile,
      evidenceGraph,
      ...(testCase.targetLanguage === null
        ? {}
        : { targetLanguage: testCase.targetLanguage }),
      confirmedOffer: '',
      config: testCase.config,
      imageCount: 1,
      variationKey: 1,
      planContexts: [routeContext],
    } satisfies PromptWizardUseDirectionDraftGenerationContext;
    const segmentCount = testCase.config.durationSeconds === 5
      ? 2 as const
      : testCase.config.durationSeconds === 10
        ? 3 as const
        : 4 as const;
    const creativeLayout = createPromptWizardFlatScalarLayout(
      context,
      segmentCount,
      'creative',
    );
    const recoveryLayout = createPromptWizardFlatScalarLayout(
      context,
      segmentCount,
      'recovery',
    );
    assertFlatScalarLayout(creativeLayout, true);
    assertFlatScalarLayout(recoveryLayout, false);
    assertFlatScalarSchema(
      createPromptWizardDraftWireV2JsonSchema(context, segmentCount, false),
      creativeLayout,
    );
    assertFlatScalarSchema(
      createPromptWizardDraftWireV2JsonSchema(context, segmentCount, true),
      recoveryLayout,
    );
    flatScalarProbeAssert(
      recoveryLayout.entries.map(entry => entry.key).join('\n')
        === creativeLayout.entries
          .filter(entry => entry.key !== 'hook')
          .map(entry => entry.key)
          .join('\n'),
      'Flat Scalar recovery 必须严格等于 creative 去除 Hook',
    );

    if (testCase.targetLanguage === null) {
      flatScalarProbeAssert(
        creativeLayout.entries.every(entry => !/^v|^z/u.test(entry.key)),
        '5 秒纯视觉 Flat Scalar 不得包含口播键',
      );
    } else {
      const voiceoverLayout = createPromptWizardFlatScalarLayout(
        context,
        segmentCount,
        'voiceover',
      );
      assertFlatScalarLayout(voiceoverLayout, false, true);
      flatScalarProbeAssert(
        voiceoverLayout.entries.every(entry => /^v|^z/u.test(entry.key)),
        '口播 Flat Scalar 不得包含 Hook 或镜头键',
      );
    }

    if (testCase.id === '服饰-10s-zh') {
      flatScalarProbeAssert(
        creativeLayout.entries.length === 22 && recoveryLayout.entries.length === 21,
        '10 秒普通话 Flat Scalar 固定键数无效',
      );
    }
    if (testCase.id === '家居-15s-zh') {
      flatScalarProbeAssert(
        creativeLayout.entries.length === 29 && recoveryLayout.entries.length === 28,
        '15 秒普通话 Flat Scalar 固定键数无效',
      );
    }
  }

  return {
    caseCount: PROMPT_WIZARD_USE_DIRECTION_CANARY_CASES.length,
    voiceoverCaseCount: voiceoverCases.length,
    languageCount: languageCounts.size,
  } as const;
}

function assertFlatScalarLayout(
  layout: PromptWizardFlatScalarLayout,
  requiresHook: boolean,
  voiceoverOnly = false,
) {
  flatScalarProbeAssert(
    layout.format === 'prompt-wizard-flat-scalars-v2',
    'Flat Scalar format 无效',
  );
  const keys = layout.entries.map(entry => entry.key);
  flatScalarProbeAssert(
    keys.length > 0 && new Set(keys).size === keys.length,
    'Flat Scalar 固定键必须非空且唯一',
  );
  flatScalarProbeAssert(
    (keys.includes('hook') === requiresHook)
      && !keys.some(key => ['shots', 'segments', 'voiceoverSlots'].includes(key)),
    'Flat Scalar 顶层键集包含旧嵌套 Wire',
  );
  if (!voiceoverOnly) {
    flatScalarProbeAssert(
      Array.from({ length: layout.segmentCount }, (_, segmentIndex) => (
        ['ShotSize', 'Action', 'CameraMovement', 'LightingAndRealism', 'Foley', 'EditingCue']
          .every(suffix => keys.includes(`s${segmentIndex}${suffix}`))
      )).every(Boolean),
      'Flat Scalar 六字段镜头固定键不完整',
    );
  }
}

function assertFlatScalarSchema(
  rawSchema: FlatScalarJsonSchema,
  layout: PromptWizardFlatScalarLayout,
) {
  const required = Array.isArray(rawSchema.required) ? rawSchema.required : [];
  const properties = isRecord(rawSchema.properties) ? rawSchema.properties : {};
  const expectedKeys = layout.entries.map(entry => entry.key);
  flatScalarProbeAssert(
    rawSchema.type === 'object'
      && rawSchema.additionalProperties === false
      && required.join('\n') === expectedKeys.join('\n')
      && Object.keys(properties).join('\n') === expectedKeys.join('\n'),
    'Flat Scalar JSON Schema 的根键集无效',
  );
  flatScalarProbeAssert(
    Object.values(properties).every(property => (
      isRecord(property)
      && property.type === 'string'
      && !Object.hasOwn(property, 'items')
      && !Object.hasOwn(property, 'properties')
    )),
    'Flat Scalar JSON Schema 禁止根对象外的容器',
  );
}

function flatScalarProbeAssert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function flatScalarProbeUuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry!) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  verifyPromptWizardFlatScalarImageContract();
  process.stdout.write(`${PROMPT_WIZARD_FLAT_SCALAR_IMAGE_PROBE_RESULT}\n`);
}
