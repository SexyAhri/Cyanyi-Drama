import { describe, expect, it } from "vitest";

import { validateVoiceDesignInput } from "./voice-design";

describe("voice design contract", () => {
  it("validates prompt and preview bounds before provider calls", () => {
    expect(() =>
      validateVoiceDesignInput({
        voicePrompt: "温柔、平静的女声",
        previewText: "这是一段预览文本",
        preferredName: "narrator",
        language: "zh",
      }),
    ).not.toThrow();
    expect(() =>
      validateVoiceDesignInput({
        voicePrompt: "",
        previewText: "预览文本足够长",
        preferredName: "narrator",
        language: "zh",
      }),
    ).toThrow("VOICE_DESIGN_PROMPT_INVALID");
  });
});
