import { describe, expect, it } from "vitest";

import {
  normalizeEpisodeDraft,
  normalizeProjectDraft,
  validateEpisodeDraft,
  validateProjectDraft,
} from "./validation";

describe("project validation", () => {
  it("normalizes project and episode text", () => {
    expect(normalizeProjectDraft({ name: "  漫剧  ", description: "  描述 " })).toEqual({
      name: "漫剧",
      description: "描述",
    });
    expect(normalizeEpisodeDraft({ name: " 第一集 ", novelText: "  开始 " })).toEqual({
      name: "第一集",
      description: null,
      novelText: "开始",
    });
  });

  it("rejects empty and oversized names", () => {
    expect(validateProjectDraft({ name: "" })?.code).toBe("PROJECT_NAME_REQUIRED");
    expect(validateEpisodeDraft({ name: "" })).toBe("EPISODE_NAME_REQUIRED");
    expect(validateEpisodeDraft({ name: "x".repeat(161) })).toBe("EPISODE_NAME_TOO_LONG");
  });
});
