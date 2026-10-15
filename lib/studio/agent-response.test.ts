import { describe, expect, it } from "vitest";
import { studioAgentPlainTextFallback } from "./agent-response";

describe("studio agent plain-text fallback", () => {
  it("shows a plain reply while explicitly proposing no operation", () => {
    expect(studioAgentPlainTextFallback("```text\n可以先完善人物动机。\n```"))
      .toEqual({ reply: "可以先完善人物动机。", operation: null, targetId: null, canvasPrompt: null, validated: false });
  });

  it("bounds provider text and ignores empty replies", () => {
    expect(studioAgentPlainTextFallback("  ")).toBeNull();
    expect(studioAgentPlainTextFallback("a".repeat(17_000))?.reply).toHaveLength(16_000);
  });
});
