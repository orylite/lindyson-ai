import type {
  PromptWizardProductionLoad,
  PromptWizardVideoConfig,
} from '@lindyson/api-contracts';

export interface PromptWizardExecutionBudget {
  maxLocationCount: number;
  maxPersonCount: number;
  maxMajorActionCount: number;
  maxPropCount: number;
  maxCameraMoveCount: number;
  allowMagicTransition: false;
}

export type PromptWizardExecutionBudgetIssueCode =
  | 'TOO_MANY_LOCATIONS'
  | 'TOO_MANY_PEOPLE'
  | 'TOO_MANY_ACTIONS'
  | 'TOO_MANY_PROPS'
  | 'TOO_MANY_CAMERA_MOVES'
  | 'MAGIC_TRANSITION_FORBIDDEN';

export interface PromptWizardExecutionBudgetIssue {
  code: PromptWizardExecutionBudgetIssueCode;
  fieldPath: string;
  actual: number | boolean;
  limit: number | boolean;
  message: string;
}

export class PromptWizardExecutionBudgetError extends Error {
  readonly code = 'PROMPT_WIZARD_EXECUTION_BUDGET_EXCEEDED';
  readonly fieldPaths: string[];

  constructor(readonly issues: PromptWizardExecutionBudgetIssue[]) {
    super(`创意路线超出当前视频模型的执行预算：${issues.map(issue => (
      `${issue.code}(${String(issue.actual)}>${String(issue.limit)}) ${issue.message}`
    )).join('、')}`);
    this.name = 'PromptWizardExecutionBudgetError';
    this.fieldPaths = [...new Set(issues.map(issue => (
      issue.fieldPath.startsWith('segments') ? 'segments' : issue.fieldPath
    )))];
  }
}

/**
 * 扩写后的分镜才是交给视频模型的真实执行计划。这里刻意只依赖分镜字段，
 * 不读取创意路线阶段的 productionLoad，避免模型在概念阶段低报复杂度后绕过门禁。
 */
export interface PromptWizardExecutableShot {
  role?: string;
  location: string;
  subject: string;
  action: string;
  cameraMovement: string;
  productionNote?: string;
}

export interface PromptWizardShotProductionLoadResult {
  productionLoad: PromptWizardProductionLoad;
  evidence: {
    locations: string[];
    personCounts: number[];
    actionFamilies: string[];
    props: string[];
    cameraMoves: string[];
    magicFieldPaths: string[];
  };
}

const LOCATION_FAMILIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/卧室|衣帽间|床边/u, '卧室'],
  [/客厅|沙发区/u, '客厅'],
  [/厨房|料理台|灶台/u, '厨房'],
  [/浴室|洗手间|盥洗/u, '浴室'],
  [/办公室|办公位|工位|会议室/u, '办公室'],
  [/健身房|健身工作室/u, '健身房'],
  [/摄影棚|影棚|棚拍/u, '摄影棚'],
  [/地铁|站台/u, '地铁'],
  [/公交|巴士/u, '公交'],
  [/商场|店铺|门店|货架/u, '门店'],
  [/街道|街头|人行道/u, '街道'],
  [/阳台/u, '阳台'],
  [/户外|草地|公园|球场/u, '户外'],
  [/桌面|操作台/u, '桌面'],
];

const ACTION_FAMILIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/拿起|取出|抽出|拾起|取用/u, '取用'],
  [/放下|放入|装入|收进|归位/u, '放置收纳'],
  [/打开|开启|揭开|掀开|拉开|撕开/u, '打开'],
  [/关闭|合上|扣合|封口/u, '关闭'],
  [/按压|按下|触按|点击/u, '按压'],
  [/旋转|拧动|转动/u, '旋转'],
  [/折叠|折起/u, '折叠'],
  [/展开|摊开|铺开/u, '展开'],
  [/穿上|套上|佩戴|戴上|套头/u, '穿戴'],
  [/脱下|摘下|取下/u, '取下'],
  [/倒入|倾倒|注入/u, '倾倒'],
  [/喷洒|喷出|喷在|喷涂/u, '喷洒'],
  [/涂抹|擦拭|清洁|刷洗/u, '涂抹清洁'],
  [/连接|插入|接入|配对/u, '连接'],
  [/启动|开机|点亮|通电/u, '启动'],
  [/翻转|转身|翻面/u, '翻转'],
  [/挤出|挤压/u, '挤压'],
  [/移动|推入|拉出|滑动/u, '移动'],
];

