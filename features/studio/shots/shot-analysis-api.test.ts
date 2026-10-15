import { afterEach, describe, expect, it, vi } from "vitest";
import { designStudioPanelPrompt, reviewStudioPanelVideo } from "../api";
const input = { channelId: "channel", model: "vision", locale: "zh" as const };
afterEach(() => vi.unstubAllGlobals());
describe("asynchronous shot analysis client", () => {
  it("submits once, polls uncached authorized workflow output, and does not apply media", async () => {
    const output = { review: { summary: "sample-only", findings: [], limitations: ["not audio"] }, videoAssetId: "video" };
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ pending: true, workflowId: "run" }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ workflow: { status: "succeeded", output } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await reviewStudioPanelVideo("project", "episode", "panel", input)).toMatchObject({ ...output, workflowId: "run" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ action: "review-video", kind: "video", async: true });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/workflows/run");
    expect(fetchMock.mock.calls[1][1].cache).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("retains task identity on failure and stops local waiting when dismissed", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ pending: true, workflowId: "run" }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ workflow: { status: "failed", error: { message: "实际模型不支持图片" } } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(designStudioPanelPrompt("p", "e", "s", { ...input, kind: "video" })).rejects.toThrow("实际模型不支持图片 (run)");
    fetchMock.mockResolvedValueOnce(Response.json({ pending: true, workflowId: "background-run" }, { status: 202 }));
    const controller = new AbortController(); controller.abort();
    await expect(reviewStudioPanelVideo("p", "e", "s", input, controller.signal)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
