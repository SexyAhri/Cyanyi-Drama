import { describe, expect, it } from "vitest";

import type { AgentToolCall } from "@/lib/agent/types";

import { getMediaToolPresentation } from "./media-tool-card-data";

describe("media tool card presentation", () => {
  it("exposes an image result without visible request parameters", () => {
    const presentation = getMediaToolPresentation(
      toolCall("image_generation", "done", {
        images: [
          {
            url: "https://example.com/image.png",
            width: 1024,
            height: 1024,
            format: "png",
          },
        ],
      }),
    );

    expect(presentation).toMatchObject({
      assetUrl: "https://example.com/image.png",
      kind: "image",
      lifecycle: "success",
    });
    expect(presentation).not.toHaveProperty("model");
    expect(presentation).not.toHaveProperty("prompt");
    expect(presentation).not.toHaveProperty("ratio");
    expect(presentation).not.toHaveProperty("requestParams");
  });

  it("does not invent progress while video generation is running", () => {
    const presentation = getMediaToolPresentation(
      toolCall("video_generation", "running"),
    );
    expect(presentation).toMatchObject({
      kind: "video",
      lifecycle: "running",
    });
    expect(presentation).not.toHaveProperty("progress");
  });

  it("treats a completed tool without media as an error state", () => {
    expect(
      getMediaToolPresentation(toolCall("image_generation", "done")),
    ).toMatchObject({ lifecycle: "error" });
  });
});

function toolCall(
  name: AgentToolCall["name"],
  status: AgentToolCall["status"],
  result?: unknown,
): AgentToolCall {
  return {
    id: "tool-1",
    name,
    status,
    args: {
      model: "hidden-model",
      prompt: "hidden prompt",
      ratio: "9:16",
      resolution: "2k",
      requestParams: { quality: "high" },
    },
    result,
  };
}