const CAMERA_MOVE_FAMILIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/推近|推进|前推/u, '推进'],
  [/拉远|拉开|抽离|后拉/u, '拉远'],
  [/摇镜|摇移|横摇|纵摇/u, '摇镜'],
  [/平移|侧移|横移|滑轨/u, '平移'],
  [/跟拍|跟随|追踪/u, '跟拍'],
  [/环绕|绕拍/u, '环绕'],
  [/升起|下降|升降|抬升/u, '升降'],
  [/变焦|焦点切换|切换焦点|拉焦/u, '焦点变化'],
  [/旋转镜头|镜头旋转/u, '旋转'],
];

const PROP_FAMILIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/包装盒|外盒|礼盒|快递盒/u, '包装盒'],
  [/镜子|穿衣镜/u, '镜子'],
  [/衣架/u, '衣架'],
  [/行李箱/u, '行李箱'],
  [/手机/u, '手机'],
  [/电脑|笔记本电脑/u, '电脑'],
  [/杯子|水杯|玻璃杯|马克杯/u, '杯子'],
  [/桌子|桌面|操作台/u, '桌面'],
  [/椅子|座椅/u, '椅子'],
  [/背包|手提包|随身包/u, '包'],
  [/毛巾/u, '毛巾'],
  [/纸巾/u, '纸巾'],
  [/化妆棉/u, '化妆棉'],
  [/刷子|清洁刷|化妆刷/u, '刷子'],
  [/充电器|充电线|数据线/u, '充电配件'],
  [/剪刀/u, '剪刀'],
];

const MAGIC_TRANSITION_PATTERN = /(?:凭空|无中生有|魔法(?:换装|变身|变化)|瞬间换装|自动出现|突然变成|闪现出|变出一个)/u;

export function estimatePromptWizardShotProductionLoad(
  shots: readonly PromptWizardExecutableShot[],
): PromptWizardShotProductionLoadResult {
  const locations = uniqueMeaningful(shots.map(shot => normalizeLocation(shot.location)));
  const personCounts = shots.map(shot => estimatePeopleInShot(`${shot.subject} ${shot.action}`));
  const actionFamilies = collectFamilies(
    shots.filter(shot => shot.role !== 'cta').map(shot => shot.action),
    ACTION_FAMILIES,
  );
  const propText = shots.map(shot => `${shot.subject} ${shot.action} ${shot.productionNote ?? ''}`);
  const props = collectFamilies(propText, PROP_FAMILIES);
  const cameraMoves = collectCameraMoves(shots.map(shot => shot.cameraMovement));
  const magicFieldPaths = shots.flatMap((shot, index) => (
    MAGIC_TRANSITION_PATTERN.test(`${shot.action} ${shot.cameraMovement} ${shot.productionNote ?? ''}`)
      ? [`segments[${index}]`]
      : []
  ));
  return {
    productionLoad: {
      locationCount: Math.max(1, locations.length),
      personCount: Math.max(0, ...personCounts),
      // 没有命中动作词时仍按一个核心动作处理，避免自由文本通过填空绕过预算。
      majorActionCount: Math.max(1, actionFamilies.length),
      propCount: props.length,
      cameraMoveCount: cameraMoves.length,
      hasMagicTransition: magicFieldPaths.length > 0,
    },
    evidence: {
      locations,
      personCounts,
      actionFamilies,
      props,
      cameraMoves,
      magicFieldPaths,
    },
  };
}

