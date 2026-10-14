import { describe, expect, it } from "vitest";
import { DEFAULT_SOUND_POLICY, configurationSnapshotSchema, mergeProductionConfigurations } from "./contract";
import { configuredSpeechForLine, requestSoundPolicy } from "./sound-execution";
describe("frozen sound execution", () => {
  const line = { id: "original", speaker: "甲", content: "旧台词", delivery: "dialogue" };
  it("uses confirmed content and delivery, removes missing lines and respects type switches", () => {
    const sound = { ...DEFAULT_SOUND_POLICY, speechLines: [{ originLineId: line.id, speaker: "乙", content: "确认内容", delivery: "inner_monologue" as const }] };
    expect(configuredSpeechForLine(sound, line)).toMatchObject({ content: "确认内容", delivery: "inner_monologue" });
    expect(configuredSpeechForLine({ ...sound, innerMonologue: false }, line)).toBeNull();
    expect(configuredSpeechForLine({ ...sound, speechLines: [] }, line)).toBeNull();
  });
  it("allows subtitles on silent footage without enabling a TTS request", () => {
    const sound = { ...DEFAULT_SOUND_POLICY, mode: "silent" as const };
    expect(configuredSpeechForLine(sound, line)).toBeNull();
    expect(configuredSpeechForLine(sound, line, true)).toEqual(line);
  });
  it("reads the saved panel snapshot and remains compatible with snapshots without a defaults version", () => {
    const old = { ...mergeProductionConfigurations([{ sound: { music: "off" } }]), format: "production-configuration-v1", sources: [] };
    expect(configurationSnapshotSchema.parse(old).sound.music).toBe("off");
    expect(requestSoundPolicy({ productionConfiguration: old, panelSoundConfigurations: { panel: { ...old, sound: { ...old.sound, mode: "post" } } } }, "panel").mode).toBe("post");
    expect(requestSoundPolicy({}).mode).toBe("native");
  });
});
