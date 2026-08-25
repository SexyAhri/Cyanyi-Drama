import { describe, expect, it } from "vitest";

import { createAgentEventStreamResponse, readAgentEventStream } from "./stream";
import type { AgentEvent } from "./types";

describe("agent event stream", () => {
  it("round-trips AgentEvent values as ndjson", async () => {
    const events: AgentEvent[] = [
      {
        type: "message.created",
        message: {
          id: "msg_1",
          role: "assistant",
          content: "hello",
        },
      },
      {
        type: "message.done",
        messageId: "msg_1",
      },
    ];

    const response = createAgentEventStreamResponse(toAsyncIterable(events));
    const parsed = [];

    for await (const event of readAgentEventStream(response.body!)) {
      parsed.push(event);
    }

    expect(parsed).toEqual(events);
  });
});

async function* toAsyncIterable<T>(items: T[]) {
  for (const item of items) {
    yield item;
  }
}
