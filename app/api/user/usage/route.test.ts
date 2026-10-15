import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ ensure: vi.fn(), attach: vi.fn((response: Response) => response), list: vi.fn() }));
vi.mock("@/lib/server/auth", () => ({ ensureAnonymousUser: mocks.ensure, attachSessionCookie: mocks.attach }));
vi.mock("@/lib/billing/usage-records-store", () => ({ listUsageRecords: mocks.list }));
import { GET } from "./route";

describe("personal model usage route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensure.mockResolvedValue({ user: { id: "current-user" }, sessionId: "s1" });
    mocks.list.mockResolvedValue({ costs: [], summary: { count: 0, cost: "0" } });
  });
  it("always passes the session identity, never a requested user identity", async () => {
    const response = await GET(new Request("http://localhost/api/user/usage?userId=someone-else&page=2"));
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(expect.any(URLSearchParams), "current-user");
    expect(mocks.attach).toHaveBeenCalledWith(response, "s1");
  });
});
