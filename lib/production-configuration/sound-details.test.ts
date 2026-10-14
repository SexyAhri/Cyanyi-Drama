import { describe, expect, it } from "vitest";
import { DEFAULT_SOUND_POLICY, productionConfigurationPatchSchema } from "./contract";
import { lockVideoAudioPerformance } from "@/lib/media/director-prompt-locks";

describe("configured approved speech and sound cues", () => {
  const policy = { ...DEFAULT_SOUND_POLICY, speechLines: [
    { speaker: "甲", content: "走吧", delivery: "dialogue" as const, direction: "轻声", startSeconds: 1, endSeconds: 2 },
    { speaker: "旁白", content: "雨停了", delivery: "voiceover" as const, startSeconds: 3 },
    { speaker: "甲", content: "我该走了", delivery: "inner_monologue" as const, endSeconds: 5 },
  ], voiceProfiles: [{ speaker: "甲", language: "普通话", direction: "低沉" }], effectCues: [{ description: "开门木轴吱响", startSeconds: 0, endSeconds: 1 }] };
  it("compiles selected speakers, speech kinds, timing, voice direction and action cues", () => {
    const prompt = lockVideoAudioPerformance("开门离开", { lipSyncText: "旧对白", soundPolicy: policy });
    expect(prompt).toContain("甲逐字说出原文对白一次：“走吧”；时间 1秒–2秒；表演要求：轻声");
    expect(prompt).toContain("以画外音／旁白"); expect(prompt).toContain("以心声／内心独白");
    expect(prompt).toContain("画面人物不对这段声音做口型"); expect(prompt).toContain("语言 普通话");
    expect(prompt).toContain("低沉"); expect(prompt).toContain("开门木轴吱响"); expect(prompt).not.toContain("旧对白");
  });
  it("removes disabled speech types and action effects", () => {
    const prompt = lockVideoAudioPerformance("开门", { soundPolicy: { ...policy, dialogue: false, innerMonologue: false, effects: false } });
    expect(prompt).not.toContain("走吧"); expect(prompt).not.toContain("我该走了"); expect(prompt).not.toContain("开门木轴吱响"); expect(prompt).toContain("雨停了");
  });
  it("allows explicit empty speech to remove original speech, and inheritance to restore it", () => {
    expect(lockVideoAudioPerformance("画面", { lipSyncText: "原台词", soundPolicy: { ...DEFAULT_SOUND_POLICY, speechLines: [] } })).not.toContain("原台词");
    expect(lockVideoAudioPerformance("画面", { lipSyncText: "原台词", soundPolicy: DEFAULT_SOUND_POLICY })).toContain("原台词");
  });
  it.each(["post", "silent"] as const)("does not ask the video model to synthesize speech or cues in %s mode", mode => {
    const prompt = lockVideoAudioPerformance("画面", { soundPolicy: { ...policy, mode } });
    expect(prompt).not.toContain("走吧"); expect(prompt).not.toContain("雨停了"); expect(prompt).not.toContain("开门木轴吱响");
  });
  it("validates timing, required speech content and unknown fields", () => {
    expect(productionConfigurationPatchSchema.safeParse({ sound: policy }).success).toBe(true);
    expect(productionConfigurationPatchSchema.safeParse({ sound: { speechLines: [{ speaker: "甲", content: "a", delivery: "dialogue", startSeconds: 2, endSeconds: 1 }] } }).success).toBe(false);
    expect(productionConfigurationPatchSchema.safeParse({ sound: { speechLines: [{ speaker: "甲", content: "", delivery: "dialogue" }] } }).success).toBe(false);
    expect(productionConfigurationPatchSchema.safeParse({ sound: { effectCues: [{ description: "a", startSeconds: -1 }] } }).success).toBe(false);
  });
});
