import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";

import {
  getWorkflowRun,
  removeTerminalWorkflowRun,
  requestWorkflowCancel,
  retryWorkflowRun,
  updateWorkflowRunStatus,
} from "./store";

export type WorkflowAction = "cancel" | "pause" | "resume" | "retry";

export class WorkflowActionError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export async function deleteWorkflowRun(input: {
  projectId?: string;
  runId: string;
  userId: string;
}) {
  const current = await getWorkflowRun(input.userId, input.runId);
  if (!current) throw new WorkflowActionError("工作流不存在", 404);
  if (input.projectId && current.projectId !== input.projectId)
    throw new WorkflowActionError("工作流不存在", 404);
  if (!["blocked", "canceled", "failed", "succeeded"].includes(current.status))
    throw new WorkflowActionError("只能删除已结束的工作流");

  const deleted = await removeTerminalWorkflowRun(input.userId, input.runId);
  if (!deleted) throw new WorkflowActionError("工作流状态已变化，请刷新后重试");
}

export async function controlWorkflowRun(input: {
  action: WorkflowAction;
  projectId?: string;
  runId: string;
  userId: string;
}) {
  const current = await getWorkflowRun(input.userId, input.runId);
  if (!current) throw new WorkflowActionError("工作流不存在", 404);
  if (input.projectId && current.projectId !== input.projectId)
    throw new WorkflowActionError("工作流不存在", 404);

  let workflow;
  if (input.action === "cancel") {
    workflow = await requestWorkflowCancel(input.userId, input.runId);
  } else if (input.action === "retry") {
    workflow = await retryWorkflowRun(input.userId, input.runId);
  } else {
    try {
      workflow = await updateWorkflowRunStatus(
        input.userId,
        input.runId,
        input.action === "pause" ? "paused" : "queued",
        `${input.action}_requested`,
      );
    } catch (error) {
      throw new WorkflowActionError(
        error instanceof Error ? error.message : "当前状态不支持操作",
      );
    }
  }

  if (!workflow)
    throw new WorkflowActionError(`当前状态不支持操作: ${current.status}`);

  if (input.action === "resume" || input.action === "retry") {
    await enqueueWorkflowJob({
      runId: input.runId,
      userId: input.userId,
      projectId: current.projectId,
      maxAttempts: 1,
    });
  }
  return workflow;
}
