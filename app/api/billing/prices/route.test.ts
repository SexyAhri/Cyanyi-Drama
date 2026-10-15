import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), save: vi.fn(), disable: vi.fn() }));
vi.mock("@/lib/server/auth", () => ({
  requireAdmin: mocks.admin,
  AdminRequiredError: class AdminRequiredError extends Error {},
  attachSessionCookie: (response: Response) => response,
  ensureAnonymousUser: vi.fn(),
}));
vi.mock("@/lib/server/prisma", () => ({ prisma: { modelPrice: { updateMany: mocks.disable } } }));
vi.mock("@/lib/billing/service", async () => {
  const { validatePricePlan } = await import("@/lib/billing/pricing-contract");
  class BillingError extends Error { status = 400; }
  return { BillingError, listModelPrices: vi.fn(), saveModelPricePlan: async (input: { capability: string; rates: Array<{ unit: string; unitPrice: string }> }) => {
    try { validatePricePlan(input.capability, input.rates); } catch (error) { throw new BillingError(String(error)); }
    return mocks.save(input);
  } };
});
import { AdminRequiredError } from "@/lib/server/auth";
import { DELETE, PUT } from "./route";

const rates = ["1m_input_tokens", "1m_output_tokens", "1m_cached_input_tokens"].map(unit => ({ unit, unitPrice: "0" }));
const put = (value: unknown) => PUT(new Request("http://localhost/api/billing/prices", { method: "PUT", body: JSON.stringify(value) }));
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue({ id: "admin" }); mocks.save.mockResolvedValue(rates); });

describe("model price plan API", () => {
  it("checks admin before parsing or writing prices for either mutation", async () => {
    mocks.admin.mockRejectedValue(new AdminRequiredError());
    const request = new Request("http://localhost/api/billing/prices", { method: "PUT", body: "invalid json" });
    expect((await PUT(request)).status).toBe(403);
    expect(request.bodyUsed).toBe(false);
    expect((await DELETE(new Request("http://localhost/api/billing/prices?id=p"))).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.disable).not.toHaveBeenCalled();
  });
  it("saves the complete explicit-zero token plan in one service call", async () => {
    const body = { provider: "custom", model: "fixture", capability: "text", rates };
    expect((await put(body)).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(body);
  });
  it("rejects incomplete, mixed and malformed plans before saving", async () => {
    for (const invalid of [null, [], "not an object"]) expect((await put(invalid)).status).toBe(400);
    for (const invalid of [[], rates.slice(0, 2), [...rates, { unit: "request", unitPrice: 1 }], [{ unit: "request" }]]) {
      expect((await put({ provider: "custom", model: "fixture", capability: "text", rates: invalid })).status).toBe(400);
    }
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("returns 400 for an empty or truncated JSON request without writing prices", async () => {
    for (const body of ["", '{"rates":']) {
      const response = await PUT(new Request("http://localhost/api/billing/prices", { method: "PUT", body }));
      expect(response.status).toBe(400);
    }
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("deactivates the entire plan without deleting historical rows", async () => {
    expect((await DELETE(new Request("http://localhost/api/billing/prices?provider=custom&model=fixture&capability=text"))).status).toBe(200);
    expect(mocks.disable).toHaveBeenCalledExactlyOnceWith({ where: { provider: "custom", model: "fixture", capability: "text" }, data: { active: false } });
  });
});
