export type ReplySections = { analysis: string; answer: string; version?: 1; sourceContent?: string };

export function getReplySections(value: unknown, content: string): ReplySections | null {
  if (value && typeof value === "object" && "analysis" in value && "answer" in value &&
      typeof value.analysis === "string" && typeof value.answer === "string" &&
      (!("sourceContent" in value) || value.sourceContent === content)) {
    return { analysis: value.analysis, answer: value.answer, version: 1 };
  }
  return splitPromptReply(content);
}

export function getFinalPrompt(content: string): string | null {
  const answer = splitPromptReply(content)?.answer ?? content;
  const blocks = [...answer.matchAll(/^```(?:text|txt|plain|plaintext|prompt)?[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm)];
  if (blocks.length !== 1 || !/(提示词|文案|prompt)/i.test(answer.slice(0, blocks[0].index))) return null;
  return blocks[0][1].trim() || null;
}

// Keep the final prompt and its introduction visible. This is a compatibility
// fallback for replies whose provider did not supply separate content parts.
export function splitPromptReply(content: string): ReplySections | null {
  const fence = /^```(?:text|txt|plain|plaintext|prompt)?[ \t]*\r?\n[\s\S]*?^```[ \t]*$/m.exec(content);
  if (!fence || fence.index === 0) return null;
  const prefix = content.slice(0, fence.index).trimEnd();
  const paragraphBreaks = [...prefix.matchAll(/\r?\n[ \t]*\r?\n/g)];
  const lastBreak = paragraphBreaks.at(-1);
  const paragraphStart = lastBreak ? lastBreak.index! + lastBreak[0].length : 0;
  const introduction = prefix.slice(paragraphStart);
  if (!/(提示词|文案|prompt)/i.test(introduction)) return null;
  const analysis = prefix.slice(0, paragraphStart).trim();
  if (!analysis || !/^\s*(?:\d+[.)、]|[-*])\s+/m.test(analysis)) return null;
  return { analysis, answer: content.slice(paragraphStart).trim(), version: 1, sourceContent: content };
}