export function validatePromptWizardShotExecutionBudget(input: {
  shots: readonly PromptWizardExecutableShot[];
  config: Pick<PromptWizardVideoConfig, 'model' | 'durationSeconds'>;
  /** V6 的 5 秒纯视觉分支只允许一个连续商品动作；旧任务缺省沿用历史预算。 */
  deliveryVersion?: 6;
}): PromptWizardExecutionBudgetIssue[] {
  const estimated = estimatePromptWizardShotProductionLoad(input.shots);
  return validatePromptWizardExecutionBudget({
    productionLoad: estimated.productionLoad,
    config: input.config,
    fieldPathPrefix: 'segments',
    budget: input.deliveryVersion === 6
      ? getPromptWizardV6ExecutionBudget(input.config)
      : undefined,
  }).map(issue => ({
    ...issue,
    message: issue.code === 'TOO_MANY_ACTIONS'
      ? `${issue.message}（识别到：${estimated.evidence.actionFamilies.join('、')}）`
      : issue.message,
    fieldPath: issue.code === 'MAGIC_TRANSITION_FORBIDDEN'
      ? estimated.evidence.magicFieldPaths[0] ?? 'segments'
      : 'segments',
  }));
}

export function assertPromptWizardShotExecutionBudget(
  input: Parameters<typeof validatePromptWizardShotExecutionBudget>[0],
) {
  const issues = validatePromptWizardShotExecutionBudget(input);
  if (issues.length > 0) throw new PromptWizardExecutionBudgetError(issues);
}

function normalizeLocation(value: string) {
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  const known = LOCATION_FAMILIES.find(([pattern]) => pattern.test(normalized));
  if (known) return known[1];
  return normalized
    .replace(/^(?:地点与环境|地点|场景)\s*[：:]\s*/u, '')
    .split(/[，,；;。]|的(?:开场动作|证据展示|自证化解|结果呈现|自然收束)位置/u)[0]!
    .trim();
}

function estimatePeopleInShot(value: string) {
  const normalized = value.normalize('NFKC');
  const explicit = normalized.match(/(?:^|[^一-龥\d])([2-9]|两|二|三|四|五|六|七|八|九)\s*(?:人|位|名)/u);
  if (explicit) return chineseCount(explicit[1]!);
  if (/(?:两人|二人|双人|一对|男女二人|男女两人)/u.test(normalized)) return 2;
  const relationshipCount = normalized.match(/(?:主角|模特|用户|顾客|男(?:子|士|生)|女(?:子|士|生|孩)|人物|穿着者|体验者)(?:与|和|及)(?:朋友|同事|伴侣|家人|店员|顾客|另一人)/u)
    ? 2
    : 0;
  if (relationshipCount) return relationshipCount;
  if (/(?:主角|模特|用户|顾客|男(?:子|士|生)|女(?:子|士|生|孩)|人物|穿着者|体验者|朋友|同事|店员|面部|肩背|身体)/u.test(normalized)) return 1;
  // 单纯手部/第一人称操作不占“完整人物”预算。
  return 0;
}

function chineseCount(value: string) {
  const map: Record<string, number> = { 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  return Number(value) || map[value] || 1;
}

function collectFamilies(
  values: readonly string[],
  families: ReadonlyArray<readonly [RegExp, string]>,
) {
  const result = new Set<string>();
  for (const value of values) {
    const normalized = families === ACTION_FAMILIES
      ? normalizeExecutableActionText(value)
      : value.normalize('NFKC');
    families.forEach(([pattern, label]) => {
      if (pattern.test(normalized)) result.add(label);
    });
  }
  return [...result];
}

/**
 * 动作预算只统计真正要求视频模型执行的动作。证据原文经常以引号出现，
 * 其中“可折叠”“连接”等是产品事实而非新增动作；叙事中的“连接到结果”
 * 也不是物理连接。先移除这些说明性片段，避免 Mini 被虚假超预算拒绝。
 */
function normalizeExecutableActionText(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[“”][^“”]{1,500}[“”]/gu, ' ')
    .replace(/[「」][^「」]{1,500}[「」]/gu, ' ')
    .replace(/(?:可|可以|能够|支持)[^，。；;]{0,12}折叠/gu, '结构')
    .replace(/连接到(?:动作|结果|画面|状态|证据|自证)/gu, '关联到');
}

function collectCameraMoves(values: readonly string[]) {
  const result = collectFamilies(values, CAMERA_MOVE_FAMILIES);
  if (result.length > 0) return result;
  const hasNonStaticInstruction = values.some(value => (
    value.trim() && !/(?:固定机位|固定镜头|静止|无运镜|保持不动)/u.test(value)
  ));
  return hasNonStaticInstruction ? ['未归类运镜'] : [];
}

