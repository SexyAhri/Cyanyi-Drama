import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn(), enqueue: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/workflow/store", () => ({ getWorkflowRun: mocks.get, createOrReuseWorkflowRun: mocks.create }));
vi.mock("@/lib/queue/workflow-queue", () => ({ enqueueWorkflowJob: mocks.enqueue }));
vi.mock("./execution", async importOriginal => ({ ...await importOriginal<typeof import("./execution")>(), resolveProductionRequestConfiguration: mocks.resolve }));
vi.mock("@/lib/server/prisma", () => ({ prisma: {} }));
import { regenerateWithPublishedConfiguration, regenerationRequestSchema } from "./regeneration";
import { mergeProductionConfigurations } from "./contract";
const fresh = () => ({ ...mergeProductionConfigurations([{ sound: { music: "off" } }]), format: "production-configuration-v1" as const, sources: [{ scopeKey: "project:p", version: 2 }] });
const prior = () => ({ id: "old", userId: "user", projectId: "p", targetId: "p", workflowType: "production", status: "succeeded", updatedAt: "2026-10-13", input: { productionConfiguration: { ...fresh(), sound: { ...fresh().sound, music: "designed" } }, concurrency: 8, instructions: "Keep source facts" }, steps: [{ id: "old-step", key: "design", type: "design_asset_visual", input: { targetId: "asset" }, dependsOn: [], artifactTypes: [], maxAttempts: 3, retryable: true, status: "succeeded", output: { cached: true } }] });
beforeEach(() => { vi.clearAllMocks(); mocks.get.mockImplementation(async (_user, id) => id === "old" ? prior() : null); mocks.resolve.mockResolvedValue(fresh()); mocks.create.mockResolvedValue({ workflow: { id: "new", status: "queued" }, reused: false }); });
describe("new execution versions", () => {
  it("previews exact scope without writes or enqueueing", async () => {
    const result = await regenerateWithPublishedConfiguration("user", { kind: "workflow", id: "old", preview: true });
    expect(result).toMatchObject({ preview: { count: 1, executionVersion: 2, steps: ["design"], configuration: { sound: { music: "off" } } } });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("creates fresh steps and a snapshot from published settings while preserving the source", async () => {
    const result = await regenerateWithPublishedConfiguration("user", { kind: "workflow", id: "old", preview: true });
    if (!("preview" in result) || !result.preview) throw new Error("preview missing");
    await regenerateWithPublishedConfiguration("user", { kind: "workflow", id: "old", preview: false, token: result.preview.token, idempotencyKey: "123e4567-e89b-42d3-a456-426614174000" });
    const definition = mocks.create.mock.calls[0][0];
    expect(definition.input).toEqual({ instructions: "Keep source facts", regeneratedFromRunId: "old", executionVersion: 2 });
    expect(definition.steps[0]).not.toHaveProperty("id"); expect(definition.steps[0]).not.toHaveProperty("output");
    expect(definition.expectedConfigurationHash).toHaveLength(64);
    expect(mocks.enqueue).toHaveBeenCalledOnce(); expect(prior().steps[0].output).toEqual({ cached: true });
  });
  it("rejects a changed publication and refuses to silently reuse an active run", async () => {
    const result = await regenerateWithPublishedConfiguration("user", { kind: "workflow", id: "old", preview: true });
    if (!("preview" in result) || !result.preview) throw new Error("preview missing");
    mocks.resolve.mockResolvedValue({ ...fresh(), sources: [{ scopeKey: "project:p", version: 3 }] });
    await expect(regenerateWithPublishedConfiguration("user", { kind: "workflow", id: "old", preview: false, token: result.preview.token, idempotencyKey: "123e4567-e89b-42d3-a456-426614174000" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.resolve.mockResolvedValue(fresh()); mocks.create.mockResolvedValue({ workflow: { id: "active" }, reused: true });
    await expect(regenerateWithPublishedConfiguration("user", { kind: "workflow", id: "old", preview: false, token: result.preview.token, idempotencyKey: "123e4567-e89b-42d3-a456-426614174000" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("rejects other users, active sources and malformed confirmations", async () => {
    mocks.get.mockResolvedValueOnce(null);
    await expect(regenerateWithPublishedConfiguration("other", { kind: "workflow", id: "old", preview: true })).rejects.toMatchObject({ status: 404 });
    mocks.get.mockResolvedValueOnce({ ...prior(), status: "running" });
    await expect(regenerateWithPublishedConfiguration("user", { kind: "workflow", id: "old", preview: true })).rejects.toMatchObject({ status: 409 });
    expect(regenerationRequestSchema.safeParse({ kind: "workflow", id: "old", preview: false, idempotencyKey: "bad", snapshot: fresh() }).success).toBe(false);
  });
});
