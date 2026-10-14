import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  attach: vi.fn(),
  read: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock("@/lib/server/auth", () => ({
  ensureAnonymousUser: mocks.auth,
  attachSessionCookie: mocks.attach,
}));
vi.mock("@/lib/production-configuration/store", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/production-configuration/store")
  >()),
  readProductionConfiguration: mocks.read,
  mutateProductionConfiguration: mocks.mutate,
}));
import { ConfigurationError } from "@/lib/production-configuration/store";
import { GET, PUT } from "./route";
const request = (body: unknown) =>
  new Request("http://localhost/api/settings/production", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const valid = {
  action: "save",
  section: "sound",
  scope: {},
  expectedRevision: 0,
  patch: { sound: { mode: "silent" } },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner" }, sessionId: "session" });
  const values = { agents: {}, sound: { mode: "native" }, sources: [] };
  mocks.attach.mockImplementation((response) => response);
  mocks.mutate.mockResolvedValue({
    draft: {},
    version: 2,
    effective: values,
    inherited: values,
  });
  mocks.read.mockResolvedValue({
    draft: {},
    version: 2,
    effective: values,
    inherited: values,
  });
});
describe("retained management API boundaries", () => {
  it("uses session ownership and requires explicit section", async () => {
    expect((await PUT(request(valid))).status).toBe(200);
    expect(mocks.mutate).toHaveBeenCalledWith({ ...valid, userId: "owner" });
    expect((await PUT(request({ ...valid, section: undefined }))).status).toBe(
      400,
    );
  });
  it.each([
    { ...valid, action: "applyPreset", presetId: "old" },
    { ...valid, action: "restore", restoreVersion: 1 },
    { ...valid, action: "reset" },
    { ...valid, note: "obsolete" },
    { ...valid, userId: "other" },
    { ...valid, patch: { sound: { dialogue: true } } },
    { ...valid, patch: { sound: { mode: "silent", speechLines: [] } } },
    { ...valid, patch: { workflow: { concurrency: 8 } } },
    { ...valid, patch: { agents: {} } },
    {
      ...valid,
      section: "agents",
      scope: { projectId: "p" },
      patch: { agents: {} },
    },
    { ...valid, patch: undefined },
  ])("rejects retired or forged payloads", async (body) => {
    expect((await PUT(request(body))).status).toBe(400);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("keeps ownership and conflict failures visible", async () => {
    mocks.mutate.mockRejectedValueOnce(
      new ConfigurationError("项目不存在", 404),
    );
    expect((await PUT(request(valid))).status).toBe(404);
    mocks.mutate.mockRejectedValueOnce(
      new ConfigurationError("设置已被更新", 409),
    );
    expect((await PUT(request(valid))).status).toBe(409);
  });
  it("reads retained configuration without legacy history or sound context", async () => {
    const response = await GET(
      new Request("http://localhost/api/settings/production?projectId=p"),
    );
    expect(response.status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith("owner", { projectId: "p" });
    expect(await response.json()).not.toHaveProperty("soundContext");
  });
});
