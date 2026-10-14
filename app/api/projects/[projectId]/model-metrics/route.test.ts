import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  attach: vi.fn(),
  getMetrics: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  ensureAnonymousUser: mocks.auth,
  attachSessionCookie: mocks.attach,
}));
vi.mock("@/lib/observability/project-model-metrics", () => ({
  getProjectModelMetrics: mocks.getMetrics,
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ projectId: "project-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user-1" }, sessionId: "session-1" });
  mocks.attach.mockImplementation((response) => response);
  mocks.getMetrics.mockResolvedValue({ windowDays: 30, sampled: false, rows: [] });
});

describe("project model metrics API", () => {
  it("requests metrics within the authenticated user and project scope", async () => {
    const response = await GET(new Request("http://localhost"), context);
    expect(response.status).toBe(200);
    expect(mocks.getMetrics).toHaveBeenCalledWith("user-1", "project-1");
    await expect(response.json()).resolves.toEqual({ metrics: { windowDays: 30, sampled: false, rows: [] } });
  });

  it("returns 404 for an inaccessible or missing project", async () => {
    mocks.getMetrics.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost"), context);
    expect(response.status).toBe(404);
  });
});
