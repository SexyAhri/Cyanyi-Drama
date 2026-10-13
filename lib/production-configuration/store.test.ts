import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ prisma: { project: { count: vi.fn() }, episode: { count: vi.fn() }, storyboardPanel: { count: vi.fn() }, providerModel: { count: vi.fn() }, productionConfiguration: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() }, $transaction: vi.fn() } }));
vi.mock("@/lib/server/prisma", () => ({ prisma: mocks.prisma }));
import { assertConfigurationScope, mutateProductionConfiguration, readProductionConfiguration, resolveProductionConfiguration } from "./store";
type Row = { id: string; userId: string; scopeKey: string; revision: number; version: number; draft: unknown; published: unknown; history: unknown[] };
let rows: Row[];
beforeEach(() => {
  vi.resetAllMocks(); rows = [];
  mocks.prisma.project.count.mockResolvedValue(1); mocks.prisma.episode.count.mockResolvedValue(1); mocks.prisma.storyboardPanel.count.mockResolvedValue(1); mocks.prisma.providerModel.count.mockResolvedValue(1);
  mocks.prisma.$transaction.mockImplementation((run: (tx: typeof mocks.prisma) => unknown) => run(mocks.prisma));
  mocks.prisma.productionConfiguration.findMany.mockImplementation(({ where }) => rows.filter(row => row.userId === where.userId && where.scopeKey.in.includes(row.scopeKey) && row.published !== null));
  mocks.prisma.productionConfiguration.findUnique.mockImplementation(({ where }) => rows.find(row => row.userId === where.userId_scopeKey.userId && row.scopeKey === where.userId_scopeKey.scopeKey) ?? null);
  mocks.prisma.productionConfiguration.upsert.mockImplementation(({ create }) => { let row = rows.find(item => item.userId === create.userId && item.scopeKey === create.scopeKey); if (!row) { row = { ...create, id: `row-${rows.length}`, revision: 0, version: 0, draft: {}, published: null, history: [] }; rows.push(row!); } return structuredClone(row); });
  mocks.prisma.productionConfiguration.updateMany.mockImplementation(({ where, data }) => { const row = rows.find(item => item.id === where.id && item.revision === where.revision); if (!row) return { count: 0 }; Object.assign(row, data, { revision: row.revision + data.revision.increment, version: row.version + (data.version?.increment ?? 0) }); return { count: 1 }; });
});
const base = { userId: "owner", scope: {}, expectedRevision: 0 };
describe("production configuration persistence", () => {
  it("keeps drafts out of effective settings until publication", async () => {
    const saved = await mutateProductionConfiguration({ ...base, action: "save", patch: { sound: { dialogue: false } } });
    expect(saved.draft.sound?.dialogue).toBe(false); expect(saved.effective.sound.dialogue).toBe(true); expect(saved.version).toBe(0);
    const published = await mutateProductionConfiguration({ ...base, expectedRevision: saved.revision, action: "publish" });
    expect(published.version).toBe(1); expect(published.effective.sound.dialogue).toBe(false);
    expect(published.effective.sources).toEqual([{ scopeKey: "user", version: 1, fields: ["sound.dialogue"] }]);
  });
  it("merges published parent fields while keeping local draft and parent preview separate", async () => {
    await mutateProductionConfiguration({ ...base, action: "publish", patch: { sound: { dialogue: false } } });
    await mutateProductionConfiguration({ ...base, scope: { projectId: "p" }, action: "publish", patch: { sound: { ambience: false } } });
    const record = await readProductionConfiguration("owner", { projectId: "p" });
    expect(record.inherited.sound).toMatchObject({ dialogue: false, ambience: true });
    expect(record.effective.sound).toMatchObject({ dialogue: false, ambience: false });
    expect((await resolveProductionConfiguration("other", { projectId: "p" })).sources).toEqual([]);
  });
  it("detects stale revisions without replacing the saved configuration", async () => {
    await mutateProductionConfiguration({ ...base, action: "publish", patch: { sound: { dialogue: false } } });
    await expect(mutateProductionConfiguration({ ...base, action: "publish", patch: { sound: { dialogue: true } } })).rejects.toMatchObject({ status: 409 });
    expect(rows[0].version).toBe(1); expect(rows[0].published).toEqual({ sound: { dialogue: false } });
  });
  it("detects a concurrent update between read and compare-and-swap", async () => {
    mocks.prisma.productionConfiguration.updateMany.mockResolvedValue({ count: 0 });
    await expect(mutateProductionConfiguration({ ...base, action: "publish", patch: {} })).rejects.toMatchObject({ status: 409 });
  });
  it("restores history as a new published version and preserves frozen snapshots", async () => {
    const first = await mutateProductionConfiguration({ ...base, action: "publish", patch: { sound: { dialogue: false } }, note: "first" });
    await mutateProductionConfiguration({ ...base, expectedRevision: 1, action: "publish", patch: { sound: { dialogue: true } } });
    expect(first.effective.sound.dialogue).toBe(false);
    const restored = await mutateProductionConfiguration({ ...base, expectedRevision: 2, action: "restore", restoreVersion: 1 });
    expect(restored.version).toBe(3); expect(restored.effective.sound.dialogue).toBe(false); expect(restored.history).toHaveLength(3);
    expect(Array.isArray(restored.history) ? restored.history[0] : null).toMatchObject({ authorId: "owner", note: "first" });
    await expect(mutateProductionConfiguration({ ...base, expectedRevision: 3, action: "restore", restoreVersion: 99 })).rejects.toMatchObject({ status: 404 });
  });
  it("enforces owner, episode and panel relationships before reading or writing", async () => {
    mocks.prisma.project.count.mockResolvedValue(0);
    await expect(readProductionConfiguration("outsider", { projectId: "p" })).rejects.toMatchObject({ status: 404 });
    expect(mocks.prisma.productionConfiguration.findMany).not.toHaveBeenCalled();
    mocks.prisma.project.count.mockResolvedValue(1); mocks.prisma.episode.count.mockResolvedValue(0);
    await expect(assertConfigurationScope("owner", { projectId: "p", episodeId: "wrong" })).rejects.toMatchObject({ status: 404 });
    mocks.prisma.episode.count.mockResolvedValue(1); mocks.prisma.storyboardPanel.count.mockResolvedValue(0);
    await expect(assertConfigurationScope("owner", { projectId: "p", episodeId: "e", panelId: "wrong" })).rejects.toMatchObject({ status: 404 });
    expect(mocks.prisma.storyboardPanel.count).toHaveBeenCalledWith({ where: { id: "wrong", storyboard: { projectId: "p", episodeId: "e" } } });
  });
  it("refuses an unavailable Agent model before persisting any changes", async () => {
    mocks.prisma.providerModel.count.mockResolvedValue(0);
    await expect(mutateProductionConfiguration({ ...base, action: "publish", patch: { agents: { story_character_analysis: { channelId: "private", model: "m" } } } })).rejects.toThrow();
    expect(mocks.prisma.productionConfiguration.upsert).not.toHaveBeenCalled();
  });
});
