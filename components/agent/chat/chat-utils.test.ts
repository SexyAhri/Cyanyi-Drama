import { describe, expect, it } from "vitest";

import type { AgentMessage } from "@/lib/agent/types";

import { canEditComposerAfterMediaToolComplete } from "./chat-utils";

describe("canEditComposerAfterMediaToolComplete", () => {
  it("unlocks composer editing after a media tool completes in the current turn", () => {
    expect(
      canEditComposerAfterMediaToolComplete([
        userMessage("make an image"),
        toolMessage("image_generation", "done"),
        assistantMessage("总结中"),
      ]),
    ).toBe(true);
  });

  it("keeps the composer locked while the current media tool is still running", () => {
    expect(
      canEditComposerAfterMediaToolComplete([
        userMessage("make an image"),
        toolMessage("image_generation", "running"),
      ]),
    ).toBe(false);
  });

  it("ignores completed media tools from earlier turns", () => {
    expect(
      canEditComposerAfterMediaToolComplete([
        userMessage("make an image"),
        toolMessage("image_generation", "done"),
        userMessage("now summarize this"),
        assistantMessage("总结中"),
      ]),
    ).toBe(false);
  });
});

function userMessage(content: string): AgentMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content,
  };
}

function assistantMessage(content: string): AgentMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content,
  };
}

function toolMessage(
  name: "image_generation" | "video_generation",
  status: "done" | "running",
): AgentMessage {
  return {
    id: crypto.randomUUID(),
    role: "tool",
    content: "",
    toolCall: {
      id: crypto.randomUUID(),
      args: {},
      name,
      status,
    },
  };
}
