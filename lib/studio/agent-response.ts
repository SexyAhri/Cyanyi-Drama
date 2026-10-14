export function studioAgentPlainTextFallback(text: string) {
  const reply = text
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()
    .slice(0, 4_000);
  if (!reply) return null;
  return { reply, operation: null, targetId: null, canvasPrompt: null, validated: false as const };
}
