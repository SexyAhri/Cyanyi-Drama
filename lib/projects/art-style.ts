export const PROJECT_ART_STYLES = [
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

export type ProjectArtStyleId = (typeof PROJECT_ART_STYLES)[number]["id"];
export type ProjectArtStyleLocale = "en" | "zh" | "zh-CN";

export function isProjectArtStyleId(value: unknown): value is ProjectArtStyleId {
  return PROJECT_ART_STYLES.some((style) => style.id === value);
}

export function getProjectArtStyleLabel(
  value: string | null | undefined,
  locale: ProjectArtStyleLocale,
) {
  const language = locale === "en" ? "en" : "zh";
  const style = PROJECT_ART_STYLES.find((item) => item.id === value);
  return style?.label[language] ?? value?.trim() ?? (language === "en" ? "Unspecified" : "未指定");
}

export function getProjectArtStyleDirective(
  value: string | null | undefined,
  locale: ProjectArtStyleLocale,
) {
  const language = locale === "en" ? "en" : "zh";
  const style = PROJECT_ART_STYLES.find((item) => item.id === value);
  const direction = style?.direction[language] ?? getProjectArtStyleLabel(value, locale);
  if (language === "en")
    return `PROJECT-WIDE ART STYLE - HIGHEST PRIORITY: ${direction}. Every character, location, prop, storyboard image, and video must use this exact art style. Never infer, switch to, or mix in another regional, illustrated, 3D, or realistic style, even when the story genre suggests one.`;
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
