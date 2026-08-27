import { describe, expect, it } from "vitest";

import type { StudioModelOption } from "../types";
import { getStudioModelName } from "./model-select";

describe("studio model labels", () => {
  it("removes a channel suffix already included in the model name", () => {
    expect(
      getStudioModelName(model({ name: "gk/grok-4.6 · 新增渠道" })),
    ).toBe("gk/grok-4.6");
  });

  it("keeps a distinct friendly model name", () => {
    expect(getStudioModelName(model({ name: "Storyboard Fast" }))).toBe(
      "Storyboard Fast",
    );
  });
});

function model(input: { name: string }): StudioModelOption {
  return {
    id: "channel-1::gk/grok-4.6",
    channelId: "channel-1",
    channelName: "新增渠道",
    modelId: "gk/grok-4.6",
    name: input.name,
    type: "llm",
    modalities: ["text"],
  };
}
