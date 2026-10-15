import { describe, expect, it, vi } from "vitest";
const save = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/auth", () => ({ ensureAnonymousUser: vi.fn().mockResolvedValue({ user: { id: "owner" }, sessionId: null }), attachSessionCookie: (r: Response) => r }));
vi.mock("@/lib/novel/domain-store", () => ({ getStoryboard: vi.fn(), saveStoryboard: save }));
vi.mock("@/lib/novel/storyboard-progress", () => ({ loadStoryboardProgress: vi.fn() }));
vi.mock("@/lib/studio/production-http", () => ({ submitEpisodeProductionRequest: vi.fn() }));
import { PUT } from "./route";
describe("saved spatial audit validation", () => {
  it("rejects the entire save if an invalid audit would otherwise filter out and delete a panel", async () => {
    const response = await PUT(new Request("http://localhost/test", { method: "PUT", body: JSON.stringify({ panels: [{ id: "panel", panelIndex: 0, videoPromptDesign: { designNotes: [], continuitySafeguards: [], spatialAudit: { referenceAssetIds: ["image"] } } }] }) }), { params: Promise.resolve({ projectId: "p", episodeId: "e" }) });
    expect(response.status).toBe(400); expect(save).not.toHaveBeenCalled();
  });
});
