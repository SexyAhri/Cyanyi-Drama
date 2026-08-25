import { describe, expect, it } from "vitest";

import {
  getPrimaryModelCapability,
  inferModelCapabilities,
} from "./provider-types";

describe("model capability inference", () => {
  it("maps Ark Seedream and Seedance to native media capabilities", () => {
    const image = inferModelCapabilities(
      "doubao-seedream-4-0-250828",
      "volcengine-ark",
    );
    const video = inferModelCapabilities(
      "doubao-seedance-2-0-260128",
      "volcengine-ark",
    );

    expect(getPrimaryModelCapability(image)).toBe("image");
    expect(image.supportsReferenceImages).toBe(true);
    expect(getPrimaryModelCapability(video)).toBe("video");
    expect(video.supportsAsync).toBe(true);
    expect(video.supportsReferenceAudio).toBe(true);
  });

  it("defaults unknown provider models to text without enabling media", () => {
    const capabilities = inferModelCapabilities("custom-model");

    expect(capabilities.modalities).toEqual(["text"]);
    expect(capabilities.supportsToolCalling).toBe(true);
    expect(capabilities.supportsReferenceImages).toBe(false);
  });
});
