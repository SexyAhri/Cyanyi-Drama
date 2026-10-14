import { describe, expect, it, vi } from "vitest";
vi.mock("./store", () => ({ resolveProductionConfiguration: vi.fn() }));
import { affectedAgentFields, affectedSoundFields } from "./invalidation";
import { mergeProductionConfigurations, type ProductionConfigurationSnapshot } from "./contract";
const snapshot = (): ProductionConfigurationSnapshot => ({ ...mergeProductionConfigurations([]), format: "production-configuration-v1", sources: [] });
describe("precise sound asset invalidation", () => {
  const line = { id: "line-a", speaker: "Alice", content: "Hello", delivery: "dialogue" };
  it("applies request type overrides before deriving confirmed speech", () => {
    const before = snapshot(); const after = snapshot();
    before.sources = [{ scopeKey: "request", version: 0, fields: ["sound.dialogue"] }];
    after.sound.dialogue = false;
    expect(affectedSoundFields(before, after, "audio", undefined, line)).toEqual([]);
  });
  it("ignores changes to another speaker while detecting the actual voice change", () => {
    const before = snapshot(); const after = snapshot();
    before.sound.voiceProfiles = [{ speaker: "Alice", language: "zh", direction: "calm" }, { speaker: "Bob", language: "zh", direction: "calm" }];
    after.sound.voiceProfiles = [{ speaker: "Alice", language: "zh", direction: "calm" }, { speaker: "Bob", language: "en", direction: "angry" }];
    after.sound.speechLines = [{ originLineId: "line-b", speaker: "Bob", content: "Goodbye", delivery: "dialogue" }];
    // An explicit confirmed list excludes line-a, so both sides must share it.
    before.sound.speechLines = after.sound.speechLines;
    expect(affectedSoundFields(before, after, "audio", undefined, line)).toEqual([]);
    before.sound.speechLines = undefined; after.sound.speechLines = undefined;
    after.sound.voiceProfiles[0].direction = "urgent";
    expect(affectedSoundFields(before, after, "audio", undefined, line)).toEqual(["sound.voiceProfiles"]);
  });
  it("does not invalidate speech for ambience, effects or workflow changes", () => {
    const before = snapshot(); const after = snapshot(); after.sound.ambience = false; after.sound.effects = false; after.workflow.concurrency = 8;
    expect(affectedSoundFields(before, after, "audio")).toEqual([]);
    expect(affectedSoundFields(before, after, "video")).toEqual(["sound.ambience", "sound.effects"]);
  });
  it("only model subtitles affect generated clips; post/off affect renders", () => {
    const before = snapshot(); const after = snapshot(); after.sound.subtitles = "off";
    expect(affectedSoundFields(before, after, "video")).toEqual([]);
    expect(affectedSoundFields(before, after, "video", "render_timeline")).toEqual(["sound.subtitles"]);
    after.sound.subtitles = "model";
    expect(affectedSoundFields(before, after, "video")).toEqual(["sound.subtitles"]);
  });
  it("preserves explicit request overrides while comparing inherited fields", () => {
    const before = snapshot(); before.sources = [{ scopeKey: "request", version: 0, fields: ["sound.music"] }]; const after = snapshot(); after.sound.music = "off"; after.sound.dialogue = false;
    expect(affectedSoundFields(before, after, "video")).toEqual(["sound.dialogue"]);
    expect(before.sound.music).toBe("designed");
  });
});

describe("agent configuration invalidation", () => {
  it("marks media generated against changed Agent settings stale but ignores request overrides", () => {
    const before = snapshot();
    const after = snapshot();
    before.agents.storyboard = { model: "model-a", systemInstructions: "Use a warm style" };
    after.agents.storyboard = { model: "model-b", systemInstructions: "Use a warm style" };
    expect(affectedAgentFields(before, after)).toEqual(["agents.storyboard.model"]);

    before.sources = [{ scopeKey: "request", version: 0, fields: ["agents.storyboard.model"] }];
    expect(affectedAgentFields(before, after)).toEqual([]);
  });
});
