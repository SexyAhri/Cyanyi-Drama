import type { AgentEvent } from "@/lib/agent/types";

const AGENT_EVENT_STREAM_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

export function createAgentEventStreamResponse(
  events: AsyncIterable<AgentEvent>,
) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (error) {
        controller.error(error);
        return;
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": AGENT_EVENT_STREAM_CONTENT_TYPE,
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

export async function* readAgentEventStream(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<AgentEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed) {
          yield JSON.parse(trimmed) as AgentEvent;
        }
      }
    }

    buffer += decoder.decode();
    const trimmed = buffer.trim();

    if (trimmed) {
      yield JSON.parse(trimmed) as AgentEvent;
    }
  } finally {
    reader.releaseLock();
  }
}
