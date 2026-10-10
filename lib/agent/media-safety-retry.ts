import { generateText, type LanguageModel } from "ai";
import type { MediaSafetyRetry } from "./types";

const SAFETY_REJECTION =
  /rejected by the safety system|safety[_\s-]*(?:violation|rejection)|content[_\s.-]*policy[_\s.-]*(?:violation|rejection)|responsibleaipolicyviolation|(?:inputtext|inputimage|inputvideo|outputimage|outputvideo)sensitivecontentdetected|content[_\s-]*filter|moderation[_\s-]*(?:blocked|rejected)|(?:safety|moderation|content filter).{0,60}(?:blocked|rejected|violation)|安全检查.*(拒绝|拦截|标记)|安全策略.*(拒绝|拦截)|内容审核.*(拒绝|拦截)|内容.*(?:违规|不符合.*政策)/i;

export function isMediaSafetyRejection(error: string) {
  return SAFETY_REJECTION.test(error);
}

export function isReferenceSafetyRejection(error: string) {
  return /(?:inputimage|inputvideo)sensitivecontentdetected|(?:reference|input) (?:image|video).{0,60}(?:safety|policy|sensitive)|参考(?:图|图片|视频).*(?:安全|违规|审核|拒绝)/i.test(error);
}

export class MediaSafetyRetryError extends Error {
  constructor(error: unknown, readonly safetyRetry: MediaSafetyRetry) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
    this.name = "MediaSafetyRetryError";
  }
}

export async function rewriteRejectedMediaPrompt({
  error,
  kind,
  model,
  prompt,
}: {
  error: string;
  kind: "image" | "video";
  model?: LanguageModel;
  prompt: string;
}): Promise<string | null> {
  if (
    !model ||
    !isMediaSafetyRejection(error) ||
    isReferenceSafetyRejection(error) ||
    !prompt.trim()
  ) return null;

  try {
    const result = await generateText({
      model,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(45_000),
      system: [
        `You revise ${kind} prompts only when a provider safety check has rejected an otherwise permissible request because of ambiguous wording.`,
        "Preserve the user's subject, composition, style, and benign intent. Make the smallest concrete change that resolves the ambiguity.",
        ...(kind === "video"
          ? ["Also preserve shot order, timing, camera movement, character motion, dialogue, and continuity. Do not invent extra actions or change the requested duration."]
          : []),
        "Do not disguise, euphemize, or retain disallowed content to evade a safety check. If the request itself is disallowed or cannot be made permissible without changing its essential intent, reply exactly NO_RETRY.",
        "Return only the revised prompt, in the original language, with no explanation or markdown.",
      ].join(" "),
      prompt: `Original ${kind} prompt:\n${prompt}\n\nProvider rejection:\n${error.slice(0, 1000)}`,
    });
    const revised = result.text.trim().replace(/^["“]|["”]$/g, "");
    if (
      !revised ||
      /^NO_RETRY\.?$/i.test(revised) ||
      revised === prompt.trim() ||
      revised.length > 6000
    ) {
      return null;
    }
    return revised;
  } catch {
    return null;
  }
}
