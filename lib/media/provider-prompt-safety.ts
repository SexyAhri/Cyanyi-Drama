import type { MediaProviderRequest } from "@/lib/providers/media/types";

export type MediaPromptRiskCategory =
  | "visible_blood"
  | "anatomical_injury"
  | "severe_incapacitation"
  | "graphic_violence";

export type MediaPromptRewrite = {
  category: MediaPromptRiskCategory;
  original: string;
  replacement: string;
};

type RewriteRule = {
  category: MediaPromptRiskCategory;
  pattern: RegExp;
  replacement: string;
};

const REWRITE_RULES: readonly RewriteRule[] = [
  {
    category: "visible_blood",
    pattern: /嘴角(?:喷出|喷|溢出|流出)(?:一口)?(?:鲜)?血/gu,
    replacement: "嘴角留有少量红色水迹",
  },
  {
    category: "visible_blood",
    pattern: /口(?:吐|喷出)(?:一口)?(?:鲜)?血/gu,
    replacement: "嘴边留有少量红色水迹",
  },
  {
    category: "visible_blood",
    pattern: /(?:喷|吐|咳)(?:出)?(?:一口)?(?:鲜)?血/gu,
    replacement: "留有少量红色水迹",
  },
  {
    category: "visible_blood",
    pattern: /(?:满身(?:都?是)?鲜?血|鲜血淋漓)/gu,
    replacement: "身上留有明显红色水迹",
  },
  {
    category: "visible_blood",
    pattern: /血泊/gu,
    replacement: "大片红色水迹",
  },
  {
    category: "visible_blood",
    pattern: /(?:嘴角)?(?:残留|沾有)?鲜血|血迹|血痕/gu,
    replacement: "红色水迹",
  },
  {
    category: "anatomical_injury",
    pattern: /骨骼(?:与|和|、)?经脉(?:尽数|全部)?寸断/gu,
    replacement: "身体受到强烈冲击",
  },
  {
    category: "anatomical_injury",
    pattern: /(?:骨骼断裂|经脉寸断)/gu,
    replacement: "身体受到强烈冲击",
  },
  {
    category: "anatomical_injury",
    pattern: /(?:刺穿|贯穿)(?:了)?(?:身体|躯体|胸口|胸膛|头部)/gu,
    replacement: "强烈冲击身体",
  },
  {
    category: "severe_incapacitation",
    pattern: /眼皮(?:一)?翻(?:转)?(?:后)?失去知觉/gu,
    replacement: "神情恍惚",
  },
  {
    category: "severe_incapacitation",
    pattern: /(?:失去知觉|昏死过去|昏死)/gu,
    replacement: "神情恍惚，短暂失去行动能力",
  },
  {
    category: "severe_incapacitation",
    pattern: /呼吸微弱/gu,
    replacement: "动作迟缓",
  },
  {
    category: "severe_incapacitation",
    pattern: /尸体/gu,
    replacement: "倒地静止的人物",
  },
  {
    category: "graphic_violence",
    pattern: /(?:爆头|头部爆裂)/gu,
    replacement: "头部受到强烈冲击",
  },
  {
    category: "graphic_violence",
    pattern: /(?:斩首|砍头|肢解|撕裂身体)/gu,
    replacement: "被强力击退并失去行动能力",
  },
];

const NON_GRAPHIC_STYLE =
  "非写实奇幻表现，无可见伤口、无液体喷溅、无痛苦特写。";

export function sanitizeMediaPrompt(prompt: string) {
  const changes: MediaPromptRewrite[] = [];
  let sanitized = prompt;
  for (const rule of REWRITE_RULES) {
    sanitized = sanitized.replace(rule.pattern, (original) => {
      changes.push({
        category: rule.category,
        original,
        replacement: rule.replacement,
      });
      return rule.replacement;
    });
  }
  if (changes.length && !sanitized.includes(NON_GRAPHIC_STYLE))
    sanitized = `${sanitized.trim()}\n${NON_GRAPHIC_STYLE}`;
  return { prompt: sanitized, changes };
}

export function sanitizeMediaProviderRequest(
  request: MediaProviderRequest,
  kind: "image" | "video" | "audio",
) {
  if ((kind !== "image" && kind !== "video") || !request.prompt)
    return { request, changes: [] as MediaPromptRewrite[] };
  const result = sanitizeMediaPrompt(request.prompt);
  return {
    request:
      result.changes.length > 0
        ? { ...request, prompt: result.prompt }
        : request,
    changes: result.changes,
  };
}
