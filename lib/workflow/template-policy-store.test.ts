import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  projectCount: vi.fn(),
  episodeCount: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  resolveConfiguration: vi.fn(),
  assertPreview: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({ prisma: {
  project: { count: mocks.projectCount },
  episode: { count: mocks.episodeCount },
  workflowRun: { findFirst: mocks.findFirst, create: mocks.create },
} }));
vi.mock("@/lib/production-configuration/store", () => ({ resolveProductionConfiguration: mocks.resolveConfiguration }));
vi.mock("@/lib/production-configuration/execution", () => ({ assertPreviewConfiguration: mocks.assertPreview }));

import { DEFAULT_SOUND_POLICY, DEFAULT_WORKFLOW_POLICY } from "@/lib/production-configuration/contract";
import { createOrReuseWorkflowRun } from "./store";

const configuration = () => ({
  format: "production-configuration-v1" as const,
  sound: DEFAULT_SOUND_POLICY,
  agents: {},
  workflow: { ...DEFAULT_WORKFLOW_POLICY, templates: {} },
  sources: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projectCount.mockResolvedValue(1);
  mocks.episodeCount.mockResolvedValue(1);
  mocks.findFirst.mockResolvedValue(null);
  mocks.resolveConfiguration.mockResolvedValue(configuration());
  mocks.assertPreview.mockImplementation(() => undefined);
  mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    const now = new Date("2026-10-14T00:00:00.000Z");
    const stepRows = (data.steps as { create: Record<string, unknown>[] }).create;
    return {
      ...data,
      output: null,
      error: null,
      workflowVersion: 1,
      queuedAt: now,
      startedAt: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      cancelRequestedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      steps: stepRows.map((step, index) => ({
        ...step,
        id: `step-${index}`,
        status: "pending",
        attempt: 0,
        output: null,
        error: null,
        startedAt: null,
        completedAt: null,
      })),
      events: [{ id: "event-1", stepId: null, type: "created", status: "queued", message: null, payload: {}, createdAt: now }],
      checkpoints: [],
      stepAttempts: [],
    };
  });
});

describe("workflow execution after configuration management removal", () => {
  it("uses the supplied execution graph and saves the immutable execution snapshot", async () => {
    const result = await createOrReuseWorkflowRun({
      id: "run-1",
      userId: "user-1",
      projectId: "project-1",
      episodeId: "episode-1",
      workflowType: "episode-preproduction",
      steps: [
        { key: "build_scene_storyboard", type: "build_scene_storyboard" },
        { key: "analyze_episode_voice", type: "analyze_episode_voice" },
      ],
    });

    expect(result?.workflow.steps).toMatchObject([
      { key: "build_scene_storyboard", dependsOn: [], retryable: true, maxAttempts: 3 },
      { key: "analyze_episode_voice", dependsOn: [], retryable: true, maxAttempts: 3 },
    ]);
    expect(result?.workflow.workflowVersion).toBe(1);
    expect(result?.workflow.input?.orchestrationSnapshot).toMatchObject({
      templateType: "episode-preproduction",
      templateVersion: 1,
      steps: [
        { key: "build_scene_storyboard", requiredArtifactTypes: ["production-script.scenes"] },
        { key: "analyze_episode_voice", requiredArtifactTypes: ["storyboard.scenes"] },
      ],
    });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        input: expect.objectContaining({
          concurrency: 2,
          productionConfiguration: expect.objectContaining({
            workflow: expect.objectContaining({ templates: configuration().workflow.templates }),
          }),
        }),
      }),
    }));
  });

  it("still rejects a missing prerequisite in the execution graph", async () => {
    await expect(createOrReuseWorkflowRun({
      id: "run-2",
      userId: "user-1",
      projectId: "project-1",
      episodeId: "episode-1",
      workflowType: "episode-preproduction",
      steps: [
        { key: "organize_production_script", type: "organize_production_script" },
        { key: "build_scene_storyboard", type: "build_scene_storyboard", dependsOn: ["missing"] },
      ],
    })).rejects.toThrow("WORKFLOW_DEPENDENCY_NOT_FOUND");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
