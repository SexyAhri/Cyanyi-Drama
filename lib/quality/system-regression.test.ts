import { describe, expect, it } from "vitest";

import { createMediaTask } from "@/lib/media/task-contract";
import {
  createWorkflowStepTraceContext,
  createWorkflowTraceContext,
} from "@/lib/observability/trace-context";
import { assertPromptCanaries } from "@/lib/prompts/canary";
import { normalizeRenderSpecification } from "@/lib/providers/local/render-spec";
import {
  assertMediaTaskOutputBehavior,
  assertTimelineRenderBehavior,
} from "./behavior-guards";

describe("M6 system regression", () => {
  it("guards prompt, trace, media output, and mixed render boundaries together", () => {
    expect(assertPromptCanaries().passed).toBe(true);
    const run = createWorkflowTraceContext("run-system");
    const step = createWorkflowStepTraceContext({
      runId: "run-system",
      stepId: "step-render",
      parent: run,
    });
    const task = createMediaTask({
      id: "task-render",
      kind: "video",
      provider: "local",
      protocol: "openai-compatible",
      model: "timeline-render",
      request: { operation: "render_timeline" },
      traceParent: step,
    });
    const output = [
      {
        id: "asset-render",
        kind: "video" as const,
        url: "data:video/mp4;base64,AAAA",
      },
    ];
    expect(() =>
      assertMediaTaskOutputBehavior({ taskKind: task.kind, output }),
    ).not.toThrow();
    const specification = normalizeRenderSpecification({
      resolution: "1080p",
      aspectRatio: "9:16",
    });
    expect(() =>
      assertTimelineRenderBehavior({
        specification,
        segments: [
          {
            url: "https://example.com/clip.webm",
            panelIndex: 0,
            kind: "video",
          },
          {
            url: "https://example.com/frame.png",
            panelIndex: 1,
            kind: "image",
            durationSeconds: 3,
          },
        ],
      }),
    ).not.toThrow();
    expect(task.traceId).toBe(run.traceId);
    expect(task.parentSpanId).toBe(step.spanId);
    expect(specification).toMatchObject({ width: 1080, height: 1920 });
  });
});
