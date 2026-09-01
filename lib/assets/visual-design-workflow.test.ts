import { beforeEach, describe, expect, it, vi } from "vitest";

const enqueueWorkflowJob = vi.hoisted(() => vi.fn());
const createOrReuseWorkflowRun = vi.hoisted(() => vi.fn());
const loadUserRuntimeSettings = vi.hoisted(() => vi.fn());

vi.mock("@/lib/queue/workflow-queue", () => ({ enqueueWorkflowJob }));
vi.mock("@/lib/workflow/store", () => ({ createOrReuseWorkflowRun }));
vi.mock("@/lib/settings/runtime-store", () => ({ loadUserRuntimeSettings }));

import { createAssetVisualDesignWorkflow } from "./visual-design-workflow";

describe("asset visual design workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadUserRuntimeSettings.mockResolvedValue({ workflowStepMaxAttempts: 4 });
    createOrReuseWorkflowRun.mockResolvedValue({
      reused: false,
      workflow: { id: "workflow-1" },
    });
  });

  it("creates and queues one independently retryable target workflow", async () => {
    await createAssetVisualDesignWorkflow({
      userId: "user-1",
      projectId: "project-1",
      targetType: "character",
      targetId: "character-1",
      channelId: "channel-1",
      model: "model-1",
      locale: "zh",
    });

    expect(createOrReuseWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowType: "asset-visual-design",
        targetType: "character",
        targetId: "character-1",
        maxAttempts: 4,
        steps: [
          expect.objectContaining({
            key: "design_asset_visual",
            maxAttempts: 4,
          }),
        ],
      }),
    );
    expect(enqueueWorkflowJob).toHaveBeenCalledWith({
      runId: "workflow-1",
      userId: "user-1",
      projectId: "project-1",
      maxAttempts: 1,
    });
  });

  it("does not enqueue an already active workflow again", async () => {
    createOrReuseWorkflowRun.mockResolvedValue({
      reused: true,
      workflow: { id: "workflow-existing" },
    });

    await createAssetVisualDesignWorkflow({
      userId: "user-1",
      projectId: "project-1",
      targetType: "location",
      targetId: "location-1",
      channelId: "channel-1",
      model: "model-1",
      locale: "zh",
    });

    expect(enqueueWorkflowJob).not.toHaveBeenCalled();
  });
});
