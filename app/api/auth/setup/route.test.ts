import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialAdminSchema } from "@/lib/auth/initial-setup";

const mocks = vi.hoisted(() => ({ initialize: vi.fn() }));
vi.mock("@/lib/server/initial-admin", () => ({ initializeAdmin: mocks.initialize }));
import { POST } from "./route";

const valid = { displayName: "管理员", email: "admin@example.com", password: "test-password", confirmPassword: "test-password" };
function request(body = JSON.stringify(valid), headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/auth/setup", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", ...headers }, body });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.initialize.mockResolvedValue({ user: { id: "admin", role: "ADMIN" }, sessionId: "token" });
});
afterEach(() => vi.unstubAllEnvs());

describe("initial administrator endpoint", () => {
  it("returns a committed admin with an HttpOnly session", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("cyanyi_session=token; Path=/; HttpOnly; SameSite=Lax");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ user: { id: "admin", role: "ADMIN" } });
  });
  it.each<Record<string, string>>([{ origin: "https://attacker.example" }, { origin: "null" }, { origin: "" }, { "sec-fetch-site": "cross-site" }])("rejects untrusted origin %j", async (headers) => {
    expect((await POST(request(undefined, headers))).status).toBe(403);
    expect(mocks.initialize).not.toHaveBeenCalled();
  });
  it("accepts the explicitly configured public origin behind a proxy", async () => {
    vi.stubEnv("APP_BASE_URL", "https://drama.example.com/");
    expect((await POST(request(undefined, { origin: "https://drama.example.com" }))).status).toBe(201);
  });
  it("rejects form posts, malformed JSON and oversized bodies", async () => {
    expect((await POST(request("x=1", { "content-type": "application/x-www-form-urlencoded" }))).status).toBe(415);
    expect((await POST(request("{"))).status).toBe(400);
    expect((await POST(request(" ".repeat(8193)))).status).toBe(413);
    expect(mocks.initialize).not.toHaveBeenCalled();
  });
  it("returns validation errors without issuing a session", async () => {
    mocks.initialize.mockImplementation((input) => initialAdminSchema.parse(input));
    const response = await POST(request(JSON.stringify({ ...valid, confirmPassword: "different" })));
    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ message: "两次输入的密码不一致" });
  });
  it("returns a recoverable conflict for stale forms", async () => {
    mocks.initialize.mockRejectedValue(new Error("INITIAL_SETUP_COMPLETED"));
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toMatchObject({ code: "INITIAL_SETUP_COMPLETED" });
  });
  it("does not leak database errors or pretend a failed write succeeded", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.initialize.mockRejectedValue(new Error("private database detail"));
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.text()).not.toContain("private database detail");
    } finally { log.mockRestore(); }
  });
});
