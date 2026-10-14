import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  attach: vi.fn((response: Response) => response),
  list: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({ ensureAnonymousUser: mocks.ensure, attachSessionCookie: mocks.attach }));
vi.mock("@/lib/billing/service", () => ({ listUsageCosts: mocks.list }));

import { GET } from "./route";

describe("GET /api/user/costs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensure.mockResolvedValue({ user: { id: "user-1" }, sessionId: "session" });
    mocks.list.mockResolvedValue({
      costs: [{ id: "cost-1", createdAt: new Date("2026-10-14T10:00:00.000Z") }],
      hasMore: true,
      summary: { _sum: { cost: { toString: () => "3.75" }, quantity: 12 }, _count: { _all: 21 } },
    });
  });

  it("returns a scoped cursor page and a full project summary", async () => {
    const response = await GET(new Request("http://localhost/api/user/costs?projectId=p1&limit=1"));
    const body = await response.json();
    expect(mocks.list).toHaveBeenCalledWith("user-1", "p1", 1, undefined);
    expect(body.costs).toHaveLength(1);
    expect(body.nextCursor).toBeTruthy();
    expect(body.summary).toEqual({ total: "3.75", quantity: 12, count: 21 });
  });

  it("decodes the stable date/id cursor and rejects malformed cursors", async () => {
    const cursor = Buffer.from(JSON.stringify({ createdAt: "2026-10-14T10:00:00.000Z", id: "cost-1" })).toString("base64url");
    await GET(new Request(`http://localhost/api/user/costs?cursor=${cursor}`));
    expect(mocks.list.mock.calls[0][3]).toEqual({ createdAt: new Date("2026-10-14T10:00:00.000Z"), id: "cost-1" });

    const response = await GET(new Request("http://localhost/api/user/costs?cursor=bad"));
    expect(response.status).toBe(400);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
});
