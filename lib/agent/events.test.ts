import { describe, expect, it } from "vitest";

import { AgentEventMergeError, mergeAgentEvent } from "./events";
import type { AgentMessage } from "./types";

describe("mergeAgentEvent", () => {
  it("creates and streams assistant messages", () => {
    const messages = mergeAgentEvent([], {
      type: "message.created",
      message: {
        id: "msg_1",
        role: "assistant",
        content: "",
      },
    });

    const withDelta = mergeAgentEvent(messages, {
      type: "message.delta",
      messageId: "msg_1",
      delta: "hello",
    });

    expect(withDelta[0].content).toBe("hello");
  });

  it("updates tool status and result", () => {
    const messages: AgentMessage[] = [
      {
        id: "msg_tool",
        role: "tool",
        content: "",
      },
    ];

    const pending = mergeAgentEvent(messages, {
      type: "tool.pending",
      messageId: "msg_tool",
      toolCall: {
        id: "tool_1",
        name: "image_generation",
        args: { prompt: "hello" },
        status: "pending",
      },
    });
    const running = mergeAgentEvent(pending, {
      type: "tool.running",
      messageId: "msg_tool",
      toolCallId: "tool_1",
    });
    const done = mergeAgentEvent(running, {
      type: "tool.done",
      messageId: "msg_tool",
      toolCallId: "tool_1",
      result: { ok: true },
    });

    expect(done[0].toolCall?.status).toBe("done");
    expect(done[0].toolCall?.result).toEqual({ ok: true });
  });

  it("keeps request details on tool errors", () => {
    const pending = mergeAgentEvent(
      [
        {
          id: "msg_tool",
          role: "tool",
          content: "",
        },
      ],
      {
        type: "tool.pending",
        messageId: "msg_tool",
        toolCall: {
          id: "tool_1",
          name: "image_generation",
          args: { prompt: "hello" },
          status: "pending",
        },
      },
    );

    const errored = mergeAgentEvent(pending, {
      type: "tool.error",
      messageId: "msg_tool",
      toolCallId: "tool_1",
      error: "provider rejected",
      result: {
        requestParams: {
          endpoint: "images/generations",
          model: "grok-image",
        },
      },
    });

    expect(errored[0].toolCall?.status).toBe("error");
    expect(errored[0].toolCall?.error).toBe("provider rejected");
    expect(errored[0].toolCall?.result).toEqual({
      requestParams: {
        endpoint: "images/generations",
        model: "grok-image",
      },
    });
  });

  it("throws for unknown message ids", () => {
    expect(() =>
      mergeAgentEvent([], {
        type: "message.delta",
        messageId: "missing",
        delta: "x",
      })
    ).toThrow(AgentEventMergeError);
  });
});