function uniqueMeaningful(values: readonly string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

const BASE_BUDGETS: Record<
  PromptWizardVideoConfig['durationSeconds'],
  PromptWizardExecutionBudget
> = {
  5: {
    maxLocationCount: 1,
    maxPersonCount: 1,
    maxMajorActionCount: 2,
    maxPropCount: 1,
    maxCameraMoveCount: 2,
    allowMagicTransition: false,
  },
  10: {
    maxLocationCount: 2,
    maxPersonCount: 1,
    maxMajorActionCount: 3,
    maxPropCount: 2,
    maxCameraMoveCount: 3,
    allowMagicTransition: false,
  },
  15: {
    maxLocationCount: 2,
    maxPersonCount: 2,
    maxMajorActionCount: 4,
    maxPropCount: 3,
    maxCameraMoveCount: 4,
    allowMagicTransition: false,
  },
};

const MINI_BUDGETS: Record<
  PromptWizardVideoConfig['durationSeconds'],
  PromptWizardExecutionBudget
> = {
  5: {
    maxLocationCount: 1,
    maxPersonCount: 1,
    maxMajorActionCount: 1,
    maxPropCount: 1,
    maxCameraMoveCount: 1,
    allowMagicTransition: false,
  },
  10: {
    maxLocationCount: 1,
    maxPersonCount: 1,
    maxMajorActionCount: 2,
    maxPropCount: 1,
    maxCameraMoveCount: 2,
    allowMagicTransition: false,
  },
  15: {
    maxLocationCount: 1,
    maxPersonCount: 1,
    maxMajorActionCount: 3,
    maxPropCount: 2,
    maxCameraMoveCount: 3,
    allowMagicTransition: false,
  },
};

export function getPromptWizardExecutionBudget(
  config: Pick<PromptWizardVideoConfig, 'model' | 'durationSeconds'>,
): PromptWizardExecutionBudget {
  const source = config.model === 'seedance-2.0-mini'
    ? MINI_BUDGETS[config.durationSeconds]
    : BASE_BUDGETS[config.durationSeconds];
  if (config.model !== 'seedance-2.0-fast' || config.durationSeconds !== 15) return { ...source };
  return { ...source, maxPersonCount: 1 };
}

/**
 * V6 的 5 秒模式只有两个镜头，并且要求第二镜延续第一镜的同一个商品动作。
 * 这里单独收紧动作预算，避免改变仍需只读恢复的 V4/V5 历史任务。
 */
export function getPromptWizardV6ExecutionBudget(
  config: Pick<PromptWizardVideoConfig, 'model' | 'durationSeconds'>,
): PromptWizardExecutionBudget {
  const budget = getPromptWizardExecutionBudget(config);
  return config.durationSeconds === 5
    ? { ...budget, maxMajorActionCount: 1 }
    : budget;
}

export function validatePromptWizardExecutionBudget(input: {
  productionLoad: PromptWizardProductionLoad;
  config: Pick<PromptWizardVideoConfig, 'model' | 'durationSeconds'>;
  fieldPathPrefix?: string;
  budget?: PromptWizardExecutionBudget;
}): PromptWizardExecutionBudgetIssue[] {
  const budget = input.budget ?? getPromptWizardExecutionBudget(input.config);
  const prefix = input.fieldPathPrefix ? `${input.fieldPathPrefix}.` : '';
  const issues: PromptWizardExecutionBudgetIssue[] = [];
  checkCount('locationCount', 'TOO_MANY_LOCATIONS', '地点', input.productionLoad.locationCount, budget.maxLocationCount);
  checkCount('personCount', 'TOO_MANY_PEOPLE', '人物', input.productionLoad.personCount, budget.maxPersonCount);
  checkCount('majorActionCount', 'TOO_MANY_ACTIONS', '主要动作', input.productionLoad.majorActionCount, budget.maxMajorActionCount);
  checkCount('propCount', 'TOO_MANY_PROPS', '道具', input.productionLoad.propCount, budget.maxPropCount);
  checkCount('cameraMoveCount', 'TOO_MANY_CAMERA_MOVES', '运镜', input.productionLoad.cameraMoveCount, budget.maxCameraMoveCount);
  if (input.productionLoad.hasMagicTransition) {
    issues.push({
      code: 'MAGIC_TRANSITION_FORBIDDEN',
      fieldPath: `${prefix}productionLoad.hasMagicTransition`,
      actual: true,
      limit: false,
      message: '不得使用凭空出现、魔法换装或无因状态变化。',
    });
  }
  return issues;

  function checkCount(
    field: Exclude<keyof PromptWizardProductionLoad, 'hasMagicTransition'>,
    code: PromptWizardExecutionBudgetIssueCode,
    label: string,
    actual: number,
    limit: number,
  ) {
    if (Number.isSafeInteger(actual) && actual >= 0 && actual <= limit) return;
    issues.push({
      code,
      fieldPath: `${prefix}productionLoad.${field}`,
      actual,
      limit,
      message: `${label}数量为 ${actual}，当前模型与时长最多支持 ${limit}。`,
    });
  }
}

export function assertPromptWizardExecutionBudget(
  input: Parameters<typeof validatePromptWizardExecutionBudget>[0],
) {
  const issues = validatePromptWizardExecutionBudget(input);
  if (issues.length > 0) throw new PromptWizardExecutionBudgetError(issues);
}

export type PromptWizardVoiceoverUnit = 'words' | 'characters';

export interface PromptWizardVoiceoverDurationResult {
  valid: boolean;
  unit: PromptWizardVoiceoverUnit;
  actualUnits: number;
  maxUnits: number;
  estimatedSeconds: number;
  fieldPath: string;
}

export interface PromptWizardVoiceoverBudget {
  unit: PromptWizardVoiceoverUnit;
  minUnits: number;
  targetUnits: number;
  maxUnits: number;
}

/**
 * 旧 V4/V5 恢复链路仍依赖按语言估算的快速口播上限。V6 不再读取这里的
 * 语言表或数值容量，只把权威分镜时间交给 Provider 自行判断。
 */
interface PromptWizardLegacyFastVoiceoverBudget {
  unit: PromptWizardVoiceoverUnit;
  maxUnits: number;
}

const LEGACY_WORDS_PER_SECOND: Record<string, number> = {
  英语: 2.35,
  西班牙语: 2.6,
  葡萄牙语: 2.45,
  法语: 2.4,
  印尼语: 2.65,
  意大利语: 2.45,
  马来语: 2.65,
  越南语: 2.75,
  德语: 2.15,
  荷兰语: 2.25,
  波兰语: 2.15,
};

const LEGACY_CHARACTERS_PER_SECOND: Record<string, number> = {
  普通话: 4.2,
  日语: 4.5,
  泰语: 5,
};

const PROMPT_WIZARD_LEGACY_FAST_SPEECH_RATE_MULTIPLIER = 1.2;

/**
 * 画面剪辑点不应强制切断连续口播。10 秒成交脚本的前三个内容段
 * 允许口播自然跨过相邻画面剪辑点，每段最多使用 4 秒口播窗口；末段 CTA
 * 仍必须在自己的 2 秒内说完。全片生成目标保持约 82% 正常语速，硬上限
 * 使用已配置语言的正常语速容量，因此这不会允许口播重叠或真正说不完的文本。
 */
export function getPromptWizardVoiceoverWindowDuration(input: {
  segmentIndex: number;
  startSeconds: number;
  endSeconds: number;
  totalDurationSeconds: 5 | 10 | 15;
}) {
  if (
    input.totalDurationSeconds === 10
    && input.segmentIndex >= 0
    && input.segmentIndex < 3
  ) {
    return 4;
  }
  return input.endSeconds - input.startSeconds;
}

export function getPromptWizardVoiceoverBudget(input: {
  targetLanguage: string;
  durationSeconds: number;
  totalDurationSeconds: 5 | 10 | 15;
}): PromptWizardVoiceoverBudget {
  const characterRate = LEGACY_CHARACTERS_PER_SECOND[input.targetLanguage];
  const rate = characterRate ?? LEGACY_WORDS_PER_SECOND[input.targetLanguage] ?? 2.3;
  const minimumRatio = input.totalDurationSeconds === 5 ? 0.6 : 0.72;
  const rawCapacity = input.durationSeconds * rate;
  return {
    unit: characterRate ? 'characters' : 'words',
    // 分镜级最小值只用于生成目标；整条视频的最低覆盖率由成交质量门禁统一判断。
    minUnits: Math.max(1, Math.floor(rawCapacity * minimumRatio)),
    targetUnits: Math.max(1, Math.floor(rawCapacity * 0.82)),
    // 口播可以跨剪辑连续，逐镜头只限制正常语速容量；全片另以相同正常语速兜底。
    maxUnits: Math.max(1, Math.round(rawCapacity)),
  };
}

export function getPromptWizardTotalVoiceoverBudget(input: {
  targetLanguage: string;
  durationSeconds: 5 | 10 | 15;
}): PromptWizardVoiceoverBudget {
  const characterRate = LEGACY_CHARACTERS_PER_SECOND[input.targetLanguage];
  const rate = characterRate ?? LEGACY_WORDS_PER_SECOND[input.targetLanguage] ?? 2.3;
  const minimumRatio = input.durationSeconds === 5 ? 0.6 : 0.72;
  const rawCapacity = input.durationSeconds * rate;
  return {
    unit: characterRate ? 'characters' : 'words',
    minUnits: Math.max(1, Math.ceil(rawCapacity * minimumRatio)),
    targetUnits: Math.max(1, Math.round(rawCapacity * 0.82)),
    // 生成目标仍保持 82% 的自然余量；硬上限只拒绝超过正常语速、真正说不完的口播。
    maxUnits: Math.max(1, Math.round(rawCapacity)),
  };
}

function getPromptWizardLegacyFastVoiceoverBudget(input: {
  targetLanguage: string;
  durationSeconds: number;
}): PromptWizardLegacyFastVoiceoverBudget {
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
    throw new Error('旧版快速口播预算要求镜头时长为正数');
  }
  const characterRate = LEGACY_CHARACTERS_PER_SECOND[input.targetLanguage];
  const rate = characterRate ?? LEGACY_WORDS_PER_SECOND[input.targetLanguage] ?? 2.3;
  return {
    unit: characterRate ? 'characters' : 'words',
    maxUnits: Math.max(
      1,
      Math.floor(
        input.durationSeconds
        * rate
        * PROMPT_WIZARD_LEGACY_FAST_SPEECH_RATE_MULTIPLIER,
      ),
    ),
  };
}

