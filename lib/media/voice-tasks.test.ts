import { describe, expect, it } from "vitest";

import { resolveVoiceTaskVoice } from "./voice-tasks";

describe("voice task selection", () => {
  it("prefers an explicit voice, then an owned preset, then the model default", () => {
    const base = {
      lineSpeaker: "Narrator",
      projectId: "project-1",
      userId: "user-1",
      preset: {
        userId: "user-1",
        projectId: "project-1",
        providerVoiceId: "nova",
      },
    };
    expect(resolveVoiceTaskVoice({ ...base, explicitVoice: "alloy" })).toBe(
      "alloy",
    );
    expect(resolveVoiceTaskVoice(base)).toBe("nova");
    expect(
      resolveVoiceTaskVoice({
        ...base,
        preset: { ...base.preset, userId: "another-user" },
      }),
    ).toBeUndefined();
  });

  it("allows a global preset owned by the current user", () => {
    expect(
      resolveVoiceTaskVoice({
        lineSpeaker: "Narrator",
        projectId: "project-1",
        userId: "user-1",
        preset: {
          userId: "user-1",
          projectId: null,
          providerVoiceId: "shimmer",
        },
      }),
    ).toBe("shimmer");
  });
});
