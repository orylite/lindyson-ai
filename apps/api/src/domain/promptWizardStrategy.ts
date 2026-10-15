import { createHash } from 'node:crypto';
import type { PromptWizardCreativeBrief, PromptWizardPlanV4 } from '@lindyson/api-contracts';
import {
  PROMPT_WIZARD_PLAN_COUNT,
  PROMPT_WIZARD_LEGACY_PLAN_INDEXES,
} from './promptWizardPlanCount.js';

// V5 已不再携带七轴策略；该类型仅服务于历史 V4 读取与兼容代码。
export type PromptWizardStrategy = PromptWizardPlanV4['strategy'];

const AXIS_VALUES: { [K in keyof PromptWizardStrategy]: string[] } = {
  hookType: [
    '瞬间反差', '真实疑问', '结果先行', '意外发现', '场景代入', '细节悬念',
    '限时挑战', '错误示范', '第一视角', '感官触发', '身份共鸣', '一句承诺',
  ],
  narrativeArc: [
    '困扰到解决', '发现到验证', '日常片段递进', '开箱到结论', '误解到反转', '需求到匹配',
    '细节到整体', '挑战到证明', '选择到行动', '平静到高光', '问答式推进', '三段证据链',
  ],
  sceneFamily: [
    '通勤现场', '居家桌面', '户外移动', '办公室', '健身空间', '旅行收纳',
    '极简棚拍', '门店试用', '晨间流程', '夜间放松', '朋友分享', '近景工艺台',
  ],
  cameraGrammar: [
    '手持跟拍', '微距切片', '固定机位跳切', '第一视角', '环绕运镜', '推拉变焦',
    '俯拍拆解', '侧向滑轨', '快速摇移', '对称构图', '长焦压缩', '主观镜头交替',
  ],
  pacing: [
    '高密度快切', '先慢后快', '均匀三拍', '呼吸感慢节奏', '节拍点跳切', '停顿反转',
    '前紧后松', '逐级加速', '一镜到底感', '碎片蒙太奇', '问答节奏', '强弱强节奏',
  ],
  proofMechanism: [
    '真实操作过程', '场景前后对照', '连续使用展示', '细节特写佐证', '步骤拆解', '可视化结果',
    '第一反应', '多场景切换', '近距离材质展示', '使用动作闭环', '问题复现', '选择理由清单',
  ],
  ctaStyle: [
    '直接行动', '场景邀请', '轻问句引导', '收藏提醒', '选择式号召', '体验式邀请',
    '利益回扣', '身份认同', '好奇延续', '简短口令', '评论互动', '自然收束',
  ],
};

const AXES = Object.keys(AXIS_VALUES) as Array<keyof PromptWizardStrategy>;

const DIRECTION_AXIS_VALUES: Record<
  PromptWizardCreativeBrief['direction'],
  Partial<{ [K in keyof PromptWizardStrategy]: readonly string[] }>
