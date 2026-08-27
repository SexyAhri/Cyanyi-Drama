import type { SuggestedInputOption } from "@/components/ui/suggested-input";

import type { StudioLocale } from "../types";

type SuggestionKey =
  | "action"
  | "cameraAngle"
  | "cameraMove"
  | "cameraPosition"
  | "colorTone"
  | "composition"
  | "depthOfField"
  | "emotion"
  | "expression"
  | "focalLength"
  | "lighting"
  | "shotType";

type CatalogEntry = {
  description: { en: string; zh: string };
  value: { en: string; zh: string };
};

const catalogs: Record<SuggestionKey, CatalogEntry[]> = {
  shotType: [
    entry("大远景", "Extreme wide", "交代宏大环境，人物占比很小", "Establishes a vast environment with very small figures"),
    entry("全景", "Wide", "展示人物全身及其所处空间", "Shows the full body and surrounding space"),
    entry("中景", "Medium", "对话与人物动作最常用", "The standard choice for dialogue and body language"),
    entry("近景", "Close", "突出人物情绪与反应", "Emphasizes emotion and reaction"),
    entry("特写", "Extreme close-up", "聚焦面部细节或关键物件", "Focuses on a facial detail or critical object"),
  ],
  cameraMove: [
    entry("固定镜头", "Locked-off", "画面稳定，适合清晰交代信息", "Stable framing for clear information"),
    entry("缓慢推进", "Slow push-in", "逐步加强注意力或情绪", "Gradually intensifies attention or emotion"),
    entry("缓慢拉远", "Slow pull-out", "揭示环境或制造疏离感", "Reveals context or creates emotional distance"),
    entry("横摇", "Pan", "横向跟随人物或展示空间", "Follows action or reveals space horizontally"),
    entry("跟拍", "Tracking", "摄影机随人物移动", "Moves with the subject"),
    entry("环绕", "Orbit", "围绕主体移动，增强戏剧性", "Moves around the subject for dramatic emphasis"),
    entry("手持", "Handheld", "轻微晃动，增加临场感与紧张感", "Adds immediacy and tension through subtle shake"),
  ],
  cameraAngle: [
    entry("平视", "Eye level", "自然中性，最接近日常观察", "Neutral and closest to everyday observation"),
    entry("俯拍", "High angle", "让主体显得弱小或展示空间关系", "Makes the subject feel vulnerable or clarifies layout"),
    entry("仰拍", "Low angle", "增强主体的力量与压迫感", "Gives the subject power and presence"),
    entry("鸟瞰", "Bird's-eye", "从正上方交代位置与运动轨迹", "Maps positions and movement from directly above"),
    entry("倾斜构图", "Dutch angle", "制造失衡、不安或异常感", "Creates imbalance, unease, or disorientation"),
  ],
  cameraPosition: [
    entry("正面", "Front", "清楚呈现表情与动作", "Clearly presents expressions and actions"),
    entry("侧面", "Profile", "突出轮廓与人物之间的距离", "Emphasizes silhouette and distance between characters"),
    entry("背面", "Rear", "保留信息，强化人物视角", "Withholds information and aligns with the subject"),
    entry("过肩", "Over-the-shoulder", "对话场景中建立人物关系", "Establishes relationships in dialogue scenes"),
    entry("主观视角", "Point of view", "让观众直接看到角色所见", "Shows exactly what the character sees"),
    entry("低机位贴地", "Ground-level", "强调速度、重量或威胁", "Emphasizes speed, weight, or threat"),
  ],
  focalLength: [
    entry("18mm", "18mm", "超广角，空间夸张，适合宏大环境", "Ultra-wide with exaggerated space for large environments"),
    entry("24mm", "24mm", "广角，兼顾环境与动态", "Wide with strong environmental context and movement"),
    entry("35mm", "35mm", "自然且有环境感，叙事常用", "Natural with context, a common narrative lens"),
    entry("50mm", "50mm", "接近人眼观感，适合对话", "Natural perspective suited to dialogue"),
    entry("85mm", "85mm", "压缩背景，突出人物与情绪", "Compresses the background and isolates emotion"),
  ],
  lighting: [
    entry("自然光", "Natural light", "真实柔和，适合日常与写实场景", "Soft and realistic for everyday scenes"),
    entry("低调光", "Low-key", "暗部较多，适合悬疑与压力", "Deep shadows for suspense and pressure"),
    entry("高调光", "High-key", "整体明亮，适合轻松或洁净氛围", "Bright overall for light or clean moods"),
    entry("侧光", "Side light", "塑造面部和物体的立体感", "Shapes faces and objects with dimensionality"),
    entry("逆光", "Backlight", "突出轮廓，营造氛围或神秘感", "Defines silhouettes and creates atmosphere"),
    entry("实景光源", "Practical light", "使用灯笼、台灯等画内光源", "Uses visible sources such as lamps or lanterns"),
  ],
  composition: [
    entry("三分法", "Rule of thirds", "稳定易读，适合大多数叙事镜头", "Balanced and readable for most narrative shots"),
    entry("居中构图", "Centered", "集中注意力，形成秩序或压迫感", "Concentrates attention and creates order or pressure"),
    entry("对称构图", "Symmetrical", "强调仪式感、秩序或不安", "Suggests ritual, control, or unease"),
    entry("引导线", "Leading lines", "利用道路或建筑线条引导视线", "Uses architecture or paths to guide the eye"),
    entry("框中框", "Frame within frame", "利用门窗增强层次与窥视感", "Uses doors or windows for depth and observation"),
    entry("负空间", "Negative space", "留出空白，表达孤独或未知威胁", "Uses empty space for isolation or unseen threat"),
  ],
  depthOfField: [
    entry("深景深", "Deep focus", "前后景都清晰，强调空间信息", "Keeps foreground and background clear"),
    entry("中等景深", "Medium depth", "主体清晰，同时保留环境可读性", "Balances subject separation and readable context"),
    entry("浅景深", "Shallow focus", "背景虚化，集中注意主体", "Blurs the background to isolate the subject"),
    entry("焦点转移", "Rack focus", "在前后主体之间切换注意力", "Moves attention between foreground and background subjects"),
  ],
  colorTone: [
    entry("自然中性", "Natural neutral", "保持真实肤色与环境颜色", "Preserves realistic skin and environmental color"),
    entry("冷色调", "Cool", "偏蓝青，营造疏离、夜晚或危险", "Blue-cyan bias for distance, night, or danger"),
    entry("暖色调", "Warm", "偏金橙，营造温暖、怀旧或安全", "Gold-orange bias for warmth, nostalgia, or safety"),
    entry("低饱和", "Desaturated", "颜色克制，适合严肃或压抑氛围", "Restrained color for serious or oppressive moods"),
    entry("高对比", "High contrast", "明暗反差强，增强戏剧冲突", "Strong tonal separation for dramatic conflict"),
    entry("青橙对比", "Teal and orange", "冷暖分离，突出人物肤色", "Separates cool environments from warm skin tones"),
  ],
  emotion: [
    entry("克制", "Restrained", "情绪存在但不直接外露", "Emotion is present but held back"),
    entry("警觉", "Alert", "注意环境变化，保持防备", "Monitors the surroundings defensively"),
    entry("紧张", "Tense", "身体和呼吸略显僵硬", "Body and breathing show tension"),
    entry("坚定", "Determined", "目标明确，不轻易动摇", "Focused on the goal without hesitation"),
    entry("愤怒", "Angry", "压低语气或爆发式反应", "Expressed through contained or explosive reaction"),
    entry("悲伤", "Sad", "动作迟缓，注意力内收", "Slower movement and inward attention"),
    entry("恐惧", "Afraid", "回避、僵住或急促反应", "Avoidance, freezing, or rapid reaction"),
  ],
  action: [
    entry("站定观察", "Stop and observe", "先确认环境或对方反应", "Pauses to read the environment or another person"),
    entry("缓慢靠近", "Approach slowly", "建立试探、亲近或压迫", "Builds caution, intimacy, or pressure"),
    entry("快速转身", "Turn quickly", "对突发信息作出即时反应", "React immediately to new information"),
    entry("回头确认", "Look back", "检查身后人物或危险", "Checks a person or threat behind"),
    entry("握紧拳头", "Clench fists", "用细节表现压抑的冲突", "Shows contained conflict through a detail"),
    entry("递出物件", "Offer an object", "让关系变化落在具体动作上", "Grounds a relationship beat in a clear action"),
  ],
  expression: [
    entry("面无表情", "Neutral expression", "隐藏真实态度，保留判断空间", "Conceals intent and leaves room for interpretation"),
    entry("眉头紧锁", "Furrowed brow", "表现思考、担忧或怀疑", "Signals thought, concern, or suspicion"),
    entry("目光坚定", "Steady gaze", "表现决心与正面回应", "Signals resolve and direct engagement"),
    entry("眼神游移", "Shifting gaze", "表现犹豫、心虚或寻找出口", "Signals hesitation, guilt, or searching for escape"),
    entry("嘴角微扬", "Faint smile", "表达克制的善意或自信", "Shows restrained warmth or confidence"),
    entry("泪光闪烁", "Tears welling", "情绪接近失控但尚未爆发", "Emotion nears breaking without fully releasing"),
  ],
};

