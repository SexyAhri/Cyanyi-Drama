import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), attach: vi.fn(), get: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/server/auth", () => ({ ensureAnonymousUser: mocks.auth, attachSessionCookie: mocks.attach }));
vi.mock("@/lib/billing/media-budget", () => ({
  getMediaBudgetSummary: mocks.get,
  setMediaBudgetLimit: mocks.set,
  MediaBudgetError: class MediaBudgetError extends Error { status = 400; },
}));

import { GET, PUT } from "./route";

const context = { params: Promise.resolve({ projectId: "project-1" }) };
const request = (body: unknown) => new Request("http://localhost/api/projects/project-1/media-budget", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("project media budget API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "owner" }, sessionId: "session" });
    mocks.attach.mockImplementation((response) => response);
    mocks.get.mockResolvedValue({ configured: true, limit: "10", actual: "3", reserved: "2", remaining: "5", exceeded: false });
    mocks.set.mockResolvedValue({ configured: true, limit: "10", actual: "3", reserved: "2", remaining: "5", exceeded: false });
  });

  it("loads the caller's project budget or a specific batch budget", async () => {
    expect((await GET(new Request("http://localhost/api/projects/project-1/media-budget?batchId=batch-1"), context)).status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith({ userId: "owner", projectId: "project-1", scope: { type: "batch", id: "batch-1" } });
  });

  it("saves and clears budget limits only through the authenticated owner scope", async () => {
    expect((await PUT(request({ limit: "25.50" }), context)).status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith({ userId: "owner", projectId: "project-1", scope: { type: "project", id: "project-1" }, limit: "25.50" });
    expect((await PUT(request({ limit: null, batchId: "batch-1" }), context)).status).toBe(200);
    expect(mocks.set).toHaveBeenLastCalledWith({ userId: "owner", projectId: "project-1", scope: { type: "batch", id: "batch-1" }, limit: null });
    expect(mocks.attach).toHaveBeenCalledWith(expect.any(Response), "session");
  });

  it("rejects malformed limits before writing", async () => {
    expect((await PUT(request({ limit: -1 }), context)).status).toBe(400);
    expect((await PUT(request({ limit: "0.0000001" }), context)).status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
