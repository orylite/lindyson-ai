import type {
  PromptWizardProductProfile,
  PromptWizardVideoConfig,
} from '@lindyson/api-contracts';
import {
  countPromptWizardVoiceoverUnits,
  getPromptWizardSegmentVoiceoverBudgets,
  getPromptWizardTotalVoiceoverBudget,
} from './promptWizardExecutionBudget.js';

export interface PromptWizardConversionShot {
  role: string;
  location: string;
  subject: string;
  shotSize: string;
  action: string;
  cameraMovement: string;
  lightingAndRealism: string;
  voiceover: string;
  voiceoverZh: string;
  foley: string;
  editingCue: string;
}

export interface PromptWizardTimedConversionShot extends PromptWizardConversionShot {
  startSeconds: number;
  endSeconds: number;
}

const STATIC_INSTRUCTION_PATTERN = /(?:静止|固定机位|固定镜头|定格|长时间停留|保持不动|连续少切|static shot|locked[- ]?off|freeze frame|hold still|long hold)/iu;
const PRODUCT_ACTION_PATTERN = /(?:拿起|取出|放下|放入|打开|关闭|按压|点击|旋转|拧动|折叠|展开|穿上|套上|佩戴|倒入|倾倒|喷洒|涂抹|擦拭|连接|插入|启动|点亮|翻转|转身|挤出|移动|推动|拉动|滑动|展示|揭开|抬起|举起|摇晃|轻敲|触碰|贴合|组合)/u;
const PERSON_MOTION_PATTERN = /(?:转身|走近|走向|走出|跑动|迈步|点头|挥手|抬起|伸手|指向|握住|拿起|举起|穿上|戴上|倒入|推动|拉动|移动|操作|触碰|调整|放回|合上|拉好)/u;
const CAMERA_MOTION_PATTERN = /(?:推近|推进|拉远|抽离|摇镜|摇移|平移|侧移|横移|滑轨|跟拍|跟随|追踪|环绕|绕拍|升起|下降|升降|变焦|拉焦|焦点切换|手持|运动镜头)/u;
const EDIT_MOTION_PATTERN = /(?:动作点|切入|切换|切至|跳切|快切|转场|匹配剪辑|遮挡剪辑|节奏剪辑|加速|减速|速度变化|蒙太奇)/u;
const ENVIRONMENT_MOTION_PATTERN = /(?:风吹|飘动|水流|液体流动|气泡|泡沫上升|蒸汽|烟雾|光影移动|反光移动|滚动|旋转|飞溅|滴落)/u;
const DIRECT_CTA_PATTERN = /(?:点击.{0,8}(?:商品卡|购物车|商品)|打开.{0,8}(?:商品卡|购物车|商品)|查看商品|去商品卡|立即下单|马上下单|现在下单|直接下单|加入购物车|立即购买|马上购买|现在购买|立即入手|马上入手|现在入手|去购买|去下单|选购)/u;
const PROMPT_WIZARD_PRODUCT_ANCHOR_UNSAFE_LANGUAGE_PATTERN = /(?:点击|点开|购买|下单|入手|选购|加购|查看商品|商品卡|购物车|售价|价格|特价|优惠|折扣|立减|满减|领券|券后|限时价|到手价|免费|包邮|免邮|赠品|秒杀|库存|功效|治疗|治愈|主动降噪|降噪效果|防水|防尘|抗菌|抑菌|杀菌|除菌|续航|快充)/u;

function promptWizardContainsDirectCta(value: string) {
  return DIRECT_CTA_PATTERN.test(value.normalize('NFKC'));
}

function promptWizardContainsUnsafeProductAnchorLanguage(value: string) {
  return PROMPT_WIZARD_PRODUCT_ANCHOR_UNSAFE_LANGUAGE_PATTERN.test(
    value.normalize('NFKC'),
  );
}

export class PromptWizardMotionDensityError extends Error {
  readonly code = 'PROMPT_WIZARD_MOTION_DENSITY_INVALID';
  readonly fieldPaths: string[];

  constructor(fieldPaths: string[], message: string) {
    super(message);
    this.name = 'PromptWizardMotionDensityError';
    this.fieldPaths = [...new Set(fieldPaths)].slice(0, 24);
  }
}

