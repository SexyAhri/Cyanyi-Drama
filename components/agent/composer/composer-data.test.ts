import { describe, expect, it } from "vitest";

import {
  createDefaultComposerSettings,
  defaultImageModelOptions,
  normalizeComposerSettings,
  imageFormatOptions,
  resolveComposerModelOptions,
} from "./composer-data";

describe("composer model resolution", () => {
  it("keeps video model selection available for provider-specific model ids", () => {
    const options = resolveComposerModelOptions([
      { id: "gpt-5-mini", name: "gpt-5-mini" },
      { id: "deepseek-chat", name: "deepseek-chat" },
    ]);

    expect(options.imageModelOptions).toEqual(defaultImageModelOptions);
    expect(options.videoModelOptions.map((option) => option.id)).toEqual([
      "gpt-5-mini",
      "deepseek-chat",
    ]);
  });

  it("detects image and video models from runtime models", () => {
    const options = resolveComposerModelOptions([
      { id: "gpt-image-2-4k", name: "gpt-image-2-4k" },
      { id: "grok-image", name: "grok-image" },
      { id: "grok-imagine-image", name: "grok-imagine-image" },
      { id: "nano-banana-2-4k", name: "nano-banana-2-4k" },
      { id: "seedream-4.0", name: "Seedream 4.0" },
      { id: "doubao-video", name: "Doubao Video" },
      {
        id: "doubao-seedance-2.0-fast-1080p",
        name: "doubao-seedance-2.0-fast-1080p",
      },
      { id: "grok-imagine-video", name: "grok-imagine-video" },
      { id: "sora-2-12s", name: "sora-2-12s" },
      { id: "veo-3", name: "Veo 3" },
    ]);

    expect(options.imageModelOptions.map((option) => option.id)).toEqual([
      "gpt-image-2-4k",
      "grok-image",
      "nano-banana-2-4k",
      "seedream-4.0",
    ]);
    expect(options.videoModelOptions.map((option) => option.id)).toEqual([
      "doubao-video",
      "doubao-seedance-2.0-fast-1080p",
      "grok-imagine-video",
      "sora-2-12s",
      "veo-3",
    ]);
  });

  it("normalizes invalid selected model ids", () => {
    const runtimeOptions = resolveComposerModelOptions([
      { id: "flux-dev", name: "Flux Dev" },
      { id: "seedance-1.0-pro", name: "Seedance 1.0 Pro" },
    ]);

    const settings = normalizeComposerSettings(
      {
        ...createDefaultComposerSettings(),
        imageModel: "missing-image-model",
        videoModel: "missing-video-model",
      },
      runtimeOptions,
    );

    expect(settings.imageModel).toBe("flux-dev");
    expect(settings.videoModel).toBe("seedance-1.0-pro");
  });

  it("keeps image output format fixed to png", () => {
    const settings = normalizeComposerSettings({
      ...createDefaultComposerSettings(),
      imageFormat: "webp",
    });

    expect(imageFormatOptions.map((option) => option.id)).toEqual(["png"]);
    expect(settings.imageFormat).toBe("png");
  });

  it("preserves reference images while normalizing models", () => {
    const settings = normalizeComposerSettings({
      ...createDefaultComposerSettings(),
      mode: "image",
      referenceImages: [
        {
          url: "https://example.com/reference.png",
          width: 1024,
          height: 1024,
          format: "png",
        },
      ],
    });

    expect(settings.referenceImages).toEqual([
      {
        url: "https://example.com/reference.png",
        width: 1024,
        height: 1024,
        format: "png",
      },
    ]);
  });

  it("migrates legacy single reference image into referenceImages", () => {
    const settings = normalizeComposerSettings({
      ...createDefaultComposerSettings(),
      mode: "image",
      referenceImage: {
        url: "https://example.com/reference.png",
        width: 1024,
        height: 1024,
        format: "png",
      },
    });

    expect(settings.referenceImages).toEqual([
      {
        url: "https://example.com/reference.png",
        width: 1024,
        height: 1024,
        format: "png",
      },
    ]);
  });
});
