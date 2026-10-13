import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  prisma: {
    workflowRun: { findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    workflowStep: { update: vi.fn(), updateMany: vi.fn() },
    workflowArtifact: { deleteMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), createMany: vi.fn() },
    workflowCheckpoint: { deleteMany: vi.fn(), create: vi.fn() },
    workflowEvent: { create: vi.fn() },
    workflowStepAttempt: { create: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  enqueue: vi.fn(), analyze: vi.fn(),
}));
vi.mock("@/lib/server/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/queue/workflow-queue", () => ({ enqueueWorkflowJob: mocks.enqueue }));
vi.mock("@/lib/episodes/manuscript-analysis", () => ({ analyzeManuscript: mocks.analyze }));

import { controlWorkflowRun } from "./actions";
import { retryWorkflowRun, retryWorkflowStep } from "./store";
import { processWorkflowJob } from "./runtime";
import { mergeProductionConfigurations } from "@/lib/production-configuration/contract";

const now = new Date();
function step(id: string, status: string, index = 0, dependsOn: string[] = []) {
  return {
    id, runId: "run-1", stepKey: id, stepType: "analyze_manuscript", stepIndex: index,
    status, attempt: 1, maxAttempts: 1, retryable: true, dependsOn,
    input: null, output: { old: true }, error: { message: "failed" }, artifactTypes: [],
    startedAt: now, completedAt: now, createdAt: now, updatedAt: now,
  };
}
function fixture() {
  return {
    id: "run-1", userId: "user-1", projectId: "project-1", episodeId: null,
    workflowType: "manuscript-analysis", targetType: "manuscript", targetId: "manuscript-1",
    status: "failed", activeDedupeKey: null, output: { old: true }, error: { message: "failed" },
    input: { manuscriptId: "manuscript-1", sourceHash: "hash", channelId: "channel-1", model: "test", productionConfiguration: { ...mergeProductionConfigurations([]), format: "production-configuration-v1", sources: [] } },
    leaseOwner: "old-worker" as string | null, leaseExpiresAt: new Date(Date.now() + 60_000) as Date | null,
    queuedAt: now, startedAt: now, completedAt: now, createdAt: now, updatedAt: now,
    steps: [step("analyze", "failed")],
    events: [] as Array<{ type: string; payload?: Prisma.JsonValue; createdAt: Date }>,
    checkpoints: [], stepAttempts: [],
  };
}
let state = fixture();
let artifacts: Array<{ stepId: string; artifactType: string; refId: string | null; payload: unknown }>;

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Record<string, unknown>[]).some(condition => matches(row, condition));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const condition = value as { in?: unknown[]; gt?: Date; lt?: Date };
      if (condition.in) return condition.in.includes(row[key]);
      if (condition.gt) return row[key] instanceof Date && row[key] > condition.gt;
      if (condition.lt) return row[key] instanceof Date && row[key] < condition.lt;
    }
    return row[key] === value;
  });
}
type Update = { where: Record<string, unknown>; data: Record<string, unknown> };
function assign(row: object, data: Record<string, unknown>) {
  Object.assign(row, Object.fromEntries(Object.entries(data).map(([key, value]) =>
    [key, value === Prisma.DbNull ? null : value])));
}

beforeEach(() => {
  vi.resetAllMocks();
  state = fixture();
  artifacts = [{ stepId: "analyze", artifactType: "manuscript.dossier", refId: "manuscript-1", payload: { deliverableId: "old" } }];
  mocks.prisma.workflowRun.findFirst.mockImplementation(async () => structuredClone(state));
  mocks.prisma.workflowRun.findUnique.mockImplementation(async () => structuredClone(state));
  mocks.prisma.workflowRun.count.mockResolvedValue(0);
  mocks.prisma.workflowRun.update.mockImplementation(async ({ data }: Update) => { assign(state, data); return state; });
  mocks.prisma.workflowRun.updateMany.mockImplementation(async ({ where, data }: Update) => {
    if (!matches(state, where)) return { count: 0 };
    assign(state, data); return { count: 1 };
  });
  mocks.prisma.workflowStep.updateMany.mockImplementation(async ({ where, data }: Update) => {
    const targets = state.steps.filter(item => matches(item, where));
    targets.forEach(item => assign(item, data)); return { count: targets.length };
  });
  mocks.prisma.workflowStep.update.mockImplementation(async ({ where, data }: Update) => {
    const target = state.steps.find(item => matches(item, where))!;
    assign(target, data); return target;
  });
  mocks.prisma.workflowArtifact.deleteMany.mockImplementation(async ({ where }: Update) => {
    artifacts = artifacts.filter(item => !matches({ ...item, runId: state.id }, where));
    return { count: 1 };
  });
  mocks.prisma.workflowArtifact.findFirst.mockImplementation(async ({ where }: Update) =>
    artifacts.find(item => matches({ ...item, runId: state.id }, where)) ?? null);
  mocks.prisma.workflowArtifact.findMany.mockResolvedValue([]);
  mocks.prisma.workflowEvent.create.mockImplementation(async ({ data }: { data: typeof state.events[number] }) => {
    state.events.push({ ...data, createdAt: new Date() }); return data;
  });
  mocks.prisma.$transaction.mockImplementation(async (work: unknown) =>
    typeof work === "function" ? work(mocks.prisma) : Promise.all(work as Promise<unknown>[]));
  mocks.prisma.workflowStepAttempt.updateMany.mockResolvedValue({ count: 1 });
  mocks.enqueue.mockResolvedValue({ id: "job-new" });
  mocks.analyze.mockResolvedValue({ deliverableId: "new" });
});

