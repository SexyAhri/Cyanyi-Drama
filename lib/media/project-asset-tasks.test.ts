import { describe, expect, it } from "vitest";

import { dialogueVideoPrompt } from "./project-asset-tasks";

describe("storyboard video audio contract", () => {
  it("keeps native video audio ambient-only and withholds character lines", () => {
    const prompt = dialogueVideoPrompt({
      description: "韩宇扶住床沿，抬眼看向父亲。",
      durationSeconds: 4,
      lines: [
        { speaker: "韩宇", content: "父亲，我会想办法。", delivery: "dialogue" },
      ],
      playbackRate: 1,
      timings: [{ lineIndex: 0, startSeconds: 0, endSeconds: 4 }],
    });

    expect(prompt).toContain("只生成与场景匹配的环境声和动作音效");
    expect(prompt).toContain("禁止生成任何角色声音");
    expect(prompt).not.toContain("父亲，我会想办法。");
  });
});
