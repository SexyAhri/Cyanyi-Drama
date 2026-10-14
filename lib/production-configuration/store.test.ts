import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  prisma: {
    project: { count: vi.fn() },
    episode: { count: vi.fn() },
    storyboardPanel: { count: vi.fn() },
    providerModel: { count: vi.fn() },
    productionConfiguration: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/server/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("./invalidation", () => ({ markConfigurationAssetsStale: vi.fn() }));
import {
  assertConfigurationScope,
  mutateProductionConfiguration,
  readProductionConfiguration,
  resolveProductionConfiguration,
} from "./store";
import {
  configurationSnapshotSchema,
  DEFAULT_SOUND_POLICY,
  DEFAULT_WORKFLOW_POLICY,
  mergeProductionConfigurations,
  type ProductionConfigurationPatch,
} from "./contract";

type Row = {
  id: string;
  userId: string;
  scopeKey: string;
  revision: number;
  version: number;
  draft: unknown;
  published: unknown;
};
let rows: Row[];
const base = {
  userId: "owner",
  scope: {},
  expectedRevision: 0,
  section: "sound" as const,
  patch: { sound: { mode: "silent" as const } },
};
const agentId = "production_storyboard-generation";
beforeEach(() => {
  vi.resetAllMocks();
  rows = [];
  for (const model of [
    mocks.prisma.project,
    mocks.prisma.episode,
    mocks.prisma.storyboardPanel,
    mocks.prisma.providerModel,
  ])
    model.count.mockResolvedValue(1);
  mocks.prisma.$transaction.mockImplementation(
    (run: (tx: typeof mocks.prisma) => unknown) => run(mocks.prisma),
  );
  mocks.prisma.productionConfiguration.findMany.mockImplementation(
    ({ where }) =>
      rows.filter(
        (row) =>
          row.userId === where.userId &&
          where.scopeKey.in.includes(row.scopeKey) &&
          row.published !== null,
      ),
  );
  mocks.prisma.productionConfiguration.findUnique.mockImplementation(
    ({ where }) =>
      rows.find(
        (row) =>
          row.userId === where.userId_scopeKey.userId &&
          row.scopeKey === where.userId_scopeKey.scopeKey,
      ) ?? null,
  );
  mocks.prisma.productionConfiguration.upsert.mockImplementation(
    ({ create }) => {
      let row = rows.find(
        (item) =>
          item.userId === create.userId && item.scopeKey === create.scopeKey,
      );
      if (!row) {
        row = {
          ...create,
          id: `row-${rows.length}`,
          revision: 0,
          version: 0,
          draft: {},
          published: null,
        };
        rows.push(row!);
      }
      return structuredClone(row);
    },
  );
  mocks.prisma.productionConfiguration.updateMany.mockImplementation(
    ({ where, data }) => {
      const row = rows.find(
        (item) => item.id === where.id && item.revision === where.revision,
      );
      if (!row) return { count: 0 };
      Object.assign(row, data, {
        revision: row.revision + data.revision.increment,
        version: row.version + (data.version?.increment ?? 0),
      });
      return { count: 1 };
    },
  );
});

describe("retained Agent and sound configuration", () => {
  it("keeps drafts separate, publishes only the selected section, and freezes prior snapshots", async () => {
    const initial = await mutateProductionConfiguration({
      ...base,
      section: "agents",
      action: "publish",
      patch: { agents: { [agentId]: { temperature: 0.2 } } },
    });
    const pending = await mutateProductionConfiguration({
      ...base,
      expectedRevision: initial.revision,
      action: "save",
    });
    expect(pending.effective.sound.mode).toBe("native");
    expect(pending.draft.sound?.mode).toBe("silent");
    const changed = await mutateProductionConfiguration({
      ...base,
      section: "agents",
      expectedRevision: pending.revision,
      action: "publish",
      patch: { agents: { [agentId]: { temperature: 0.4 } } },
    });
    expect(changed.published).toEqual({
      agents: { [agentId]: { temperature: 0.4 } },
    });
    expect(changed.draft.sound?.mode).toBe("silent");
    expect(initial.effective.agents[agentId].temperature).toBe(0.2);
    const sound = await mutateProductionConfiguration({
      ...base,
      expectedRevision: changed.revision,
      action: "publish",
    });
    expect(sound.effective.sound.mode).toBe("silent");
    expect(sound.effective.agents[agentId].temperature).toBe(0.4);
    expect(sound).not.toHaveProperty("history");
  });
  it("inherits only sound mode and ignores all retired live configuration", async () => {
    rows.push({
      id: "global",
      userId: "owner",
      scopeKey: "user",
      revision: 1,
      version: 1,
      draft: {},
      published: {
        agents: { [agentId]: { temperature: 0.2 } },
        sound: {
          mode: "post",
          dialogue: false,
          music: "off",
          speechLines: [
            { speaker: "A", content: "Legacy text", delivery: "dialogue" },
          ],
        },
        workflow: { concurrency: 7, templates: {} },
      },
    });
    rows.push({
      id: "scoped",
      userId: "owner",
      scopeKey: "panel:p",
      revision: 1,
      version: 2,
      draft: { workflow: { concurrency: 8 } },
      published: {
        agents: { [agentId]: { temperature: 1.5 } },
        sound: { mode: "silent", effects: false },
        workflow: { concurrency: 8 },
      },
    });
    const scope = { projectId: "project", episodeId: "episode", panelId: "p" };
    const snapshot = await resolveProductionConfiguration("owner", scope);
    expect(snapshot.sound).toEqual({ ...DEFAULT_SOUND_POLICY, mode: "silent" });
    expect(snapshot.workflow).toEqual(DEFAULT_WORKFLOW_POLICY);
    expect(snapshot.agents[agentId].temperature).toBe(0.2);
    expect(
      snapshot.sources.find((source) => source.scopeKey === "panel:p")?.fields,
    ).toEqual(["sound.mode"]);
    const record = await readProductionConfiguration("owner", scope);
    expect(record.draft).toEqual({});
    expect(record.published).toEqual({ sound: { mode: "silent" } });
    expect(
      (await resolveProductionConfiguration("other", scope)).agents,
    ).toEqual({});
  });
  it("cleans retired fields when writing and restores only mode inheritance", async () => {
    rows.push({
      id: "legacy",
      userId: "owner",
      scopeKey: "user",
      revision: 1,
      version: 1,
      draft: {
        agents: { [agentId]: { temperature: 0.5 } },
        sound: { mode: "post", dialogue: false },
        workflow: { concurrency: 8 },
      },
      published: {
        agents: { [agentId]: { temperature: 0.2 } },
        sound: { mode: "post", dialogue: false },
        workflow: { concurrency: 8 },
      },
    });
    const result = await mutateProductionConfiguration({
      ...base,
      expectedRevision: 1,
      action: "publish",
      patch: {},
    });
    expect(result.published).toEqual({
      agents: { [agentId]: { temperature: 0.2 } },
    });
    expect(result.draft).toEqual({
      agents: { [agentId]: { temperature: 0.5 } },
    });
    expect(result.effective.sound.mode).toBe("native");
  });
  it.each<ProductionConfigurationPatch>([
    { workflow: { concurrency: 3 } },
    { sound: { dialogue: true } },
    { sound: { music: "off" } },
    { sound: { speechLines: [] } },
    { sound: {}, agents: {} },
  ])("rejects retired fields and cross-section writes", async (patch) => {
    await expect(
      mutateProductionConfiguration({ ...base, action: "save", patch }),
    ).rejects.toThrow();
    expect(mocks.prisma.productionConfiguration.upsert).not.toHaveBeenCalled();
  });
  it("rejects non-global Agent edits", async () => {
    await expect(
      mutateProductionConfiguration({
        ...base,
        scope: { projectId: "p" },
        section: "agents",
        action: "save",
        patch: { agents: {} },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("checks main and fallback model ownership before persistence", async () => {
    mocks.prisma.providerModel.count.mockResolvedValue(0);
    await expect(
      mutateProductionConfiguration({
        ...base,
        section: "agents",
        action: "save",
        patch: {
          agents: { [agentId]: { channelId: "private", model: "model" } },
        },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.prisma.productionConfiguration.upsert).not.toHaveBeenCalled();
  });
  it("rejects stale revisions and failed compare-and-swap", async () => {
    const saved = await mutateProductionConfiguration({
      ...base,
      action: "save",
    });
    await expect(
      mutateProductionConfiguration({ ...base, action: "publish" }),
    ).rejects.toMatchObject({ status: 409 });
    mocks.prisma.productionConfiguration.updateMany.mockResolvedValueOnce({
      count: 0,
    });
    await expect(
      mutateProductionConfiguration({
        ...base,
        expectedRevision: saved.revision,
        action: "publish",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(rows[0].published).toBeNull();
  });
  it("checks project, episode and panel ownership before reading or writing", async () => {
    for (const [model, scope] of [
      [mocks.prisma.project, { projectId: "p" }],
      [mocks.prisma.episode, { projectId: "p", episodeId: "e" }],
      [
        mocks.prisma.storyboardPanel,
        { projectId: "p", episodeId: "e", panelId: "s" },
      ],
    ] as const) {
      model.count.mockResolvedValueOnce(0);
      await expect(
        assertConfigurationScope("owner", scope),
      ).rejects.toMatchObject({ status: 404 });
    }
    await expect(
      assertConfigurationScope("owner", { panelId: "p" }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("continues to decode complete historical task snapshots without changing them", () => {
    const legacy = {
      ...mergeProductionConfigurations([
        {
          sound: { dialogue: false, music: "off" },
          workflow: { concurrency: 7 },
        },
      ]),
      format: "production-configuration-v1",
      sources: [{ scopeKey: "request", version: 0 }],
    };
    const before = JSON.stringify(legacy);
    expect(configurationSnapshotSchema.parse(legacy)).toMatchObject({
      sound: { dialogue: false, music: "off" },
      workflow: { concurrency: 7 },
    });
    expect(JSON.stringify(legacy)).toBe(before);
  });
  it("does not parse retired policies or scoped Agent data while resolving new tasks", async () => {
    rows.push({ id: "obsolete", userId: "owner", scopeKey: "project:p", revision: 1, version: 1, draft: {}, published: { workflow: { concurrency: "obsolete" }, agents: { bad: { temperature: "obsolete" } }, sound: { mode: "post", dialogue: "obsolete" } } });
    const snapshot = await resolveProductionConfiguration("owner", { projectId: "p" });
    expect(snapshot.sound.mode).toBe("post");
    expect(snapshot.workflow).toEqual(DEFAULT_WORKFLOW_POLICY);
    expect(snapshot.agents).toEqual({});
  });
});
