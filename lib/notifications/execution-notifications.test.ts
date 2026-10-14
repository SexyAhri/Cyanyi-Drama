import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ preference: vi.fn(), upsert: vi.fn(), task: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/server/prisma", () => ({ prisma: {
  executionNotificationPreference: { findUnique: mocks.preference },
  executionNotification: { upsert: mocks.upsert },
  mediaTask: { findFirst: mocks.task },
  workflowRun: { findFirst: mocks.run },
} }));

import { createExecutionNotification, notifyMediaTaskTerminal, notifyWorkflowTerminal } from "./execution-notifications";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preference.mockResolvedValue(null);
  mocks.upsert.mockResolvedValue({ id: "notification-1" });
});

describe("execution notification creation", () => {
  it("uses a stable per-user dedupe key and stores a localized inbox item", async () => {
    await createExecutionNotification({
      userId: "user-1", kind: "completed", dedupeKey: "workflow:run-1:succeeded",
      titleZh: "已完成", titleEn: "Completed", bodyZh: "流程完成", bodyEn: "Run completed", href: "/projects/p1",
    });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_dedupeKey: { userId: "user-1", dedupeKey: "workflow:run-1:succeeded" } },
      create: expect.objectContaining({ titleZh: "已完成", titleEn: "Completed", href: "/projects/p1" }),
      update: {},
    }));
  });

  it("respects disabled preferences without creating a notification", async () => {
    mocks.preference.mockResolvedValue({ completedEnabled: true, partialFailureEnabled: false, actionRequiredEnabled: true });
    const result = await createExecutionNotification({
      userId: "user-1", kind: "partial_failure", dedupeKey: "workflow:run-1:failed",
      titleZh: "部分失败", titleEn: "Partially failed", bodyZh: "失败", bodyEn: "Failed", href: "/projects/p1",
    });
    expect(result).toBeNull();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("records media task status separately by retry cycle", async () => {
    mocks.task.mockResolvedValue({ id: "task-1", projectId: "project-1", episodeId: "episode-1", kind: "image", targetType: "storyboard_panel", targetId: "panel-1", retryCount: 2 });
    await notifyMediaTaskTerminal({ userId: "user-1", taskId: "task-1", status: "failed" });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_dedupeKey: { userId: "user-1", dedupeKey: "media:task-1:failed:2" } },
      create: expect.objectContaining({ kind: "action_required", mediaTaskId: "task-1", projectId: "project-1", href: expect.stringContaining("task=task-1") }),
    }));
  });

  it("classifies failed workflow runs with prior successes as partial failures", async () => {
    mocks.run.mockResolvedValue({ id: "run-1", projectId: "project-1", workflowType: "script", steps: [{ status: "succeeded" }, { status: "failed" }] });
    await notifyWorkflowTerminal({ userId: "user-1", runId: "run-1", status: "failed" });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_dedupeKey: { userId: "user-1", dedupeKey: "workflow:run-1:failed" } },
      create: expect.objectContaining({ kind: "partial_failure", runId: "run-1", href: expect.stringContaining("run=run-1") }),
    }));
  });
});