/**
 * 从整条视频的权威口播预算向各画面段分配字/词数。
 *
 * 分段口播允许跨过画面剪辑点，因此不能再按每个“口播窗口”独立计算
 * 最低与目标容量，否则各段相加可能超过全片硬上限。这里以画面段时长作为
 * 叙事权重，并按“最接近比例目标”的方式逐级分配 min / target / max，保证：
 *
 * - 每段至少有 1 个口播单位；
 * - 每段满足 min <= target <= max；
 * - 所有分段之和严格等于全片 min / target / max。
 */
export function getPromptWizardSegmentVoiceoverBudgets(input: {
  targetLanguage: string;
  durationSeconds: 5 | 10 | 15;
  segmentDurations: number[];
}): PromptWizardVoiceoverBudget[] {
  if (input.segmentDurations.length === 0) return [];
  if (input.segmentDurations.some(duration => !Number.isFinite(duration) || duration <= 0)) {
    throw new Error('分段口播预算要求所有画面段时长均为正数');
  }

  const totalBudget = getPromptWizardTotalVoiceoverBudget({
    targetLanguage: input.targetLanguage,
    durationSeconds: input.durationSeconds,
  });
  if (totalBudget.minUnits < input.segmentDurations.length) {
    throw new Error('全片最低口播预算不足以保证每个画面段均有口播');
  }

  const totalWeight = input.segmentDurations.reduce((sum, duration) => sum + duration, 0);
  const allocateToTotal = (base: number[], totalUnits: number) => {
    const allocated = [...base];
    let remaining = totalUnits - allocated.reduce((sum, value) => sum + value, 0);
    while (remaining > 0) {
      let selectedIndex = 0;
      let largestDeficit = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < allocated.length; index += 1) {
        const proportionalTarget = totalUnits * (input.segmentDurations[index]! / totalWeight);
        const deficit = proportionalTarget - allocated[index]!;
        if (deficit > largestDeficit) {
          largestDeficit = deficit;
          selectedIndex = index;
        }
      }
      allocated[selectedIndex] = allocated[selectedIndex]! + 1;
      remaining -= 1;
    }
    return allocated;
  };

  const minimums = allocateToTotal(
    input.segmentDurations.map(() => 1),
    totalBudget.minUnits,
  );
  const targets = allocateToTotal(minimums, totalBudget.targetUnits);
  const maximums = allocateToTotal(targets, totalBudget.maxUnits);

  return input.segmentDurations.map((_, index) => ({
    unit: totalBudget.unit,
    minUnits: minimums[index]!,
    targetUnits: targets[index]!,
    maxUnits: maximums[index]!,
  }));
}

