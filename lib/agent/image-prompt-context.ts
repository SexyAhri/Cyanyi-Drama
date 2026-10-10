import type { AgentMessage } from "./types";
import { getFinalPrompt } from "./reply-sections";

export type ImagePromptArtifact = {
  positive: string;
  negative?: string;
  sourceMessageId?: string;
};

const SECTION_HEADING =
  /(?:^|\n)\s*(?:#{1,6}\s*)?\*{0,2}(优化版中文文案|中文提示词|英文提示词|负面提示词|image prompt|english prompt|negative prompt|提示词)\s*[:：]?\s*\*{0,2}\s*[:：]?\s*(?=\n|$)/gim;

export function extractImagePromptArtifact(content: string): ImagePromptArtifact | null {
  const headings = [...content.matchAll(SECTION_HEADING)];
  if (!headings.length) {
    const positive = getFinalPrompt(content);
    return positive && positive.length >= 24 ? { positive } : null;
  }

  const sections = headings.map((heading, index) => ({
    name: heading[1].toLowerCase(),
    value: cleanSection(
      content.slice(
        heading.index! + heading[0].length,
        headings[index + 1]?.index ?? content.length,
      ),
    ),
  }));
  const positive =
    sections.find((section) => /英文提示词|english prompt|image prompt/.test(section.name))?.value ||
    sections.find((section) => /中文提示词|优化版中文文案|^提示词$/.test(section.name))?.value;
  if (!positive || positive.length < 24) return null;

  const negative = sections.find((section) => /负面提示词|negative prompt/.test(section.name))?.value;
  return { positive, ...(negative ? { negative } : {}) };
}

export function isPreviousImagePromptRequest(content: string) {
  return (
    /(?:按|用|照|根据)(?:照)?(?:你(?:的)?|刚才(?:的)?|刚刚(?:的)?|上面(?:的)?|这(?:个|一)?版|安全版)[^。！？\n]{0,24}(?:建议|提示词|文案|方案|版本|生成|再来|画)/i.test(content) ||
    /(?:按|用|照)(?:这|那)(?:个|一)?版(?:生成|画|再来)/.test(content) ||
    /(?:你的建议|你的方案|刚才的建议|上面的建议)[^。！？\n]{0,24}(?:重新|再来|生成|画)/.test(content) ||
    /(刚刚|刚才|之前|前面|上面|上一(?:条|版))[^。！？\n]{0,30}(提示词|文案|prompt)/i.test(content) ||
    /(提示词|文案|prompt)[^。！？\n]{0,30}(刚刚|刚才|之前|前面|上面|上一(?:条|版))/i.test(content) ||
    /(?:previous|earlier|last)\s+(?:image\s+)?prompt/i.test(content)
  );
}

export function findPreviousImagePrompt(messages: AgentMessage[]): ImagePromptArtifact | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.toolCall?.name === "image_generation" &&
      message.toolCall.status === "done"
    ) {
      const result = message.toolCall.result;
      const args = message.toolCall.args;
      const revised =
        result &&
        typeof result === "object" &&
        "safetyRetry" in result &&
        result.safetyRetry &&
        typeof result.safetyRetry === "object" &&
        "revisedPrompt" in result.safetyRetry &&
        typeof result.safetyRetry.revisedPrompt === "string"
          ? result.safetyRetry.revisedPrompt
          : null;
      const prompt =
        revised ||
        (args && typeof args === "object" && "prompt" in args && typeof args.prompt === "string"
          ? args.prompt
          : null);
      if (prompt?.trim()) return { positive: prompt.trim(), sourceMessageId: message.id };
    }
    if (message.role !== "assistant") continue;
    const saved = message.metadata?.imagePrompt;
    if (
      saved &&
      typeof saved === "object" &&
      !Array.isArray(saved) &&
      typeof (saved as Record<string, unknown>).positive === "string"
    ) {
      const artifact = saved as ImagePromptArtifact;
      if (artifact.positive.trim()) return artifact;
    }
    const extracted = extractImagePromptArtifact(message.content);
    if (extracted) return { ...extracted, sourceMessageId: message.id };
  }
  return null;
}

export function findPreviousVideoPrompt(messages: AgentMessage[]): ImagePromptArtifact | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant") {
      const saved = message.metadata?.imagePrompt;
      if (saved && typeof saved === "object" && "positive" in saved && typeof saved.positive === "string" && saved.positive.trim()) {
        return { positive: saved.positive.trim(), sourceMessageId: message.id };
      }
      const artifact = extractImagePromptArtifact(message.content);
      if (artifact) return { ...artifact, sourceMessageId: message.id };
    }
    if (
      message.toolCall?.name !== "video_generation" ||
      message.toolCall.status !== "done"
    ) continue;
    const result = message.toolCall.result as {
      safetyRetry?: { revisedPrompt?: string };
    } | undefined;
    const args = message.toolCall.args as { prompt?: string } | undefined;
    const prompt = result?.safetyRetry?.revisedPrompt || args?.prompt;
    if (typeof prompt === "string" && prompt.trim()) {
      return { positive: prompt.trim(), sourceMessageId: message.id };
    }
  }
  return null;
}

function cleanSection(value: string) {
  const block = /```(?:[a-z0-9_-]+)?\s*\n?([\s\S]*?)```/i.exec(value);
  const source = block?.[1] ?? value;
  return source
    .replace(/^\s*(?:正面提示词|prompt)\s*[:：]\s*/i, "")
    .trim();
}
