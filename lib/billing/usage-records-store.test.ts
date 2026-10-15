import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ aggregate: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/server/prisma", () => ({ prisma: { usageCost: mocks } }));
import { listUsageRecords } from "./usage-records-store";

describe("usage log scopes and pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.aggregate.mockResolvedValue({ _count: 1205, _sum: { cost: new Prisma.Decimal("0.123456") } });
    mocks.findMany.mockImplementation(async (args) => args.distinct ? [{ apiType: "text" }] : [{
      id: "c1", createdAt: new Date("2026-10-15T10:37:05Z"), model: "model", apiType: "text", action: "model_request",
      quantity: new Prisma.Decimal(1100), unit: "tokens", cost: new Prisma.Decimal("0.000001"),
      metadata: JSON.stringify({ actualUsage: { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 200 }, reservationUsage: { inputTokens: 99999 } }),
      user: { id: "u1", displayName: "User" }, project: null,
    }]);
  });
  it("keeps every query scoped to the authenticated user despite an injected userId parameter", async () => {
    const result = await listUsageRecords(new URLSearchParams("userId=other&query=model&apiType=text&page=2&pageSize=20"), "u1");
    expect(mocks.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "u1", apiType: "text" }) }));
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ distinct: ["apiType"], where: { userId: "u1" } }));
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "u1" }), skip: 20, take: 20 }));
    expect(result.costs[0]).toMatchObject({ cost: "0.000001", quantity: 1100, tokens: { input: 1000, output: 100, cacheRead: 200, cacheWrite: null } });
    expect(result.costs[0]).not.toHaveProperty("metadata");
    expect(result.costs[0]).not.toHaveProperty("user.email");
  });
  it("can reach records beyond the former 300-row cap with a stable date/id order and frozen cutoff", async () => {
    const result = await listUsageRecords(new URLSearchParams("page=999&pageSize=20&asOf=2026-10-14T10:00:00.000Z&query=model"));
    expect(result).toMatchObject({ page: 61, pageSize: 20, asOf: "2026-10-14T10:00:00.000Z", summary: { count: 1205, cost: "0.123456" } });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 1200, take: 20, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      where: expect.objectContaining({ createdAt: { lte: new Date(result.asOf) }, OR: expect.arrayContaining([{ model: { contains: "model", mode: "insensitive" } }]) }),
    }));
  });
  it("bounds page sizes and treats an empty filter as a valid first page", async () => {
    mocks.aggregate.mockResolvedValue({ _count: 0, _sum: { cost: null } });
    mocks.findMany.mockResolvedValue([]);
    const result = await listUsageRecords(new URLSearchParams("page=-1&pageSize=999&asOf=bad"), "u1");
    expect(result).toMatchObject({ page: 1, pageSize: 100, costs: [], summary: { count: 0, cost: "0" } });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 100 }));
  });
});