export function validatePromptWizardVoiceoverDuration(input: {
  voiceover: string;
  targetLanguage: string;
  durationSeconds: number;
  fieldPath?: string;
}): PromptWizardVoiceoverDurationResult {
  const text = input.voiceover.normalize('NFKC').trim();
  const fieldPath = input.fieldPath ?? 'voiceover';
  const budget = getPromptWizardLegacyFastVoiceoverBudget({
    targetLanguage: input.targetLanguage,
    durationSeconds: input.durationSeconds,
  });
  const characterRate = LEGACY_CHARACTERS_PER_SECOND[input.targetLanguage];
  if (budget.unit === 'characters') {
    const actualUnits = countSpeechCharacters(text);
    return {
      valid: actualUnits <= budget.maxUnits,
      unit: 'characters',
      actualUnits,
      maxUnits: budget.maxUnits,
      estimatedSeconds: round(
        actualUnits
        / ((characterRate ?? 1) * PROMPT_WIZARD_LEGACY_FAST_SPEECH_RATE_MULTIPLIER),
      ),
      fieldPath,
    };
  }
  const rate = LEGACY_WORDS_PER_SECOND[input.targetLanguage] ?? 2.3;
  const actualUnits = countWords(text);
  return {
    valid: actualUnits <= budget.maxUnits,
    unit: 'words',
    actualUnits,
    maxUnits: budget.maxUnits,
    estimatedSeconds: round(
      actualUnits / (rate * PROMPT_WIZARD_LEGACY_FAST_SPEECH_RATE_MULTIPLIER),
    ),
    fieldPath,
  };
}

