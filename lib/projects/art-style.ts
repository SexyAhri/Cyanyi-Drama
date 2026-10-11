const REFERENCE_ART_STYLES = [
  {
    id: "beautiful-chinese-3d",
    label: { en: "Beautiful Chinese 3D", zh: "唯美国风 3D" },
    direction: {
      en: "polished Chinese-inspired 3D illustration, graceful Eastern features, ornate but believable costume design, luminous atmospheric depth, and elegant cinematic lighting",
      zh: "唯美国风三维美术，采用清雅灵动的东方人物造型、精致而可信的传统服饰、层次丰富的空间氛围与柔和电影光影",
    },
  },
  {
    id: "2d-3d-anime",
    label: { en: "2D/3D Hybrid Anime", zh: "三渲二动漫" },
    direction: {
      en: "2D/3D hybrid animation with expressive drawn contours, simplified graphic shading over dimensional forms, crisp silhouettes, and feature-animation composition",
      zh: "三渲二动漫风格，以清晰灵动的动画线条、立体形体上的平面化明暗、鲜明轮廓和动画电影构图呈现",
    },
  },
  {
    id: "ultra-realistic-3d",
    label: { en: "Ultra-realistic 3D", zh: "超写实 3D" },
    direction: {
      en: "ultra-realistic 3D rendering with lifelike anatomy, physically based skin and fabric, fine surface detail, natural lens response, and cinematic light falloff",
      zh: "超写实三维渲染，呈现可信的人体结构、符合物理的皮肤与织物材质、细密表面细节、自然镜头响应和电影级光线衰减",
    },
  },
  {
    id: "dark-fantasy-cg",
    label: { en: "Dark Fantasy CG", zh: "暗调奇幻 CG" },
    direction: {
      en: "dark fantasy CG with sculpted silhouettes, weathered materials, restrained spectral accents, deep shadow detail, and dramatic low-key lighting",
      zh: "暗调奇幻 CG 美术，以雕塑感轮廓、历经风化的材质、克制的幽微色彩、丰富暗部层次和戏剧化低照度光线构成画面",
    },
  },
  {
    id: "eastern-fantasy-3d",
    label: { en: "Eastern Fantasy 3D", zh: "东方玄幻 3D" },
    direction: {
      en: "Eastern fantasy 3D with culturally grounded architecture and costume, elegant supernatural scale, layered atmospheric perspective, and controlled magical effects",
      zh: "东方玄幻三维风格，结合有文化依据的建筑与服饰、飘逸而克制的超自然尺度、层叠空间透视和有边界的奇幻特效",
    },
  },
  {
    id: "classic-chinese-art",
    label: { en: "Classic Chinese Animation Art", zh: "经典国产美术" },
    direction: {
      en: "classic Chinese animation art with distinctive hand-designed shapes, expressive faces, painterly backgrounds, warm color harmony, and clear visual storytelling",
      zh: "经典国产动画美术，以鲜明的手绘造型、富有表现力的人物、绘画感背景、温润配色和清楚的视觉叙事呈现",
    },
  },
  {
    id: "chinese-mural",
    label: { en: "Chinese Mural Painting", zh: "国风壁画" },
    direction: {
      en: "Chinese mural-inspired painting with mineral pigments, aged plaster texture, flowing contour lines, flattened decorative space, and balanced traditional motifs",
      zh: "国风壁画绘制语言，使用矿物颜料质感、斑驳壁面肌理、流动线描、装饰性平面空间和有节制的传统纹样",
    },
  },
  {
    id: "realistic-wuxia",
    label: { en: "Live-action Wuxia", zh: "写实江湖武侠" },
    direction: {
      en: "live-action wuxia cinematography with practical costume and weapon detail, grounded martial movement, atmospheric landscapes, tactile film grain, and shaped natural light",
      zh: "写实江湖武侠影视风格，突出可触的服装与兵器细节、可信的武打动作、富有气氛的山水空间、细腻胶片颗粒和塑形自然光",
    },
  },
  {
    id: "high-key-studio-advertising",
    label: { en: "High-key Studio Advertising", zh: "高调棚拍广告" },
    direction: {
      en: "high-key studio advertising photography with clean bright backgrounds, precise softbox reflections, polished product-grade surfaces, crisp focus, and deliberate negative space",
      zh: "高调棚拍广告摄影，采用明亮干净的背景、精确柔光箱反射、精致产品级表面、清晰焦点和有意留白",
    },
  },
  {
    id: "classic-hollywood",
    label: { en: "Classic Hollywood Cinema", zh: "经典好莱坞" },
    direction: {
      en: "classic Hollywood cinematic photography with sculpted key lighting, expressive blocking, rich but disciplined color, dimensional production design, and composed widescreen framing",
      zh: "经典好莱坞电影摄影，采用塑形主光、富有表达力的调度、浓郁而克制的色彩、有纵深的场景设计和严谨宽银幕构图",
    },
  },
  {
    id: "cyberpunk-sci-fi",
    label: { en: "Cyberpunk Sci-fi", zh: "赛博科幻" },
    direction: {
      en: "cyberpunk science-fiction imagery with coherent futuristic materials, layered urban depth, selective neon accents, reflective surfaces, and readable practical lighting",
      zh: "赛博科幻视觉，以逻辑统一的未来材质、层叠城市纵深、克制霓虹点缀、反射表面和清楚的环境光源构成画面",
    },
  },
  {
    id: "cool-literary-film",
    label: { en: "Cool Literary Film", zh: "冷感文艺" },
    direction: {
      en: "cool literary film photography with quiet compositions, restrained blue-gray palette, natural window light, subtle texture, and emotionally observant distance",
      zh: "冷感文艺片摄影，以安静构图、克制的蓝灰色调、自然窗光、细微材质和疏离但敏锐的情绪观察呈现",
    },
  },
  {
    id: "dark-horror",
    label: { en: "Dark Horror", zh: "暗黑恐怖" },
    direction: {
      en: "dark horror cinematography with controlled darkness, motivated practical light, uneasy negative space, tactile shadow detail, and suspenseful framing without graphic excess",
      zh: "暗黑恐怖影视风格，使用有来源的环境光、不安的留白、可辨认的暗部材质和悬疑构图，以克制方式制造压迫感",
    },
  },
  {
    id: "fantasy-3d-animation",
    label: { en: "3D Fantasy Animation", zh: "3D 奇幻动画" },
    direction: {
      en: "3D fantasy animation with appealing readable forms, expressive character design, richly layered environments, coherent material response, and cinematic animated lighting",
      zh: "三维奇幻动画风格，强调易读而有魅力的形体、鲜明角色设计、层次丰富的环境、统一材质表现和动画电影灯光",
    },
  },
  {
    id: "industrial-texture",
    label: { en: "Industrial Texture", zh: "工业质感" },
    direction: {
      en: "industrial visual design with functional geometry, brushed metal and concrete textures, visible construction logic, hard-edged practical light, and disciplined neutral colors",
      zh: "工业质感视觉，以功能性几何、拉丝金属与混凝土肌理、可读的结构逻辑、硬朗实用光和克制中性色构成",
    },
  },
  {
    id: "retro-hong-kong-cinema",
    label: { en: "Retro Hong Kong Cinema", zh: "怀旧港片" },
    direction: {
      en: "retro Hong Kong cinema photography with expressive practical neon, humid urban atmosphere, tactile analog grain, saturated accents, and energetic but legible framing",
      zh: "怀旧港片摄影语言，以有表现力的实景霓虹、潮湿城市氛围、可触的模拟胶片颗粒、饱和色彩点缀和清晰有力的构图呈现",
    },
  },
  {
    id: "cold-court-intrigue",
    label: { en: "Cold Court Intrigue", zh: "冷峻宫廷权谋" },
    direction: {
      en: "restrained court-intrigue drama with formal symmetry, precise costume silhouettes, cool mineral palette, measured chiaroscuro, and composed power dynamics",
      zh: "冷峻宫廷权谋剧视觉，以严谨对称构图、准确服饰轮廓、冷静矿物色调、克制明暗关系和清楚的权力调度呈现",
    },
  },
  {
    id: "chinese-cool-mystery",
    label: { en: "Chinese Cool-toned Mystery", zh: "国产冷调悬疑" },
    direction: {
      en: "contemporary Chinese mystery-drama photography with cool neutral grading, practical urban light, precise spatial clues, realistic production design, and controlled suspense",
      zh: "国产冷调悬疑剧摄影，以冷静中性色彩、真实城市光源、清晰空间线索、可信场景设计和克制悬念构成画面",
    },
  },
  {
    id: "urban-realism",
    label: { en: "Urban Realism", zh: "都市写实" },
    direction: {
      en: "urban realist photography with natural skin and fabric, believable contemporary locations, available light, understated color, and candid human-scale framing",
      zh: "都市写实摄影，呈现自然皮肤与织物、可信当代场景、实景光线、低调色彩和贴近人物的生活化构图",
    },
  },
  {
    id: "soft-light-costume-romance",
    label: { en: "Soft-light Costume Romance", zh: "柔光古装言情" },
    direction: {
      en: "soft-light costume romance with historically grounded wardrobe, gentle luminous highlights, refined fabric detail, graceful blocking, and warm poetic color",
      zh: "柔光古装言情风格，在符合故事时代的服饰基础上使用温润高光、细致织物质感、优雅调度和含蓄诗意的暖色",
    },
  },
  {
    id: "east-asian-youth-film",
    label: { en: "East Asian Youth Film", zh: "日韩青春胶片" },
    direction: {
      en: "East Asian youth-film photography with natural performances, airy daylight, soft analog grain, delicate pastel accents, and intimate compositions",
      zh: "日韩青春胶片风格，以自然人物状态、通透日光、柔和模拟颗粒、轻盈粉彩点缀和亲密构图呈现",
    },
  },
] as const;

