import { describe, expect, it } from "vitest";
import { configurationScopeKey, mergeProductionConfigurations, productionConfigurationPatchSchema, soundPolicyAudioMode, soundPolicyInstructions, DEFAULT_SOUND_POLICY } from "./contract";
import { configurationDiff } from "@/features/production-configuration/view-model";

describe("production configuration contract", () => {
  it("inherits each field across all five levels without mutating parents", () => {
    const personal = { sound: { dialogue: false }, agents: { director: { temperature: 0.1, model: "original" } } };
    const result = mergeProductionConfigurations([personal, { sound: { ambience: false } }, { sound: { music: "off" } }, { sound: { dialogue: true }, agents: { director: { temperature: 0.7 } } }, { sound: { subtitles: "off" } }]);
    expect(result.sound).toMatchObject({ dialogue: true, ambience: false, music: "off", subtitles: "off", effects: true });
    expect(result.agents.director).toEqual({ temperature: 0.7, model: "original" });
    expect(personal.sound.dialogue).toBe(false);
  });
  it("restores one field by removing only its override", () => {
    expect(mergeProductionConfigurations([{ sound: { dialogue: false, ambience: false } }, { sound: { ambience: true } }]).sound).toMatchObject({ dialogue: false, ambience: true });
    expect(configurationDiff({ sound: { dialogue: true, ambience: true } }, { sound: { ambience: true } })).toEqual([{ field: "sound.dialogue", before: true, after: undefined }]);
  });
  it("rejects incomplete scopes, unknown fields and unbounded policies", () => {
    expect(() => configurationScopeKey({ panelId: "p" })).toThrow();
    expect(() => configurationScopeKey({ episodeId: "e" })).toThrow();
    expect(configurationScopeKey({ projectId: "p", episodeId: "e", panelId: "shot" })).toBe("panel:shot");
    expect(productionConfigurationPatchSchema.safeParse({ sound: { inventDialogue: true } }).success).toBe(false);
    expect(productionConfigurationPatchSchema.safeParse({ workflow: { transportAttempts: 99 } }).success).toBe(false);
  });
  it("maps native, post, silent and ambience-only audio precisely", () => {
    expect(soundPolicyAudioMode(DEFAULT_SOUND_POLICY)).toBe("full");
    expect(soundPolicyAudioMode({ ...DEFAULT_SOUND_POLICY, mode: "post" })).toBe("none");
    expect(soundPolicyAudioMode({ ...DEFAULT_SOUND_POLICY, mode: "silent" })).toBe("none");
    const noSpeech = { ...DEFAULT_SOUND_POLICY, dialogue: false, voiceover: false, innerMonologue: false };
    expect(soundPolicyAudioMode(noSpeech)).toBe("ambient_only");
    expect(soundPolicyAudioMode({ ...noSpeech, ambience: false, effects: false, music: "off" })).toBe("none");
    expect(soundPolicyInstructions({ ...DEFAULT_SOUND_POLICY, mode: "silent" })).not.toContain("逐字");
  });
});
