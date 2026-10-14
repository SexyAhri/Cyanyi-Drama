import { beforeEach, describe, expect, it, vi } from "vitest";

type ConfigRow = {
  id: string;
  userId: string;
  scopeKey: string;
  revision: number;
  version: number;
  draft: unknown;
  published: unknown;
  publishedAt: Date | null;
  history: unknown[];
};

const state = vi.hoisted(() => ({
  rows: [] as ConfigRow[],
  auth: vi.fn(),
  attach: vi.fn(),
  readSoundContext: vi.fn(),
  prisma: {
    project: { count: vi.fn() },
    episode: { count: vi.fn() },
    storyboardPanel: { count: vi.fn() },
    providerModel: { count: vi.fn() },
    voicePreset: { count: vi.fn() },
    productionConfiguration: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/server/auth", () => ({
  ensureAnonymousUser: state.auth,
  attachSessionCookie: state.attach,
}));
vi.mock("@/lib/server/prisma", () => ({ prisma: state.prisma }));
vi.mock("@/lib/production-configuration/agents", () => ({
  getConfigurationAgentCatalog: () => [],
  validateConfigurationAgents: () => undefined,
}));
vi.mock("@/lib/production-configuration/invalidation", () => ({
  markConfigurationAssetsStale: vi.fn(),
}));

import { GET, PUT } from "./route";
import { resolveProductionConfiguration } from "@/lib/production-configuration/store";

const scope = { projectId: "project-1" };
const get = () =>
  GET(
    new Request("http://localhost/api/settings/production?projectId=project-1"),
  );
const put = (body: unknown) =>
  PUT(
    new Request("http://localhost/api/settings/production", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [];
  state.auth.mockResolvedValue({ user: { id: "owner" }, sessionId: null });
  state.attach.mockImplementation((response) => response);
  state.readSoundContext.mockResolvedValue(null);
  state.prisma.project.count.mockResolvedValue(1);
  state.prisma.episode.count.mockResolvedValue(1);
  state.prisma.storyboardPanel.count.mockResolvedValue(1);
  state.prisma.providerModel.count.mockResolvedValue(1);
  state.prisma.voicePreset.count.mockResolvedValue(0);
  state.prisma.$transaction.mockImplementation(async (callback) =>
    callback(state.prisma),
  );
  state.prisma.productionConfiguration.findMany.mockImplementation(
    ({ where }) =>
      state.rows.filter(
        (row) =>
          row.userId === where.userId &&
          where.scopeKey.in.includes(row.scopeKey) &&
          row.published !== null,
      ),
  );
  state.prisma.productionConfiguration.findUnique.mockImplementation(
    ({ where }) =>
      state.rows.find(
        (row) =>
          row.userId === where.userId_scopeKey.userId &&
          row.scopeKey === where.userId_scopeKey.scopeKey,
      ) ?? null,
  );
  state.prisma.productionConfiguration.upsert.mockImplementation(
    ({ create }) => {
      let row = state.rows.find(
        (item) =>
          item.userId === create.userId && item.scopeKey === create.scopeKey,
      );
      if (!row) {
        const created = {
          ...create,
          id: `config-${state.rows.length + 1}`,
          revision: 0,
          version: 0,
          draft: {},
          published: null,
          publishedAt: null,
          history: [],
        };
        state.rows.push(created);
        row = created;
      }
      return row;
    },
  );
  state.prisma.productionConfiguration.updateMany.mockImplementation(
    ({ where, data }) => {
      const row = state.rows.find(
        (item) => item.id === where.id && item.revision === where.revision,
      );
      if (!row) return { count: 0 };
      row.draft = data.draft;
      row.revision += data.revision.increment;
      if (data.published !== undefined) {
        row.published = data.published;
        row.version += data.version.increment;
        row.publishedAt = data.publishedAt;
        row.history = data.history;
      }
      return { count: 1 };
    },
  );
});

describe("retained configuration API persistence lifecycle", () => {
  it("saves and publishes sound mode, reloads it, restores inheritance and rejects obsolete restoration", async () => {
    expect((await get()).status).toBe(200);
    const saved = await put({
      scope,
      action: "save",
      section: "sound",
      expectedRevision: 0,
      patch: { sound: { mode: "silent" } },
    });
    expect(saved.status).toBe(200);
    expect((await saved.json()).configuration).toMatchObject({
      revision: 1,
      version: 0,
      draft: { sound: { mode: "silent" } },
      effective: { sound: { mode: "native" } },
    });
    const published = await put({
      scope,
      action: "publish",
      section: "sound",
      expectedRevision: 1,
      patch: { sound: { mode: "silent" } },
    });
    expect(published.status).toBe(200);
    expect((await published.json()).configuration).toMatchObject({
      revision: 2,
      version: 1,
      effective: { sound: { mode: "silent" } },
    });
    const reloaded = (await (await get()).json()).configuration;
    expect(reloaded.published).toEqual({ sound: { mode: "silent" } });
    expect(reloaded).not.toHaveProperty("history");
    const snapshot = await resolveProductionConfiguration("owner", scope);
    expect(snapshot.sound.mode).toBe("silent");
    expect(
      (
        await put({
          scope,
          action: "restore",
          section: "sound",
          expectedRevision: 2,
          restoreVersion: 1,
        })
      ).status,
    ).toBe(400);
    const restored = await put({
      scope,
      action: "publish",
      section: "sound",
      expectedRevision: 2,
      patch: {},
    });
    expect(restored.status).toBe(200);
    expect((await restored.json()).configuration.effective.sound.mode).toBe(
      "native",
    );
    expect(snapshot.sound.mode).toBe("silent");
  });
});