const text = {
  "zh-CN": {
    sections: {
      basics: { title: "基础镜头", description: "画面、人物与时长" },
      photography: { title: "摄影设置", description: "机位、镜头与光影" },
      performance: { title: "表演与台词", description: "角色情绪、动作和字幕" },
      prompts: { title: "生成提示词", description: "仅在需要修正生成结果时编辑" },
    },
    suggestionsLabel: "常用建议",
    placeholders: {
      location: "输入场景名称",
      duration: "例如 3",
      cast: "多个角色用逗号分隔",
      props: "多个道具用逗号分隔",
      shotType: "输入或选择景别",
      cameraMove: "输入或选择镜头运动",
      cameraAngle: "输入或选择机位角度",
      cameraPosition: "输入或选择摄影机位",
      focalLength: "输入或选择焦段",
      lighting: "输入或选择灯光方式",
      composition: "输入或选择构图方式",
      depthOfField: "输入或选择景深",
      colorTone: "输入或选择色调",
      emotion: "输入或选择情绪",
      action: "输入或选择动作",
      expression: "输入或选择表情",
    },
  },
  en: {
    sections: {
      basics: { title: "Shot basics", description: "Visual, cast, and duration" },
      photography: { title: "Cinematography", description: "Camera, lens, light, and color" },
      performance: { title: "Performance & dialogue", description: "Emotion, action, expression, and subtitle" },
      prompts: { title: "Generation prompts", description: "Edit only when generation needs correction" },
    },
    suggestionsLabel: "Common suggestions",
    placeholders: {
      location: "Enter a location name",
      duration: "For example, 3",
      cast: "Separate names with commas",
      props: "Separate props with commas",
      shotType: "Type or choose a shot size",
      cameraMove: "Type or choose camera movement",
      cameraAngle: "Type or choose a camera angle",
      cameraPosition: "Type or choose a camera position",
      focalLength: "Type or choose a focal length",
      lighting: "Type or choose a lighting style",
      composition: "Type or choose a composition",
      depthOfField: "Type or choose depth of field",
      colorTone: "Type or choose a color treatment",
      emotion: "Type or choose an emotion",
      action: "Type or choose an action",
      expression: "Type or choose an expression",
    },
  },
} as const;

export function getPanelEditorGuidance(locale: StudioLocale) {
  return {
    ...text[locale],
    suggestions: Object.fromEntries(
      Object.entries(catalogs).map(([key, values]) => [
        key,
        values.map((item) => ({
          description: item.description[locale === "en" ? "en" : "zh"],
          value: item.value[locale === "en" ? "en" : "zh"],
        })) satisfies SuggestedInputOption[],
      ]),
    ) as Record<SuggestionKey, SuggestedInputOption[]>,
  };
}

function entry(
  zh: string,
  en: string,
  zhDescription: string,
  enDescription: string,
): CatalogEntry {
  return {
    description: { en: enDescription, zh: zhDescription },
    value: { en, zh },
  };
}
