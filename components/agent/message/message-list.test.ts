import { describe, expect, it } from "vitest";

import type { AgentMessage } from "../../../lib/agent/types";

import { groupMessagesWithToolCards } from "./message-groups";

describe("groupMessagesWithToolCards", () => {
  it("embeds media tool cards into the following assistant message", () => {
    const messages: AgentMessage[] = [
      createUserMessage("user_1"),
      createToolMessage("tool_1"),
      createAssistantMessage("assistant_1"),
    ];

    const groups = groupMessagesWithToolCards(messages);

    expect(groups).toHaveLength(2);
    expect(groups[1].message?.id).toBe("assistant_1");
    expect(groups[1].toolMessages.map((message) => message.id)).toEqual([
      "tool_1",
    ]);
  });

  it("embeds media tool cards into the previous assistant message", () => {
    const messages: AgentMessage[] = [
      createUserMessage("user_1"),
      createAssistantMessage("assistant_1"),
      createToolMessage("tool_1"),
    ];

    const groups = groupMessagesWithToolCards(messages);

    expect(groups).toHaveLength(2);
    expect(groups[1].message?.id).toBe("assistant_1");
    expect(groups[1].toolMessages.map((message) => message.id)).toEqual([
      "tool_1",
    ]);
  });
});

function createUserMessage(id: string): AgentMessage {
  return {
    id,
    role: "user",
    content: "Generate an image",
  };
}

function createAssistantMessage(id: string): AgentMessage {
  return {
    id,
    role: "assistant",
    content: "Image generated.",
  };
}

function createToolMessage(id: string): AgentMessage {
  return {
    id,
    role: "tool",
    content: "",
    toolCall: {
      id,
      name: "image_generation",
      args: {
        prompt: "Generate an image",
      },
      status: "done",
      result: {
        images: [
          {
            url: "data:image/png;base64,abc",
          },
        ],
      },
    },
  };
}