export class PromptWizardVoiceoverCoverageError extends Error {
  readonly code = 'PROMPT_WIZARD_VOICEOVER_COVERAGE_INVALID';
  readonly fieldPaths: string[];
  readonly details: {
    namesProduct: boolean;
    emptySegmentIndexes: number[];
    invalidSegmentIndexes: number[];
  } | {
    actualUnits: number;
    minUnits: number;
    maxUnits: number;
    unit: 'words' | 'characters';
    segmentActualUnits: number[];
    segmentMinUnits: number[];
    segmentTargetUnits: number[];
    segmentMaxUnits: number[];
    namesProduct: boolean;
    emptySegmentIndexes: number[];
    invalidSegmentIndexes: number[];
  };

  constructor(
    fieldPaths: string[],
    details: PromptWizardVoiceoverCoverageError['details'],
    message: string,
  ) {
    super(message);
    this.name = 'PromptWizardVoiceoverCoverageError';
    this.fieldPaths = [...new Set(fieldPaths)].slice(0, 24);
    this.details = details;
  }
}

export class PromptWizardConversionCtaError extends Error {
  readonly code = 'PROMPT_WIZARD_CONVERSION_CTA_INVALID';
  readonly fieldPaths: string[];

  constructor(fieldPaths: string[], message: string) {
    super(message);
    this.name = 'PromptWizardConversionCtaError';
    this.fieldPaths = [...new Set(fieldPaths)].slice(0, 24);
  }
}

export class PromptWizardSoundDesignVisualClosureError extends Error {
  readonly code = 'PROMPT_WIZARD_SOUND_DESIGN_VISUAL_CLOSURE_INVALID';
  readonly fieldPaths: string[];

  constructor(fieldPaths: string[], message: string) {
    super(message);
    this.name = 'PromptWizardSoundDesignVisualClosureError';
    this.fieldPaths = [...new Set(fieldPaths)].slice(0, 24);
  }
}

export function assertPromptWizardMotionDensity(input: {
  shots: readonly PromptWizardConversionShot[];
  durationSeconds: PromptWizardVideoConfig['durationSeconds'];
}) {
  const invalidPaths: string[] = [];
  const allSources = new Set<string>();
  const signatures: Array<{ shotSize: string; camera: string; action: string }> = [];

  input.shots.forEach((shot, index) => {
    const dynamicFields = [
      shot.subject,
      shot.shotSize,
      shot.action,
      shot.cameraMovement,
      shot.lightingAndRealism,
      shot.foley,
      shot.editingCue,
    ];
    dynamicFields.forEach((value, fieldIndex) => {
      if (STATIC_INSTRUCTION_PATTERN.test(value.normalize('NFKC'))) {
        invalidPaths.push(`segments[${index}].${[
          'subject',
          'shotSize',
          'action',
          'cameraMovement',
          'lightingAndRealism',
          'foley',
          'editingCue',
        ][fieldIndex]}`);
      }
    });
    const sources = promptWizardMotionSources(shot);
    sources.forEach(source => allSources.add(source));
    if (sources.size === 0) {
      invalidPaths.push(
        `segments[${index}].action`,
        `segments[${index}].cameraMovement`,
        `segments[${index}].editingCue`,
      );
    }
    signatures.push({
      shotSize: normalizeSignature(shot.shotSize),
      camera: normalizeCameraSignature(shot.cameraMovement),
      action: normalizeSignature(shot.action),
    });
  });

  for (let index = 1; index < signatures.length; index += 1) {
    const previous = signatures[index - 1]!;
    const current = signatures[index]!;
    if (
      previous.shotSize === current.shotSize
      && previous.camera === current.camera
      && previous.action === current.action
    ) {
      invalidPaths.push(
        `segments[${index - 1}].shotSize`,
        `segments[${index}].shotSize`,
        `segments[${index}].cameraMovement`,
        `segments[${index}].action`,
      );
    }
  }

  const minimumSourceCount = input.durationSeconds === 5 ? 2 : 3;
  if (allSources.size < minimumSourceCount) invalidPaths.push('segments');
  if (invalidPaths.length > 0) {
    throw new PromptWizardMotionDensityError(
      invalidPaths,
      `画面动态密度不足：每个镜头都必须持续运动，整条视频至少包含 ${minimumSourceCount} 类动态来源。`,
    );
  }
}

