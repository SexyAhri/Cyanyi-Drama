import type { CanvasCard } from "./types";
import type { StudioLocale } from "../types";

// Navigation follows content types, independent of connections or canvas positions.
export const CANVAS_CATEGORIES = [
  { id: "panel", zh: "本集镜头", en: "Episode shots" },
  { id: "character", zh: "角色", en: "Characters" },
  { id: "location", zh: "场景", en: "Locations" },
  { id: "prop", zh: "道具", en: "Props" },
  { id: "image", zh: "图片结果", en: "Image results" },
  { id: "video", zh: "视频结果", en: "Video results" },
  { id: "audio", zh: "声音", en: "Audio" },
  { id: "continuity", zh: "跨集承接", en: "Episode continuity" },
  { id: "text", zh: "文本与备注", en: "Text and notes" },
] as const;

export function canvasCategory(node: CanvasCard) {
  return node.sourceEpisodeId ? "continuity" : node.kind;
}

export function groupCanvasCards(nodes: CanvasCard[], locale: StudioLocale) {
  const compare = new Intl.Collator(locale === "en" ? "en" : "zh-CN", { numeric: true });
  return CANVAS_CATEGORIES.map(category => ({
    id: category.id,
    label: locale === "en" ? category.en : category.zh,
    nodes: nodes.filter(node => canvasCategory(node) === category.id)
      .sort((a, b) => compare.compare(a.title, b.title) || a.id.localeCompare(b.id)),
  })).filter(group => group.nodes.length);
}
