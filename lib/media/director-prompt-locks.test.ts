import { describe, expect, it } from "vitest";
import { lockVideoAudioPerformance } from "./director-prompt-locks";

describe("video sound contract", () => {
  it("preserves dialogue, character thoughts and narration with the right performance", () => {
    const prompt = lockVideoAudioPerformance("镜头推近。生成无声画面，不生成对白、旁白、字幕或水印。", {
      speakingCharacter: "甲", lipSyncText: "等我回来！",
      voiceLines: [
        { speaker: "甲", content: "等我回来！", delivery: "dialogue" },
        { speaker: "乙", content: "  他会回来吗？\n我不知道。", delivery: "inner_monologue" },
        { speaker: "旁白", content: "风声渐急。", delivery: "voiceover" },
      ],
    });
    expect(prompt).toContain("镜头推近。");
    expect(prompt).not.toContain("无声");
    expect(prompt.match(/等我回来！/gu)).toHaveLength(1);
    expect(prompt).toContain("乙以心声／内心独白");
    expect(prompt).toContain("  他会回来吗？\n我不知道。");
    expect(prompt).toContain("旁白以画外音／旁白");
    expect(prompt).toContain("不对这段声音做口型");
    expect(prompt).toContain("不生成字幕");
  });

  it("does not mutate silent actions or quoted dialogue and is idempotent", () => {
    const input = { speakingCharacter: "甲", lipSyncText: "不生成可辨识人声。" };
    const prompt = lockVideoAudioPerformance("甲无声地走入房间。甲说：“不生成可辨识人声。”\n仅生成静音视频。", input);
    expect(prompt).toContain("甲无声地走入房间。");
    expect(prompt).toContain("甲说：“不生成可辨识人声。”");
    expect(prompt).not.toContain("仅生成静音视频");
    expect(lockVideoAudioPerformance(prompt, input)).toBe(prompt);
  });

  it("generates scene sound without inventing dialogue for a non-speaking shot", () => {
    const prompt = lockVideoAudioPerformance("雨落在屋檐上。");
    expect(prompt).toContain("环境声、音效");
    expect(prompt).not.toContain("逐字说出");
    expect(prompt).not.toContain("逐字朗读");
  });

  it("keeps approved speech in a standalone compiled prompt and refreshes its delivery from voice records", () => {
    const initial = lockVideoAudioPerformance("镜头推近。", { voiceoverText: "我会回来。" });
    expect(lockVideoAudioPerformance(initial)).toBe(initial);
    const updated = lockVideoAudioPerformance(initial, { voiceLines: [{ speaker: "甲", content: "我会回来。", delivery: "inner_monologue" }] });
    expect(updated.match(/我会回来。/gu)).toHaveLength(1);
    expect(updated).toContain("甲以心声／内心独白");
    expect(updated).not.toContain("画外音以画外音／旁白");
  });
});