export function assertPromptWizardVoiceoverCoverage(input: {
  shots: readonly PromptWizardTimedConversionShot[];
  targetLanguage: string;
  durationSeconds: PromptWizardVideoConfig['durationSeconds'];
  profile: PromptWizardProductProfile;
  /**
   * V6 只校验非空和产品首提，不读取语言语速表、不计算字词数量，也不
   * 估算能否在分镜内讲完；时长适配由 Provider 根据权威时间轴自行判断。
   * 旧版默认仍校验历史全片 min/max，保证 V4/V5 只读恢复行为不变。
   */
  v6SemanticOnly?: boolean;
}) {
  const emptyPaths: string[] = [];
  const emptySegmentIndexes: number[] = [];
  input.shots.forEach((shot, index) => {
    if (!shot.voiceover.normalize('NFKC').trim()) {
      emptyPaths.push(`segments[${index}].voiceover`);
      emptySegmentIndexes.push(index);
    }
  });

  const firstThreeSeconds = input.shots.filter(shot => shot.startSeconds < 3);
  const productTranscript = firstThreeSeconds.map(shot => (
    input.targetLanguage === '普通话' ? shot.voiceover : shot.voiceoverZh
  )).join(' ');
  const namesProduct = promptWizardTranscriptNamesProduct(productTranscript, input.profile);
  if (!namesProduct) {
    firstThreeSeconds.forEach((_, index) => {
      emptyPaths.push(`segments[${index}].voiceover`);
      if (input.targetLanguage !== '普通话') {
        emptyPaths.push(`segments[${index}].voiceoverZh`);
      }
    });
  }

  if (input.v6SemanticOnly) {
    if (emptyPaths.length > 0 || !namesProduct) {
      throw new PromptWizardVoiceoverCoverageError(
        emptyPaths,
        {
          namesProduct,
          emptySegmentIndexes,
          invalidSegmentIndexes: [],
        },
        !namesProduct
          ? '前三秒口播必须明确说明当前产品名称或品类。'
          : '每个镜头都必须提供一条完整、非空的自然口播句。',
      );
    }
    return;
  }

  let actualUnits = 0;
  const totalBudget = getPromptWizardTotalVoiceoverBudget({
    targetLanguage: input.targetLanguage,
    durationSeconds: input.durationSeconds,
  });
  const segmentActualUnits = input.shots.map(shot => {
    const voiceover = shot.voiceover.normalize('NFKC').trim();
    const units = countPromptWizardVoiceoverUnits(voiceover, totalBudget.unit);
    actualUnits += units;
    return units;
  });
  const segmentDurations = input.shots.map(shot => shot.endSeconds - shot.startSeconds);
  const legacySegmentBudgets = getPromptWizardSegmentVoiceoverBudgets({
    targetLanguage: input.targetLanguage,
    durationSeconds: input.durationSeconds,
    segmentDurations,
  });
  if (
    emptyPaths.length > 0
    || !namesProduct
    || actualUnits < totalBudget.minUnits
    || actualUnits > totalBudget.maxUnits
  ) {
    const fieldPaths = [...emptyPaths];
    if (actualUnits < totalBudget.minUnits || actualUnits > totalBudget.maxUnits) {
      input.shots.forEach((_, index) => {
        fieldPaths.push(`segments[${index}].voiceover`);
        if (input.targetLanguage !== '普通话') {
          fieldPaths.push(`segments[${index}].voiceoverZh`);
        }
      });
    }
    throw new PromptWizardVoiceoverCoverageError(
      fieldPaths,
      {
        actualUnits,
        minUnits: totalBudget.minUnits,
        maxUnits: totalBudget.maxUnits,
        unit: totalBudget.unit,
        segmentActualUnits,
        segmentMinUnits: legacySegmentBudgets.map(item => item.minUnits),
        segmentTargetUnits: legacySegmentBudgets.map(item => item.targetUnits),
        segmentMaxUnits: legacySegmentBudgets.map(item => item.maxUnits),
        namesProduct,
        emptySegmentIndexes,
        invalidSegmentIndexes: [],
      },
      !namesProduct
        ? '前三秒口播必须明确说明当前产品名称或品类。'
        : `口播信息量不符合成交脚本要求：当前 ${actualUnits}，安全范围 ${totalBudget.minUnits}–${totalBudget.maxUnits}。`,
    );
  }
}

