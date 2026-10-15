import type { PromptWizardCreativeBrief } from '@lindyson/api-contracts';

export type PromptWizardShotRole = 'hook' | 'proof' | 'proof-resolution' | 'resolution' | 'cta';

export interface PromptWizardDirectionBlueprint {
  direction: PromptWizardCreativeBrief['direction'];
  label: string;
  objective: string;
  routeGuidance: readonly string[];
  visualStyle: readonly string[];
  proofRules: readonly string[];
  ctaTone: string;
  guardrails: readonly string[];
  beatGuidance: Readonly<Record<PromptWizardShotRole, string>>;
}

const SHOT_ROLES_BY_DURATION = {
  5: ['hook', 'proof-resolution', 'cta'],
  // V5 历史队列固定使用四镜头；V6 的三镜头预算在编译器中单独定义，
  // 避免发布窗口内改变仍需完成的旧任务语义。
  10: ['hook', 'proof', 'resolution', 'cta'],
  15: ['hook', 'proof', 'resolution', 'cta'],
} as const satisfies Record<5 | 10 | 15, readonly PromptWizardShotRole[]>;

const DIRECTION_BLUEPRINTS = {
  ugc: {
    direction: 'ugc',
    label: '真实 UGC',
    objective: '让产品像真实用户日常记录中的自然发现，而不是预先编排的广告。',
    routeGuidance: [
      '从正在发生的生活瞬间或真实疑问切入',
      '通过自然反应和完整使用动作推进，不使用硬性推销口吻',
      '结论来自镜头中能看到的体验，不伪造用户评价',
    ],
    visualStyle: ['手机实拍感', '自然环境光', '允许轻微手持呼吸感', '人物反应真实克制'],
    proofRules: ['优先展示真实操作过程', '证明动作必须连续且能看清产品如何被使用'],
    ctaTone: '像朋友分享一样口语化、轻量、自然，不制造虚假稀缺。',
    guardrails: ['不得伪造购买经历', '不得使用虚构好评或群体背书'],
    beatGuidance: {
      hook: '用一个具体生活瞬间、真实疑问或自然反应让目标人群立即代入。',
      proof: '人物在真实环境中完成一次清楚可见的产品操作，并给出第一反应。',
      'proof-resolution': '用一次连续的真实操作同时完成产品自证与困扰缓解。',
      resolution: '展示操作后生活节奏或使用感受如何自然改善，不夸大不可见效果。',
      cta: '以朋友式软邀请收束，让观众自行判断是否适合。',
    },
  },
  'problem-solution': {
    direction: 'problem-solution',
    label: '场景问题解决',
    objective: '把抽象卖点转化为具体场景中的问题、介入动作和可见缓解。',
    routeGuidance: [
      '先呈现一个与目标人群相关的具体困扰',
      '产品必须通过正确使用动作介入',
      '只展示镜头可观察的变化，不承诺不可验证结果',
    ],
    visualStyle: ['问题现场清楚可辨', '操作前后空间和主体连续', '镜头围绕因果动作组织'],
    proofRules: ['问题、产品动作和结果必须形成可追溯闭环', '变化只能来自可见事实或用户确认卖点'],
    ctaTone: '回扣原始场景，以“下次遇到这种情况可以试试”的邀请收束。',
    guardrails: ['不得魔法变形或瞬间产生无因结果', '不得把缓解描述为绝对解决'],
    beatGuidance: {
      hook: '在真实场景中快速复现具体困扰，让问题在画面里可见。',
      proof: '展示产品介入问题的正确动作及关键细节。',
      'proof-resolution': '在一次连续动作中展示产品介入及问题被可见缓解。',
      resolution: '用连续画面呈现问题被缓解后的状态，并回扣目标人群需求。',
      cta: '以具体场景邀请收束，不做绝对效果保证。',
    },
  },
  'unboxing-review': {
    direction: 'unboxing-review',
    label: '开箱测评',
    objective: '用首次接触、细节检查和克制结论建立可信的产品认知。',
    routeGuidance: [
      '从包装或产品首次呈现开始，但不暗示虚假的本人购买经历',
      '按第一印象、结构细节、实际操作和结论推进',
      '结论必须能由已展示细节支持',
    ],
    visualStyle: ['桌面开箱视角', '手部操作清楚', '包装与产品细节近景', '评价节奏真实克制'],
    proofRules: ['至少展示一个结构或材质细节和一次正确操作', '评价只基于镜头内证据'],
    ctaTone: '用适合人群或选择标准给出克制建议，不冒充真实消费者评价。',
    guardrails: ['不得伪造下单、收货或长期使用经历', '不得把主观第一印象写成客观性能结论'],
    beatGuidance: {
      hook: '以拆封动作、首次看到的细节或一个检查问题建立好奇。',
      proof: '近距离检查产品结构、材质或正确操作，并说明可见依据。',
      'proof-resolution': '用一个细节检查和紧随其后的操作形成简短、可信的测评结论。',
      resolution: '基于已展示证据总结适用场景或选择理由。',
      cta: '给出克制的查看或比较邀请，让观众自行判断。',
    },
  },
  'feature-test': {
    direction: 'feature-test',
    label: '功能实测',
    objective: '通过可复现、可观察的动作验证用户已经确认的功能。',
    routeGuidance: [
      '先提出一个可通过画面回答的测试问题',
      '完整展示测试条件、关键动作和可见结果',
      '结论不得超出事实目录和测试画面',
    ],
    visualStyle: ['固定机位记录关键步骤', '必要时使用俯拍或近景', '测试条件清楚', '剪辑不跳过关键动作'],
    proofRules: ['测试必须安全且适合生成视频表达', '性能数字只有在用户确认后才能出现'],
    ctaTone: '以“按你的使用标准判断”式克制结论收束。',
    guardrails: ['不得编造测试数字', '不得设计危险、破坏性或无法验证的测试'],
    beatGuidance: {
      hook: '提出一个明确、可观察且安全的功能测试问题。',
      proof: '完整展示测试条件、操作步骤和镜头可见结果。',
      'proof-resolution': '在不跳过关键动作的前提下，用一次安全测试同时展示过程和可见结果。',
      resolution: '将结果放回真实使用场景，用克制语言解释其意义。',
      cta: '邀请观众按自己的使用标准继续了解，不宣称绝对胜出。',
    },
  },
  'pain-comparison': {
    direction: 'pain-comparison',
    label: '痛点对比',
    objective: '用同一人物或场景中的使用前后差异，帮助观众理解选择理由。',
    routeGuidance: [
      '对比围绕用户痛点与使用状态，不针对或贬低竞品',
      '前后条件保持一致，变化由产品正确使用动作连接',
      '结论只描述可见体验差异',
    ],
    visualStyle: ['同场景前后呼应', '分屏或匹配构图', '主体和环境连续', '差异点清楚但不过度戏剧化'],
    proofRules: ['前后状态必须由同一可观察标准比较', '产品细节和使用动作承担证明职责'],
    ctaTone: '回扣选择理由，以开放式问题或体验邀请收束。',
    guardrails: ['不得出现未经证实的竞品结论', '不得伪造绝对化前后效果'],
    beatGuidance: {
      hook: '先展示目标人群熟悉的使用前困扰或不便。',
      proof: '展示产品正确使用和支撑选择理由的可见细节。',
      'proof-resolution': '以匹配构图连接正确使用动作和使用后状态，不引入竞品结论。',
      resolution: '在相同条件下呈现使用后的体验状态，保持因果可信。',
      cta: '用选择理由或轻问句邀请观众自行比较。',
    },
  },
  lifestyle: {
    direction: 'lifestyle',
    label: '生活方式',
    objective: '让产品自然融入目标人群的一天，通过生活节奏表达使用价值。',
    routeGuidance: [
      '用一天中的具体时刻或连续场景组织故事',
      '产品出现必须服务人物动作，而不是孤立陈列',
      '功能收益与情绪收益都要有画面依据',
    ],
    visualStyle: ['自然光生活空间', '人物与环境关系明确', '动作匹配转场', '氛围真实而不过度商业化'],
    proofRules: ['通过连续使用或多场景适配证明价值', '产品外观和使用方式在切换中保持一致'],
    ctaTone: '以温和、生活化的邀请收束，避免强迫购买。',
    guardrails: ['不得让产品脱离正确使用方式成为纯道具', '不得用奢华场景暗示未经确认的身份或价格定位'],
    beatGuidance: {
      hook: '从目标人群一天中熟悉且有情绪共鸣的时刻进入。',
      proof: '让产品在自然动作中发挥可见作用，不停下来硬讲卖点。',
      'proof-resolution': '让产品在一个完整日常动作中自然发挥作用并改善当下节奏。',
      resolution: '通过时间或场景变化展示产品如何融入生活节奏。',
      cta: '以温和生活邀请结束，让观众想象自己的使用场景。',
    },
  },
  'cinematic-brand': {
    direction: 'cinematic-brand',
    label: '电影感品牌片',
    objective: '以受控光影、精致运镜和产品细节建立品牌质感，同时保持产品真实。',
    routeGuidance: [
      '先建立与产品气质一致的氛围钩子',
      '材质、结构和使用场景共同支撑品牌印象',
      '结尾用品牌式视觉收束，不堆叠广告口号',
    ],
    visualStyle: ['受控光影', '精致滑轨或环绕运镜', '材质微距', '构图克制', '转场具有视觉连续性'],
    proofRules: ['质感来自参考图片可见材质和结构', '氛围化表达不得改变产品造型、Logo 或印花'],
    ctaTone: '简短、克制、具有品牌语气，允许自然留白。',
    guardrails: ['不得为追求电影感而新增产品部件', '不得用虚构奖项、认证或地位背书'],
    beatGuidance: {
      hook: '用光影、轮廓或材质运动建立第一眼品牌氛围。',
      proof: '以精致近景揭示真实材质、结构或标识，并保持参考一致。',
      'proof-resolution': '由真实细节近景顺滑过渡到正确使用状态，完成质感与用途的连接。',
      resolution: '把产品放入主使用场景，以动作完成品牌价值表达。',
      cta: '用简短品牌式邀请和干净产品画面收束。',
    },
  },
  'asmr-detail': {
    direction: 'asmr-detail',
    label: 'ASMR 细节展示',
    objective: '用微距画面、操作声和材质反馈驱动观看，让感官证据成为主叙事。',
    routeGuidance: [
      '开场由真实可产生的声音或微距动作触发注意',
      '按触碰、操作、结构反馈和整体展示推进',
      '口播克制，Foley 承担主要节奏',
    ],
    visualStyle: ['极近景与微距', '安静背景', '慢而准确的手部动作', '声音与剪辑点严格同步'],
    proofRules: ['Foley 必须来自画面中真实发生的操作', '材质描述不得超出产品档案'],
    ctaTone: '低声量、短句或近乎无口播的自然邀请。',
    guardrails: ['不得编造产品不可能产生的声音', '不得让视觉特效遮挡关键细节'],
    beatGuidance: {
      hook: '用产品真实操作声或一个微距材质动作立即触发感官注意。',
      proof: '逐步展示触碰、开合、按压或正确操作，并让 Foley 与动作同步。',
      'proof-resolution': '用一个微距操作和真实 Foley 同时呈现材质反馈与实际用途。',
      resolution: '从微距回到完整产品或使用状态，连接细节与实际用途。',
      cta: '用低声量短句或自然留白收束，不打断 ASMR 氛围。',
    },
  },
} as const satisfies Record<PromptWizardCreativeBrief['direction'], PromptWizardDirectionBlueprint>;

export function getPromptWizardDirectionBlueprint(
  direction: PromptWizardCreativeBrief['direction'],
): PromptWizardDirectionBlueprint {
  return DIRECTION_BLUEPRINTS[direction];
}

export function promptWizardShotRoles(durationSeconds: 5 | 10 | 15) {
  return SHOT_ROLES_BY_DURATION[durationSeconds];
}

export const promptWizardDirectionBlueprints = DIRECTION_BLUEPRINTS;
