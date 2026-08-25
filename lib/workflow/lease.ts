import { prisma } from "@/lib/server/prisma";

const DEFAULT_WORKFLOW_LEASE_MS = 30_000;
const MIN_WORKFLOW_LEASE_MS = 5_000;

export type WorkflowControlReason =
  | "canceled"
  | "lease_lost"
  | "paused"
  | "terminal";

export class WorkflowControlError extends Error {
  constructor(
    readonly reason: WorkflowControlReason,
    runId: string,
  ) {
    super(`WORKFLOW_${reason.toUpperCase()}:${runId}`);
  }
}

export function getWorkflowLeaseMs() {
  const configured = Number(process.env.WORKFLOW_RUN_LEASE_MS);
  return Number.isFinite(configured) && configured >= MIN_WORKFLOW_LEASE_MS
    ? Math.floor(configured)
    : DEFAULT_WORKFLOW_LEASE_MS;
}

export async function claimWorkflowRunLease(input: {
  runId: string;
  userId: string;
  workerId: string;
  leaseMs?: number;
}) {
  const now = new Date();
  const leaseExpiresAt = new Date(
    now.getTime() +
      Math.max(MIN_WORKFLOW_LEASE_MS, input.leaseMs ?? getWorkflowLeaseMs()),
  );
  const result = await prisma.workflowRun.updateMany({
    where: {
      id: input.runId,
      userId: input.userId,
      status: { in: ["queued", "running", "canceling"] },
      OR: [
        { leaseOwner: null },
        { leaseOwner: input.workerId },
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lt: now } },
      ],
    },
    data: {
      leaseOwner: input.workerId,
      leaseExpiresAt,
      heartbeatAt: now,
      updatedAt: now,
    },
  });
  return result.count > 0;
}

export async function renewWorkflowRunLease(input: {
  runId: string;
  userId: string;
  workerId: string;
  leaseMs?: number;
}) {
  const now = new Date();
  const leaseExpiresAt = new Date(
    now.getTime() +
      Math.max(MIN_WORKFLOW_LEASE_MS, input.leaseMs ?? getWorkflowLeaseMs()),
  );
  const result = await prisma.workflowRun.updateMany({
    where: {
      id: input.runId,
      userId: input.userId,
      leaseOwner: input.workerId,
      status: { in: ["queued", "running", "canceling"] },
    },
    data: { leaseExpiresAt, heartbeatAt: now, updatedAt: now },
  });
  return result.count > 0;
}

export async function releaseWorkflowRunLease(input: {
  runId: string;
  workerId: string;
}) {
  await prisma.workflowRun.updateMany({
    where: { id: input.runId, leaseOwner: input.workerId },
    data: { leaseOwner: null, leaseExpiresAt: null },
  });
}

export async function assertWorkflowRunActive(input: {
  runId: string;
  workerId: string;
}) {
  const run = await prisma.workflowRun.findUnique({
    where: { id: input.runId },
    select: {
      status: true,
      leaseOwner: true,
      leaseExpiresAt: true,
    },
  });
  if (
    !run ||
    run.leaseOwner !== input.workerId ||
    !run.leaseExpiresAt ||
    run.leaseExpiresAt.getTime() <= Date.now()
  )
    throw new WorkflowControlError("lease_lost", input.runId);
  if (run.status === "canceling" || run.status === "canceled")
    throw new WorkflowControlError("canceled", input.runId);
  if (run.status === "paused")
    throw new WorkflowControlError("paused", input.runId);
  if (!["queued", "running"].includes(run.status))
    throw new WorkflowControlError("terminal", input.runId);
}

export async function withWorkflowRunLease<T>(input: {
  runId: string;
  userId: string;
  workerId: string;
  leaseMs?: number;
  run: () => Promise<T>;
}): Promise<{ claimed: boolean; result: T | null }> {
  const leaseMs = input.leaseMs ?? getWorkflowLeaseMs();
  const claimed = await claimWorkflowRunLease({ ...input, leaseMs });
  if (!claimed) return { claimed: false, result: null };

  const timer = setInterval(
    () => {
      void renewWorkflowRunLease({ ...input, leaseMs }).catch((error) => {
        console.error("[workflow] lease renewal failed", error);
      });
    },
    Math.max(MIN_WORKFLOW_LEASE_MS, Math.floor(leaseMs / 3)),
  );
  timer.unref?.();

  try {
    return { claimed: true, result: await input.run() };
  } finally {
    clearInterval(timer);
    await releaseWorkflowRunLease(input);
  }
}