export function assertPromptWizardConversionCta(input: {
  shots: readonly PromptWizardConversionShot[];
  targetLanguage: string;
}) {
  const lastIndex = input.shots.length - 1;
  const last = input.shots[lastIndex];
  if (!last) throw new PromptWizardConversionCtaError(['segments'], '成交脚本缺少末段 CTA。');
  const ctaText = input.targetLanguage === '普通话' ? last.voiceover : last.voiceoverZh;
  if (!promptWizardContainsDirectCta(ctaText)) {
    throw new PromptWizardConversionCtaError(
      [`segments[${lastIndex}].voiceover`, ...(input.targetLanguage === '普通话' ? [] : [`segments[${lastIndex}].voiceoverZh`])],
      '末段必须明确引导用户点击商品卡、查看商品或立即下单。',
    );
  }
}

/**
 * 5 秒 V6 不再用口播 CTA 收束，成交落点由最后一个画面完成。两个镜头必须
 * 延续同一个商品动作；末镜让商品保持清晰可见，并以持续运镜而非静态尾卡
 * 收尾。任何生成字幕、价格、按钮或平台 UI 的指令都会让视频模型凭空造字，
 * 因此在进入执行提示词前直接拒绝。
 */
export function assertPromptWizardSoundDesignOnlyVisualClosure(input: {
  shots: readonly PromptWizardConversionShot[];
}) {
  const invalidPaths: string[] = [];
  if (input.shots.length !== 2) invalidPaths.push('segments');

  input.shots.forEach((shot, index) => {
    if (shot.voiceover.trim()) invalidPaths.push(`segments[${index}].voiceover`);
    if (shot.voiceoverZh.trim()) invalidPaths.push(`segments[${index}].voiceoverZh`);
    const executionPromptFields = [
      ['location', shot.location],
      ['subject', shot.subject],
      ['shotSize', shot.shotSize],
      ['action', shot.action],
      ['cameraMovement', shot.cameraMovement],
      ['lightingAndRealism', shot.lightingAndRealism],
      ['foley', shot.foley],
      ['editingCue', shot.editingCue],
    ] as const;
    executionPromptFields.forEach(([fieldName, value]) => {
      if (promptWizardContainsGeneratedTextOrUiInstruction(value)) {
        invalidPaths.push(`segments[${index}].${fieldName}`);
      }
    });
    if (promptWizardContainsSpokenAudioInstruction(shot.foley)) {
      invalidPaths.push(`segments[${index}].foley`);
    }
  });

  const first = input.shots[0];
  const last = input.shots[1];
  if (first && last) {
    const lastVisual = `${last.subject} ${last.action} ${last.cameraMovement}`.normalize('NFKC');
    if (!PROMPT_WIZARD_PRODUCT_VISIBLE_PATTERN.test(lastVisual)) {
      invalidPaths.push(`segments[1].subject`, `segments[1].action`);
    }
    if (normalizeSignature(first.action) !== normalizeSignature(last.action)) {
      invalidPaths.push(`segments[0].action`, `segments[1].action`);
    }
    const camera = last.cameraMovement.normalize('NFKC');
    if (
      !CAMERA_MOTION_PATTERN.test(camera)
      || !PROMPT_WIZARD_SUSTAINED_CAMERA_PATTERN.test(camera)
      || STATIC_INSTRUCTION_PATTERN.test(camera)
    ) {
      invalidPaths.push(`segments[1].cameraMovement`);
    }
  }

  if (invalidPaths.length > 0) {
    throw new PromptWizardSoundDesignVisualClosureError(
      invalidPaths,
      '5 秒纯视觉方案必须无口播、无 Foley 人声/对白/旁白、无生成文字或平台 UI；末镜需让商品清晰可见，延续唯一商品动作并以持续运镜收尾。',
    );
  }
}