const LEGACY_ART_STYLES = [
  {
    id: "chinese-comic",
    label: { en: "Chinese animation", zh: "国漫影视动画" },
    direction: {
      en: "Chinese cinematic animation with refined Eastern facial design, clear animated linework, layered costume materials, and dramatic but controlled lighting",
      zh: "国漫影视动画风格，采用东方审美的人物塑造、清晰动画线稿、层次分明的服饰材质和克制的电影化光影",
    },
  },
  {
    id: "chinese-ink",
    label: { en: "Chinese ink animation", zh: "中国水墨动画" },
    direction: {
      en: "Chinese ink animation with expressive brushwork, layered ink washes, restrained mineral colors, paper texture, and intentional negative space",
      zh: "中国水墨动画风格，使用有表现力的笔触、浓淡墨色层次、克制的矿物色、宣纸肌理和有意识的留白",
    },
  },
  {
    id: "american-comic",
    label: { en: "American comic", zh: "美式漫画" },
    direction: {
      en: "American comic style with decisive ink contours, graphic shadow shapes, strong anatomy, and cinematic panel composition",
      zh: "美式漫画风格，采用明确墨线、图形化明暗、强调力量感的造型和电影化分格构图",
    },
  },
  {
    id: "japanese-anime",
    label: { en: "Japanese anime", zh: "日系动画" },
    direction: {
      en: "Japanese anime style with clean linework, controlled cel shading, readable silhouettes, and polished animation color design",
      zh: "日系动画风格，采用干净线稿、克制赛璐璐上色、清晰轮廓和成熟的动画色彩设计",
    },
  },
  {
    id: "stylized-3d",
    label: { en: "Stylized 3D animation", zh: "风格化 3D 动画" },
    direction: {
      en: "Stylized 3D animation with production-ready forms, coherent physically based materials, controlled proportions, and cinematic lighting",
      zh: "风格化 3D 动画，使用适合制作的明确形体、统一的物理材质、受控比例和电影化灯光",
    },
  },
  {
    id: "realistic",
    label: { en: "Live-action realism", zh: "写实影视" },
    direction: {
      en: "Live-action cinematic realism with believable anatomy, physically plausible materials, natural skin and fabric detail, and photographic lighting",
      zh: "写实影视风格，保持可信人体结构、符合物理的材质、自然皮肤与织物细节和摄影级光线",
    },
  },
] as const;