export function assertPromptWizardVoiceoverDuration(
  input: Parameters<typeof validatePromptWizardVoiceoverDuration>[0],
) {
  const result = validatePromptWizardVoiceoverDuration(input);
  if (result.valid) return result;
  const unitLabel = result.unit === 'words' ? '词' : '字';
  const error = new Error(
    `口播无法在当前镜头时长内自然说完：${result.actualUnits}${unitLabel}，上限 ${result.maxUnits}${unitLabel}`,
  ) as Error & { code: string; fieldPaths: string[]; details: PromptWizardVoiceoverDurationResult };
  error.name = 'PromptWizardVoiceoverDurationError';
  error.code = 'PROMPT_WIZARD_VOICEOVER_TOO_LONG';
  error.fieldPaths = [result.fieldPath];
  error.details = result;
  throw error;
}

export function countPromptWizardVoiceoverUnits(text: string, unit: PromptWizardVoiceoverUnit) {
  return unit === 'characters' ? countSpeechCharacters(text) : countWords(text);
}

function countWords(text: string) {
  if (!text) return 0;
  return text.split(/\s+/u).filter(token => /[\p{L}\p{N}]/u.test(token)).length;
}

function countSpeechCharacters(text: string) {
  // JSON Schema 的 minLength/maxLength 与 Provider Wire V2 本地解码都按
  // Unicode 码点计数。泰语、日语等合法书写中的组合标记
  // 属于\p{M}，必须同样计入字符容量，否则覆盖率会低估并
  // 在定长 Schema 之后误触发内容修复。
  return [...text].filter(character => /[\p{L}\p{M}\p{N}]/u.test(character)).length;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