const PROMPT_WIZARD_PRODUCT_VISIBLE_PATTERN = /(?:@图片\d+|商品|产品).{0,24}(?:清晰|完整|可见|主体|近景|特写|占据)|(?:清晰|完整|可见|主体|近景|特写|占据).{0,24}(?:@图片\d+|商品|产品)/u;
const PROMPT_WIZARD_SUSTAINED_CAMERA_PATTERN = /(?:持续|连续|一路|不间断|一镜到底|始终|全程)/u;
const PROMPT_WIZARD_GENERATED_TEXT_OR_UI_PATTERN = /(?:(?:添加|加入|叠加|生成|显示|出现|弹出|呈现|展示|浮现|打出|写出|放置|插入|覆盖|呼出|唤起).{0,16}(?:字幕|花字|可读文字|屏幕文字|屏幕文案|水印文案|价格(?:文字|标签|信息)?|售价|现价|原价|到手价|价签|优惠(?:文字|标签|码)?|折扣(?:文字|标签|码)?|按钮|商品卡|购物车|TikTok\s*(?:UI|界面|浮层)|抖音\s*(?:UI|界面|浮层)|小红书\s*(?:UI|界面|浮层)|平台\s*(?:UI|界面|浮层))|(?:字幕|花字|可读文字|屏幕文字|屏幕文案|水印文案|价格(?:文字|标签|信息)?|售价|现价|原价|到手价|价签|优惠(?:文字|标签|码)?|折扣(?:文字|标签|码)?|按钮|商品卡|购物车).{0,16}(?:显示|出现|弹出|呈现|浮现|打出|写出|滑入|跳出|覆盖|呼出|唤起)|(?:TikTok|抖音|小红书|平台)\s*(?:UI|界面|浮层))/iu;
const PROMPT_WIZARD_NEGATED_GENERATED_TEXT_OR_UI_PATTERN = /(?:无|不(?:要|得|应|可|需|会)?|禁止|避免)(?:新增|添加|加入|叠加|生成|显示|出现|弹出|呈现|展示|浮现|打出|写出|放置|插入|覆盖|呼出|唤起)?[^，。；;\n]{0,8}(?:字幕|花字|可读文字|屏幕文字|屏幕文案|水印文案|价格(?:文字|标签|信息)?|售价|现价|原价|到手价|价签|优惠(?:文字|标签|码)?|折扣(?:文字|标签|码)?|按钮|商品卡|购物车|TikTok\s*(?:UI|界面|浮层)|抖音\s*(?:UI|界面|浮层)|小红书\s*(?:UI|界面|浮层)|平台\s*(?:UI|界面|浮层))/giu;
const PROMPT_WIZARD_SPOKEN_AUDIO_PATTERN = /(?:人声|对白|对话|旁白|口播|解说|配音|念白|台词|说话声|讲话声|语音|voice\s*-?\s*over|voiceover|narration|dialogue|dialog|spoken\s+words?|speech|vocals?)/iu;
const PROMPT_WIZARD_NEGATED_SPOKEN_AUDIO_PATTERN = /(?:无|不(?:要|得|应|可|需|会)?|不使用|不包含|不含|禁止|避免|去除)(?:任何|任何形式的)?\s*(?:人声|对白|对话|旁白|口播|解说|配音|念白|台词|说话声|讲话声|语音|voice\s*-?\s*over|voiceover|narration|dialogue|dialog|spoken\s+words?|speech|vocals?)/giu;

function promptWizardContainsGeneratedTextOrUiInstruction(value: string) {
  const positiveInstructions = value
    .normalize('NFKC')
    .replace(PROMPT_WIZARD_NEGATED_GENERATED_TEXT_OR_UI_PATTERN, '');
  return PROMPT_WIZARD_GENERATED_TEXT_OR_UI_PATTERN.test(positiveInstructions);
}

function promptWizardContainsSpokenAudioInstruction(value: string) {
  const positiveInstructions = value
    .normalize('NFKC')
    .replace(PROMPT_WIZARD_NEGATED_SPOKEN_AUDIO_PATTERN, '');
  return PROMPT_WIZARD_SPOKEN_AUDIO_PATTERN.test(positiveInstructions);
}

export function promptWizardContainsStaticInstruction(value: string) {
  return STATIC_INSTRUCTION_PATTERN.test(value.normalize('NFKC'));
}