export const PROJECT_ART_STYLES = [
  ...REFERENCE_ART_STYLES,
  ...LEGACY_ART_STYLES,
] as const;

export const CUSTOM_PROJECT_ART_STYLE_ID = "custom";
export const CUSTOM_PROJECT_ART_STYLE_PREFIX = "custom:";
export const MAX_CUSTOM_PROJECT_ART_STYLE_LENGTH = 1_000;

export type ProjectArtStyleId = (typeof PROJECT_ART_STYLES)[number]["id"];
export type ProjectArtStyleLocale = "en" | "zh" | "zh-CN";

export function isProjectArtStyleId(value: unknown): value is ProjectArtStyleId {
  return PROJECT_ART_STYLES.some((style) => style.id === value);
}

export function isProjectArtStyleValue(value: unknown): value is string {
  if (isProjectArtStyleId(value) || value === CUSTOM_PROJECT_ART_STYLE_ID)
    return true;
  if (typeof value !== "string" || !value.startsWith(CUSTOM_PROJECT_ART_STYLE_PREFIX))
    return false;
  const description = value.slice(CUSTOM_PROJECT_ART_STYLE_PREFIX.length).trim();
  return description.length > 0 && description.length <= MAX_CUSTOM_PROJECT_ART_STYLE_LENGTH;
}