> = {
  ugc: {
    hookType: ['真实疑问', '场景代入', '第一视角', '身份共鸣', '意外发现', '细节悬念'],
    narrativeArc: ['困扰到解决', '发现到验证', '日常片段递进', '需求到匹配', '问答式推进'],
    sceneFamily: ['通勤现场', '居家桌面', '户外移动', '办公室', '健身空间', '旅行收纳', '晨间流程', '朋友分享'],
    cameraGrammar: ['手持跟拍', '第一视角', '固定机位跳切', '快速摇移', '主观镜头交替'],
    proofMechanism: ['真实操作过程', '连续使用展示', '第一反应', '使用动作闭环', '多场景切换'],
    ctaStyle: ['场景邀请', '轻问句引导', '体验式邀请', '身份认同', '自然收束', '评论互动'],
  },
  'problem-solution': {
    hookType: ['场景代入', '真实疑问', '错误示范', '结果先行', '身份共鸣', '瞬间反差'],
    narrativeArc: ['困扰到解决', '需求到匹配', '误解到反转', '问答式推进', '挑战到证明'],
    proofMechanism: ['问题复现', '真实操作过程', '场景前后对照', '使用动作闭环', '可视化结果'],
    ctaStyle: ['场景邀请', '轻问句引导', '体验式邀请', '利益回扣', '自然收束'],
  },
  'unboxing-review': {
    hookType: ['细节悬念', '真实疑问', '意外发现', '第一视角', '结果先行', '感官触发'],
    narrativeArc: ['开箱到结论', '发现到验证', '细节到整体', '问答式推进', '三段证据链'],
    sceneFamily: ['居家桌面', '近景工艺台', '办公室', '门店试用', '朋友分享'],
    cameraGrammar: ['俯拍拆解', '微距切片', '固定机位跳切', '第一视角', '主观镜头交替'],
    proofMechanism: ['步骤拆解', '细节特写佐证', '真实操作过程', '近距离材质展示', '第一反应'],
    ctaStyle: ['轻问句引导', '选择式号召', '体验式邀请', '收藏提醒', '自然收束'],
  },
  'feature-test': {
    hookType: ['真实疑问', '限时挑战', '错误示范', '结果先行', '细节悬念'],
    narrativeArc: ['挑战到证明', '发现到验证', '三段证据链', '问答式推进', '选择到行动'],
    cameraGrammar: ['固定机位跳切', '俯拍拆解', '微距切片', '对称构图', '主观镜头交替'],
    proofMechanism: ['步骤拆解', '可视化结果', '真实操作过程', '问题复现', '细节特写佐证'],
    ctaStyle: ['选择式号召', '轻问句引导', '体验式邀请', '收藏提醒', '自然收束'],
  },
  'pain-comparison': {
    hookType: ['瞬间反差', '场景代入', '错误示范', '真实疑问', '结果先行'],
    narrativeArc: ['困扰到解决', '误解到反转', '需求到匹配', '选择到行动', '三段证据链'],
    proofMechanism: ['场景前后对照', '问题复现', '真实操作过程', '使用动作闭环', '选择理由清单'],
    ctaStyle: ['轻问句引导', '选择式号召', '场景邀请', '体验式邀请', '自然收束'],
  },
  lifestyle: {
    hookType: ['场景代入', '身份共鸣', '第一视角', '感官触发', '意外发现', '细节悬念'],
    narrativeArc: ['日常片段递进', '平静到高光', '需求到匹配', '发现到验证', '选择到行动'],
    sceneFamily: ['通勤现场', '居家桌面', '户外移动', '办公室', '健身空间', '旅行收纳', '晨间流程', '夜间放松'],
    cameraGrammar: ['手持跟拍', '第一视角', '环绕运镜', '侧向滑轨', '长焦压缩', '主观镜头交替'],
    ctaStyle: ['场景邀请', '体验式邀请', '身份认同', '轻问句引导', '自然收束'],
  },
  'cinematic-brand': {
    hookType: ['感官触发', '细节悬念', '结果先行', '意外发现', '身份共鸣'],
    narrativeArc: ['平静到高光', '细节到整体', '发现到验证', '日常片段递进', '选择到行动'],
    sceneFamily: ['极简棚拍', '近景工艺台', '户外移动', '夜间放松', '旅行收纳'],
    cameraGrammar: ['环绕运镜', '侧向滑轨', '长焦压缩', '对称构图', '微距切片', '推拉变焦'],
    pacing: ['呼吸感慢节奏', '先慢后快', '节拍点跳切', '前紧后松', '平静到高光'],
    proofMechanism: ['细节特写佐证', '近距离材质展示', '连续使用展示', '使用动作闭环', '多场景切换'],
    ctaStyle: ['自然收束', '身份认同', '体验式邀请', '好奇延续', '场景邀请'],
  },
  'asmr-detail': {
    hookType: ['感官触发', '细节悬念', '意外发现', '第一视角', '结果先行'],
    narrativeArc: ['细节到整体', '发现到验证', '步骤拆解', '平静到高光', '日常片段递进'],
    sceneFamily: ['近景工艺台', '居家桌面', '极简棚拍', '晨间流程', '夜间放松'],
    cameraGrammar: ['微距切片', '俯拍拆解', '固定机位跳切', '侧向滑轨', '对称构图'],
    pacing: ['呼吸感慢节奏', '均匀三拍', '节拍点跳切', '先慢后快', '强弱强节奏'],
    proofMechanism: ['近距离材质展示', '细节特写佐证', '真实操作过程', '步骤拆解', '使用动作闭环'],
    ctaStyle: ['自然收束', '体验式邀请', '好奇延续', '收藏提醒', '轻问句引导'],
  },
};

export function strategySignature(strategy: PromptWizardStrategy) {
  return AXES.map(axis => `${axis}:${strategy[axis]}`).join('|');
}

export function countDifferentStrategyAxes(left: PromptWizardStrategy, right: PromptWizardStrategy) {
  return AXES.reduce((count, axis) => count + Number(left[axis] !== right[axis]), 0);
}

/**
 * 多样性来自应用层的策略调度，不依赖提高模型采样随机性。
 * 每个轴使用不同的互质步长，使同一批两套策略至少四轴不同；历史签名仅限当前 run。
 */
export function allocatePromptWizardStrategies(input: {
  runId: string;
  ordinal: number;
  previousSignatures: Iterable<string>;
  direction?: PromptWizardCreativeBrief['direction'];
}) {
  const previous = new Set(input.previousSignatures);
  const base = stableHash(`${input.runId}:${input.ordinal}`);
  const strides = [1, 5, 7, 11, 2, 4, 8] as const;

  for (let offset = 0; offset < 2_000; offset += 1) {
    const strategies = PROMPT_WIZARD_LEGACY_PLAN_INDEXES.map(planIndex => {
      const strategy = {} as PromptWizardStrategy;
      AXES.forEach((axis, axisIndex) => {
        const values = input.direction
          ? DIRECTION_AXIS_VALUES[input.direction][axis] ?? AXIS_VALUES[axis]
          : AXIS_VALUES[axis];
        const index = (base + offset + planIndex * strides[axisIndex]!) % values.length;
        strategy[axis] = values[index]!;
      });
      return strategy;
    });
    const signatures = strategies.map(strategySignature);
    if (new Set(signatures).size !== PROMPT_WIZARD_PLAN_COUNT) continue;
    if (signatures.some(signature => previous.has(signature))) continue;
    if (!everyPair(strategies, (left, right) => countDifferentStrategyAxes(left, right) >= 4)) continue;
    return strategies;
  }

  throw Object.assign(new Error('当前任务的创意策略空间已用尽，请重新打开向导'), {
    code: 'PROMPT_WIZARD_STRATEGY_EXHAUSTED',
  });
}

function everyPair<T>(items: T[], predicate: (left: T, right: T) => boolean) {
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      if (!predicate(items[leftIndex]!, items[rightIndex]!)) return false;
    }
  }
  return true;
}

function stableHash(value: string) {
  return createHash('sha256').update(value).digest().readUInt32BE(0);
}

export const promptWizardStrategyAxes = AXES;
