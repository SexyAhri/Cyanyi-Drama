import { describe, expect, it } from "vitest";

import { mergeProjectVoiceIdentities } from "./identity";

describe("project voice identity", () => {
  it("keeps the newest values and fills missing fields from older lines", () => {
    const identities = mergeProjectVoiceIdentities([
      {
        speaker: "韩宇",
        voiceProfilePrompt: "稳定少年中音，清晰克制，气息有韧性。",
        voicePresetId: null,
      },
      {
        speaker: "韩宇",
        voiceProfilePrompt: "不应覆盖的新设计",
        voicePresetId: "preset-1",
      },
    ]);

    expect(identities.get("韩宇")).toEqual({
      speaker: "韩宇",
      voiceProfilePrompt: "稳定少年中音，清晰克制，气息有韧性。",
      voicePresetId: "preset-1",
    });
  });
});