function promptWizardMotionSources(shot: PromptWizardConversionShot) {
  const sources = new Set<string>();
  const action = shot.action.normalize('NFKC');
  const environment = `${shot.action} ${shot.lightingAndRealism} ${shot.foley}`.normalize('NFKC');
  if (PRODUCT_ACTION_PATTERN.test(action)) sources.add('product-action');
  if (PERSON_MOTION_PATTERN.test(action)) sources.add('person-motion');
  if (CAMERA_MOTION_PATTERN.test(shot.cameraMovement.normalize('NFKC'))) sources.add('camera-motion');
  if (EDIT_MOTION_PATTERN.test(shot.editingCue.normalize('NFKC'))) sources.add('edit-motion');
  if (ENVIRONMENT_MOTION_PATTERN.test(environment)) sources.add('environment-motion');
  return sources;
}

export function promptWizardTranscriptNamesProduct(
  value: string,
  profile: PromptWizardProductProfile,
) {
  const transcript = normalizeSignature(value);
  if (!transcript) return false;
  const candidates = [profile.productName, profile.category]
    .flatMap(item => item.split(/[·｜|/、，,（）()\-]/u))
    .flatMap(item => {
      const normalized = normalizeSignature(item);
      const chineseRuns = item.match(/[\u3400-\u9fff]{2,12}/gu) ?? [];
      const chineseProductNouns = chineseRuns.flatMap(run => {
        const characters = [...run];
        return Array.from(
          { length: Math.max(0, Math.min(6, characters.length) - 1) },
          (_, index) => normalizeSignature(characters.slice(-(index + 2)).join('')),
        );
      });
      return [normalized, ...chineseProductNouns];
    })
    .filter(item => item.length >= 2 && !PROMPT_WIZARD_GENERIC_PRODUCT_TERMS.has(item));
  return candidates.some(candidate => transcript.includes(candidate));
}

/**
 * 为固定字符槽返回可直接写入口播的产品首提锚点。候选始终先来自锁定的
 * productName，再退到 category；只保留无需 NFKC 变换、由可朗读字母或
 * 数字组成、且会被权威首提判定识别的原文片段。这里不翻译、不补写事实，
 * 也不会为了塞入字符槽而截断一个本来可识别的候选。
 */
export function promptWizardReadableProductMentionAnchors(
  profile: PromptWizardProductProfile,
  maxCharacters: number,
) {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 2 || maxCharacters > 80) {
    return [];
  }
  const anchors: string[] = [];
  const add = (candidate: string) => {
    const characters = Array.from(candidate);
    if (
      characters.length < 2
      || characters.length > maxCharacters
      || candidate.normalize('NFKC') !== candidate
      || !/[\u3400-\u9fff]{2}/u.test(candidate)
      || promptWizardContainsDirectCta(candidate)
      || promptWizardContainsUnsafeProductAnchorLanguage(candidate)
      || characters.some(character => (
        !/^[\p{L}\p{N}]$/u.test(character)
        || /[\p{C}\p{Z}]/u.test(character)
        || /\p{Extended_Pictographic}/u.test(character)
      ))
      || !promptWizardTranscriptNamesProduct(candidate, profile)
    ) return;
    anchors.push(candidate);
  };

  // 不截断或规范化锁定字段：完整商品名装不下时，只能退到完整短品类。
  add(profile.productName);
  if (profile.category !== profile.productName) add(profile.category);
  return anchors;
}

const PROMPT_WIZARD_GENERIC_PRODUCT_TERMS = new Set([
  '产品', '商品', '用品', '东西', '物品', '这款', '这个',
]);

function normalizeCameraSignature(value: string) {
  const normalized = normalizeSignature(value);
  const families: ReadonlyArray<readonly [string, RegExp]> = [
    ['推进', /推近|推进|前推/u],
    ['拉远', /拉远|抽离|后拉/u],
    ['摇镜', /摇镜|摇移|横摇|纵摇/u],
    ['平移', /平移|侧移|横移|滑轨/u],
    ['跟拍', /跟拍|跟随|追踪/u],
    ['环绕', /环绕|绕拍/u],
    ['焦点', /变焦|拉焦|焦点切换/u],
  ];
  const family = families.find(([, pattern]) => pattern.test(normalized));
  return family?.[0] ?? normalized;
}

function normalizeSignature(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
