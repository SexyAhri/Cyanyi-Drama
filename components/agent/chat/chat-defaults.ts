import type { AgentLocale } from "../shell";

export const defaultSuggestions: Record<AgentLocale, string[]> = {
  en: [
    "Turn this story idea into a concise vertical-drama outline.",
    "Design a consistent visual prompt for a lead character.",
    "Review a scene and suggest stronger pacing and shot coverage.",
  ],
  "zh-CN": [
    "把这个故事想法整理成一版竖屏短剧大纲。",
    "为主角整理一份可保持一致性的视觉提示词。",
    "检查这场戏的节奏，并给出更完整的镜头覆盖建议。",
  ],
};