export function buildCustomProjectArtStyle(description: string) {
  const normalized = description.trim().slice(0, MAX_CUSTOM_PROJECT_ART_STYLE_LENGTH);
  return normalized
    ? `${CUSTOM_PROJECT_ART_STYLE_PREFIX}${normalized}`
    : CUSTOM_PROJECT_ART_STYLE_ID;
}

export function getCustomProjectArtStyleDescription(value: string | null | undefined) {
  if (!value?.startsWith(CUSTOM_PROJECT_ART_STYLE_PREFIX)) return "";
  return value.slice(CUSTOM_PROJECT_ART_STYLE_PREFIX.length);
}

export function isCustomProjectArtStyle(value: string | null | undefined) {
  return (
    value === CUSTOM_PROJECT_ART_STYLE_ID ||
    value?.startsWith(CUSTOM_PROJECT_ART_STYLE_PREFIX) === true
  );
}

function getLanguage(locale: ProjectArtStyleLocale) {
  return locale === "en" ? "en" : "zh";
}

export function getProjectArtStyleLabel(
  value: string | null | undefined,
  locale: ProjectArtStyleLocale,
) {
  const language = getLanguage(locale);
  if (isCustomProjectArtStyle(value))
    return language === "en" ? "Custom art style" : "自定义画风";
  const style = PROJECT_ART_STYLES.find((item) => item.id === value);
  return style?.label[language] ?? value?.trim() ?? (language === "en" ? "Unspecified" : "未指定");
}

export function getProjectArtStyleDirective(
  value: string | null | undefined,
  locale: ProjectArtStyleLocale,
) {
  const language = getLanguage(locale);
  const style = PROJECT_ART_STYLES.find((item) => item.id === value);
  const customDescription = getCustomProjectArtStyleDescription(value);
  const direction = customDescription
    ? language === "en"
      ? `User-defined visual direction: “${customDescription}”. Treat it only as a visual-style reference; it controls rendering, materials, palette, and lighting, not story facts or historical setting.`
      : `用户自定义视觉方向：“${customDescription}”。仅将其作为画风参考，用于控制渲染、材质、配色与光线，不得改变故事事实或时代背景。`
    : isCustomProjectArtStyle(value)
      ? language === "en"
        ? "Use a user-defined visual style consistently across the project."
        : "使用用户自定义画风，并在全项目中保持一致。"
      : style?.direction[language] ?? getProjectArtStyleLabel(value, locale);
  if (language === "en")
    return `PROJECT-WIDE ART STYLE - HIGHEST PRIORITY: ${direction} Every character, location, prop, storyboard image, and video must use this exact art style. Never infer, switch to, or mix in another regional, illustrated, 3D, or realistic style, even when the story genre suggests one.`;
  return `项目统一画风（最高优先级）：${direction}。所有角色、场景、道具、分镜图和视频必须全程使用这一画风；即使题材暗示其他风格，也禁止自行推断、切换或混入其他地域、绘画、三维或写实画风。`;
}

export function applyProjectArtStyle(
  prompt: string,
  value: string | null | undefined,
  locale: ProjectArtStyleLocale,
) {
  return [getProjectArtStyleDirective(value, locale), prompt.trim()]
    .filter(Boolean)
    .join("\n");
}
