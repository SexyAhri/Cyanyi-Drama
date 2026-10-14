import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), attach: vi.fn(), getProject: vi.fn(), updateProject: vi.fn(), deleteProject: vi.fn(),
}));
vi.mock("@/lib/server/auth", () => ({ ensureAnonymousUser: mocks.auth, attachSessionCookie: mocks.attach }));
vi.mock("@/lib/projects/queries", () => ({ getProject: mocks.getProject, updateProject: mocks.updateProject, deleteProject: mocks.deleteProject }));

import { DELETE, GET, PATCH } from "./route";

const context = { params: Promise.resolve({ projectId: "project-1" }) };
const request = (method: string, body?: unknown) => new Request("http://localhost/api/projects/project-1", {
  method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner" }, sessionId: "session" });
  mocks.attach.mockImplementation((response) => response);
  mocks.getProject.mockResolvedValue({ id: "project-1", name: "Owned project", description: "" });
  mocks.updateProject.mockResolvedValue({ id: "project-1", name: "Updated", description: "" });
});

describe("project page API ownership", () => {
  it("scopes project reads, updates, and deletes to the authenticated owner", async () => {
    expect((await GET(new Request("http://localhost"), context)).status).toBe(200);
    await PATCH(request("PATCH", { name: "Updated" }), context);
    await DELETE(request("DELETE"), context);
    expect(mocks.getProject).toHaveBeenCalledTimes(3);
    for (const [userId, projectId] of mocks.getProject.mock.calls) expect([userId, projectId]).toEqual(["owner", "project-1"]);
    expect(mocks.updateProject).toHaveBeenCalledWith("owner", "project-1", { name: "Updated", description: null });
    expect(mocks.deleteProject).toHaveBeenCalledWith("owner", "project-1");
  });

  it("hides another user's project consistently across reads and mutations", async () => {
    mocks.getProject.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost"), context)).status).toBe(404);
    expect((await PATCH(request("PATCH", { name: "Takeover" }), context)).status).toBe(404);
    expect((await DELETE(request("DELETE"), context)).status).toBe(404);
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(mocks.deleteProject).not.toHaveBeenCalled();
  });
});
