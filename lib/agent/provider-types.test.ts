import { describe, expect, it } from "vitest";

import {
  getPrimaryModelCapability,
  inferModelCapabilities,
  supportsStoredStructuredOutputs,
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

  it("uses the declared AutoDL workflow capabilities", () => {
    const video = inferModelCapabilities(
      "minimax_h3_image_audio_to_video_v2_15s",
      "autodl-comfyui",
    );
    const voice = inferModelCapabilities("indextts2-v1", "autodl-comfyui");

    expect(video.modalities).toEqual(["video"]);
    expect(video.supportsReferenceImages).toBe(true);
    expect(video.supportsReferenceAudio).toBe(true);
    expect(voice.modalities).toEqual(["audio"]);
    expect(voice.supportsReferenceAudio).toBe(true);
  });

  it("defaults unknown provider models to text without enabling media", () => {
    const capabilities = inferModelCapabilities("custom-model");

    expect(capabilities.modalities).toEqual(["text"]);
    expect(capabilities.supportsToolCalling).toBe(true);
    expect(capabilities.supportsStructuredOutputs).toBe(false);
    expect(capabilities.supportsReferenceImages).toBe(false);
  });

  it("prioritizes media capabilities over generic text keywords", () => {
    const capabilities = inferModelCapabilities("gpt-image-2");

    expect(capabilities.modalities).toEqual(["image"]);
    expect(getPrimaryModelCapability(capabilities)).toBe("image");
    expect(capabilities.supportsToolCalling).toBe(false);
  });

  it("only enables strict structured outputs when explicitly stored", () => {
    expect(
      supportsStoredStructuredOutputs(
        JSON.stringify({ supportsStructuredOutputs: true }),
      ),
    ).toBe(true);
    expect(supportsStoredStructuredOutputs("invalid")).toBe(false);
    expect(
      supportsStoredStructuredOutputs(
        JSON.stringify({ supportsStructuredOutputs: false }),
      ),
    ).toBe(false);
  });
});
