import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("@/lib/studio/agent-production-actions", () => ({ startStudioProductionAction: mocks.start }));
vi.mock("@/lib/server/auth", () => ({
  ensureAnonymousUser: async () => ({ user: { id: "owner" }, sessionId: null }),
  attachSessionCookie: (response: Response) => response,
}));
import { POST } from "./route";
import { StoryPackageGenerationError } from "@/lib/production/story-package-generation";

const context = { params: Promise.resolve({ projectId: "project" }) };
const request = (body: unknown) => new Request("http://localhost/api/story-package", { method: "POST", body: JSON.stringify(body) });
const body = { channelId: "channel", model: "model", setup: { storyIdea: "雪地山洞安家", episodeCount: 100 } };
beforeEach(() => vi.resetAllMocks());
describe("background story-package submission", () => {
  it("returns 202 and task metadata without claiming a saved package", async () => {
    mocks.start.mockResolvedValue({ submitted: true, workflowId: "run", status: "queued", reused: false });
    const response = await POST(request(body), context);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ submitted: true, workflowId: "run", status: "queued", reused: false });
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", projectId: "project", targetId: "project", operation: "start_story_package_generation" }));
  });
  it("rejects invalid settings and preserves project access errors", async () => {
    expect((await POST(request({ ...body, setup: { episodeCount: 101 } }), context)).status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
    mocks.start.mockRejectedValue(new StoryPackageGenerationError("项目不存在", 404));
    expect((await POST(request(body), context)).status).toBe(404);
  });
});
