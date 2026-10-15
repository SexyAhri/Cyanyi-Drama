import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), enqueue: vi.fn() }));
vi.mock("@/lib/server/auth", () => ({ ensureAnonymousUser: vi.fn().mockResolvedValue({ user: { id: "owner" }, sessionId: null }), attachSessionCookie: (r: Response) => r }));
vi.mock("@/lib/settings/runtime-store", () => ({ loadUserRuntimeSettings: vi.fn().mockResolvedValue({ workflowStepMaxAttempts: 3 }) }));
vi.mock("@/lib/queue/workflow-queue", () => ({ enqueueWorkflowJob: mocks.enqueue }));
vi.mock("@/lib/workflow/store", () => ({ createOrReuseWorkflowRun: mocks.create, getWorkflowRun: mocks.get }));
import { POST } from "./route";
const context = { params: Promise.resolve({ projectId: "project", episodeId: "episode", panelId: "panel" }) };
const body = { channelId: "channel", model: "vision", kind: "video", action: "review-video" };
const call = (input: unknown) => POST(new Request("http://localhost/test", { method: "POST", body: JSON.stringify(input) }), context);
beforeEach(() => { vi.clearAllMocks(); mocks.create.mockResolvedValue({ workflow: { id: "run" }, reused: false }); mocks.get.mockResolvedValue({ status: "succeeded", output: { review: { summary: "sample only" }, trace: {} } }); });
describe("prompt design and visual diagnosis API", () => {
  it("rejects client URLs, snapshots and unknown fields before creating a task", async () => {
    for (const field of ["capturedContext", "imageUrls", "videoAssetId"]) expect((await call({ ...body, [field]: "foreign" })).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("creates an owner-scoped, explicit diagnosis without automatic paid retries", async () => {
    expect((await call(body)).status).toBe(200);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ userId: "owner", projectId: "project", episodeId: "episode", targetId: "panel", workflowType: "storyboard-video-review", steps: [{ type: "review_storyboard_video", retryable: false, maxAttempts: 1 }] });
    expect(mocks.enqueue).toHaveBeenCalledOnce();
  });
  it("returns accepted task identity immediately for background polling", async () => {
    const response = await call({ ...body, async: true });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ pending: true, workflowId: "run" });
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("surfaces missing ownership and failure without a success result", async () => {
    mocks.create.mockResolvedValueOnce(null);
    expect((await call(body)).status).toBe(404);
    mocks.create.mockRejectedValueOnce(Object.assign(new Error("forbidden"), { status: 403 }));
    expect((await call(body)).status).toBe(403);
    mocks.get.mockResolvedValueOnce({ status: "failed", error: { message: "VISION_MODEL_REQUIRED" } });
    const response = await call(body);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ message: "VISION_MODEL_REQUIRED", workflowId: "run" });
  });
});
