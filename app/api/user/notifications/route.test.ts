import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), attach: vi.fn(), findMany: vi.fn(), count: vi.fn(), findPreference: vi.fn(),
  updateMany: vi.fn(), upsert: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({ ensureAnonymousUser: mocks.auth, attachSessionCookie: mocks.attach }));
vi.mock("@/lib/server/prisma", () => ({ prisma: { executionNotification: { findMany: mocks.findMany, count: mocks.count, updateMany: mocks.updateMany }, executionNotificationPreference: { findUnique: mocks.findPreference, upsert: mocks.upsert } } }));

import { GET, PATCH } from "./route";

const patchRequest = (body: unknown) => new Request("http://localhost/api/user/notifications", {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner" }, sessionId: "session" });
  mocks.attach.mockImplementation((response) => response);
  mocks.findMany.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0);
  mocks.findPreference.mockResolvedValue(null);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.upsert.mockResolvedValue({});
});

describe("execution notification API", () => {
  it("returns only the authenticated user's notifications and default preferences", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "owner" }, take: 30 }));
    expect(mocks.count).toHaveBeenCalledWith({ where: { userId: "owner", readAt: null } });
    await expect(response.json()).resolves.toMatchObject({ preferences: { completedEnabled: true, partialFailureEnabled: true, actionRequiredEnabled: true } });
  });

  it("scopes read changes to the authenticated user", async () => {
    const response = await PATCH(patchRequest({ action: "read", id: "notice-1" }));
    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "notice-1", userId: "owner", readAt: null } }));
  });

  it("persists notification preferences and rejects malformed writes", async () => {
    const response = await PATCH(patchRequest({ action: "preferences", completedEnabled: false, partialFailureEnabled: true, actionRequiredEnabled: false }));
    expect(response.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "owner" },
      create: expect.objectContaining({ userId: "owner", completedEnabled: false, actionRequiredEnabled: false }),
    }));
    expect((await PATCH(patchRequest({ action: "preferences", completedEnabled: "no" }))).status).toBe(400);
  });
});
