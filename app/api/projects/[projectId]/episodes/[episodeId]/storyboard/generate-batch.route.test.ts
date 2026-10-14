import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  attach: vi.fn(),
  createTask: vi.fn(),
  settings: vi.fn(),
  preflight: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({ ensureAnonymousUser: mocks.auth, attachSessionCookie: mocks.attach }));
vi.mock("@/lib/media/project-asset-tasks", () => ({
  createStoryboardPanelImageTask: mocks.createTask,
  parseGenerationIterationDiagnostics: vi.fn((value) => value),
  ProjectAssetTaskError: class ProjectAssetTaskError extends Error { status = 400; },
}));
vi.mock("@/lib/settings/runtime-store", () => ({ loadUserRuntimeSettings: mocks.settings }));
vi.mock("@/lib/media/storyboard-batch-preflight", () => ({ preflightStoryboardBatch: mocks.preflight }));

import { POST } from "./generate-batch/route";

describe("storyboard batch submission preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "owner" }, sessionId: "session" });
    mocks.attach.mockImplementation((response) => response);
    mocks.settings.mockResolvedValue({});
    mocks.preflight.mockResolvedValue({
      items: [{ panelId: "panel-1", preview: null, issues: [{ blocking: true, code: "missing_prompt", message: "缺少图片提示词" }] }],
      blockers: [{ blocking: true, code: "missing_prompt", message: "缺少图片提示词" }],
      quota: { status: "unknown", availableCredits: null, estimatedCredits: null, providerBalance: "unavailable" },
    });
  });

  it("returns all server blockers without creating or enqueueing any task", async () => {
    const request = new Request("http://localhost/api/projects/project/episodes/episode/storyboard/generate-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId: "channel", model: "image-model", items: [{ panelId: "panel-1" }] }),
    });
    const response = await POST(request, { params: Promise.resolve({ projectId: "project", episodeId: "episode" }) });
    expect(response.status).toBe(409);
    expect((await response.json()).preflight.blockers).toHaveLength(1);
    expect(mocks.preflight).toHaveBeenCalledTimes(1);
    expect(mocks.createTask).not.toHaveBeenCalled();
  });
});