describe("manual workflow retry execution", () => {
  it.each(["run", "step"])("dispatches a new model operation after %s retry despite an old lease and completion artifact", async mode => {
    if (mode === "run") {
      await controlWorkflowRun({ action: "retry", runId: state.id, userId: state.userId });
      expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    } else {
      await retryWorkflowStep(state.userId, state.id, "analyze");
    }
    expect(state.leaseOwner).toBeNull();
    expect(state.output).toBeNull();
    expect(state.steps[0].output).toBeNull();
    expect(artifacts).toEqual([]);
    // This uses the real lease, step selection and dispatch rather than only
    // asserting that the workflow status changed to queued.
    await expect(processWorkflowJob(state.id, state.userId, "new-worker")).resolves.toBe(true);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(mocks.analyze.mock.calls[0][1].reusePreviousResults).toBe(false);
    expect(state.status).toBe("succeeded");
    expect(state.steps[0].attempt).toBe(2);
  });

  it.each(["run", "step"])("invalidates root and downstream caches while retaining successful prerequisites on %s retry", async mode => {
    state.steps = [step("prepare", "succeeded"), step("analyze", "failed", 1, ["prepare"]), step("finish", "succeeded", 2, ["analyze"])];
    artifacts = state.steps.map(item => ({ stepId: item.id, artifactType: "result", refId: item.id, payload: { old: true } }));
    if (mode === "run") await retryWorkflowRun(state.userId, state.id);
    else await retryWorkflowStep(state.userId, state.id, "analyze");
    expect(state.steps.map(item => item.status)).toEqual(["succeeded", "pending", "pending"]);
    expect(artifacts.map(item => item.stepId)).toEqual(["prepare"]);
    expect(state.steps[0].output).toEqual({ old: true });
  });

  it.each(["run", "step"])("continues from saved checkpoints when the frozen policy requests continue on %s retry", async mode => {
    const configuration = mergeProductionConfigurations([]);
    state.input.productionConfiguration = {
      ...configuration,
      format: "production-configuration-v1",
      sources: [],
      workflow: { ...configuration.workflow, retryMode: "continue" },
    };
    state.steps = [step("prepare", "succeeded"), step("analyze", "failed", 1, ["prepare"]), step("finish", "succeeded", 2, ["analyze"])];
    artifacts = state.steps.map(item => ({ stepId: item.id, artifactType: "result", refId: item.id, payload: { old: true } }));
    if (mode === "run") await retryWorkflowRun(state.userId, state.id);
    else await retryWorkflowStep(state.userId, state.id, "analyze");
    expect(artifacts).toHaveLength(3);
    expect(state.events.at(-1)?.payload).toMatchObject({ retryMode: "continue" });
    await processWorkflowJob(state.id, state.userId, "new-worker");
    expect(mocks.analyze.mock.calls[0][1].reusePreviousResults).toBe(true);
  });

  it("clears artifacts for pending steps after a queue submission failure", async () => {
    state.steps[0].status = "pending";
    await retryWorkflowRun(state.userId, state.id);
    expect(artifacts).toEqual([]);
    await processWorkflowJob(state.id, state.userId, "new-worker");
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
  });

  it("reruns the last completed step when workflow finalization failed", async () => {
    state.steps = [step("analyze", "succeeded", 1), step("prepare", "succeeded", 0)];
    await retryWorkflowRun(state.userId, state.id);
    expect(state.steps.map(item => item.status)).toEqual(["pending", "succeeded"]);
  });

  it("keeps ordinary execution eligible to reuse previous results", async () => {
    state.status = "queued"; state.leaseOwner = null; state.leaseExpiresAt = null;
    state.steps[0].status = "pending";
    await processWorkflowJob(state.id, state.userId, "new-worker");
    expect(mocks.analyze.mock.calls[0][1].reusePreviousResults).toBe(true);
  });
});
