import { describe, expect, it } from "vitest";

import { buildVideoProviderContract } from "./video-contract";

describe("video provider contract", () => {
  it("preserves first and last frame roles for Ark", () => {
    const contract = buildVideoProviderContract({
      protocol: "volcengine-ark",
      model: "seedance",
      request: { prompt: "move", resolution: "2k", duration: "6s" },
      references: [
        { url: "data:image/png;base64,first", role: "first_frame" },
        { url: "data:image/png;base64,last", role: "last_frame" },
      ],
    });
    expect(contract.createPath).toBe("contents/generations/tasks");
    expect(contract.body).toMatchObject({ resolution: "1080p", duration: 6 });
    expect(contract.body.content).toEqual([
      { type: "text", text: "move" },
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,first" },
        role: "first_frame",
      },
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,last" },
        role: "last_frame",
      },
    ]);
  });

  it("maps first-last frames for OpenAI-compatible providers", () => {
    const contract = buildVideoProviderContract({
      protocol: "openai-compatible",
      model: "video-model",
      request: { prompt: "move", ratio: "16:9", videoMode: "first-last" },
      references: [
        { url: "https://cdn/first.png", role: "first_frame" },
        { url: "https://cdn/last.png", role: "last_frame" },
        { url: "https://cdn/ref.png", role: "reference_image" },
      ],
      createPath: "/videos/generations/",
      statusPath: "/videos/generations/{id}",
    });
    expect(contract.body).toMatchObject({
      first_frame: "https://cdn/first.png",
      last_frame: "https://cdn/last.png",
      image: ["https://cdn/ref.png"],
      size: "1792x1024",
    });
    expect(contract.createPath).toBe("videos/generations");
    expect(contract.statusPath("a/b")).toBe("videos/generations/a%2Fb");
  });
});
