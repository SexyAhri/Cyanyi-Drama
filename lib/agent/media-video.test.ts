import { describe, expect, it } from "vitest";

import {
  isSeedanceVideoModel,
  normalizeOpenAICompatibleVideoResolution,
  normalizeOpenAICompatibleVideoSeconds,
  normalizeOpenAICompatibleVideoSize,
  normalizeSeedanceDuration,
  normalizeSeedanceRatio,
  normalizeSeedanceResolution,
} from "./media-video";

describe("OpenAI-compatible video normalization", () => {
  it("matches the reference video size mapping", () => {
    expect(normalizeOpenAICompatibleVideoSize("16:9")).toBe("1280x720");
    expect(normalizeOpenAICompatibleVideoSize("9:16")).toBe("720x1280");
    expect(normalizeOpenAICompatibleVideoSize("1:1")).toBe("1024x1024");
    expect(normalizeOpenAICompatibleVideoSize("21:9")).toBe("1792x1024");
    expect(normalizeOpenAICompatibleVideoSize("auto")).toBeUndefined();
  });

  it("keeps explicit sizes", () => {
    expect(normalizeOpenAICompatibleVideoSize("1360x768")).toBe("1360x768");
  });

  it("normalizes resolution names", () => {
    expect(normalizeOpenAICompatibleVideoResolution("low")).toBe("480p");
    expect(normalizeOpenAICompatibleVideoResolution("auto")).toBe("720p");
    expect(normalizeOpenAICompatibleVideoResolution("1080p")).toBe("1080p");
  });

  it("accepts duration labels from the current UI", () => {
    expect(normalizeOpenAICompatibleVideoSeconds("10s")).toBe("10");
  });

  it("normalizes grok video seconds to supported values", () => {
    expect(
      normalizeOpenAICompatibleVideoSeconds("5s", "grok-imagine-video"),
    ).toBe("6");
    expect(
      normalizeOpenAICompatibleVideoSeconds("10s", "grok-imagine-video"),
    ).toBe("10");
  });
});

describe("Seedance video normalization", () => {
  it("detects seedance models", () => {
    expect(isSeedanceVideoModel("doubao-seedance-2.0-fast-1080p")).toBe(true);
    expect(isSeedanceVideoModel("grok-image")).toBe(false);
  });

  it("normalizes ratio and explicit sizes", () => {
    expect(normalizeSeedanceRatio("16：9")).toBe("16:9");
    expect(normalizeSeedanceRatio("1280x720")).toBe("16:9");
    expect(normalizeSeedanceRatio("auto")).toBe("adaptive");
  });

  it("normalizes duration labels", () => {
    expect(normalizeSeedanceDuration("10s")).toBe(10);
    expect(normalizeSeedanceDuration("-1")).toBe(-1);
  });

  it("caps fast models at 720p", () => {
    expect(
      normalizeSeedanceResolution(
        "1080p",
        "doubao-seedance-2.0-fast-1080p",
      ),
    ).toBe("720p");
  });
});
