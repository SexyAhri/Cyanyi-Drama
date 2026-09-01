import { afterEach, describe, expect, it, vi } from "vitest";

import { adaptStudioEpisode } from "./api";

describe("studio adaptation stream", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards live content and resolves the completed source", async () => {
    const source = {
      id: "source-adapted-1",
      content: "完整改编稿",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          [
            JSON.stringify({ type: "started", workflowId: "workflow-1" }),
            JSON.stringify({ type: "phase", phase: "generating" }),
            JSON.stringify({ type: "reset" }),
            JSON.stringify({ type: "delta", delta: "第一段" }),
            JSON.stringify({ type: "phase", phase: "saving" }),
            JSON.stringify({ type: "delta", delta: "\n第二段" }),
            JSON.stringify({ type: "completed", source }),
            "",
          ].join("\n"),
          { status: 200 },
        ),
      ),
    );
    const onReset = vi.fn();
    const onContent = vi.fn();
    const onPhase = vi.fn();
    const onWorkflowStarted = vi.fn();

    const result = await adaptStudioEpisode(
      "project-1",
      "episode-1",
      {
        channelId: "channel-1",
        model: "model-1",
        mode: "polish",
        locale: "zh",
      },
      { onReset, onContent, onPhase, onWorkflowStarted },
    );

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onContent.mock.calls.map(([content]) => content)).toEqual([
      "第一段",
      "第一段\n第二段",
    ]);
    expect(onPhase.mock.calls.map(([phase]) => phase)).toEqual([
      "generating",
      "saving",
    ]);
    expect(onWorkflowStarted).toHaveBeenCalledWith("workflow-1");
    expect(result.source).toEqual(source);
  });

  it("surfaces a streamed workflow failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          `${JSON.stringify({
            type: "failed",
            message: "模型请求失败，请在任务列表重试。",
          })}\n`,
          { status: 200 },
        ),
      ),
    );

    await expect(
      adaptStudioEpisode("project-1", "episode-1", {
        channelId: "channel-1",
        model: "model-1",
        mode: "polish",
        locale: "zh",
      }),
    ).rejects.toThrow("模型请求失败，请在任务列表重试");
  });
});
