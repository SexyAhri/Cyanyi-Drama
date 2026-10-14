import { prisma } from "@/lib/server/prisma";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { assertConfigurationScope } from "@/lib/production-configuration/store";
import { classifyProviderFailure } from "@/lib/providers/failure-classification";

const WINDOW_DAYS = 30;
const MAX_ROWS = 5_000;

type MetricInput = {
  tasks: Array<{
    id: string;
    channelId: string | null;
    provider: string;
    model: string;
    status: string;
    error: unknown;
    startedAt: Date | null;
    completedAt: Date | null;
  }>;
  attempts: Array<{
    id?: string;
    provider: string | null;
    modelKey: string | null;
    status: string;
    errorCode: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
  }>;
  cacheEvents: Array<{ payload: unknown }>;
  costs: Array<{ sourceId: string | null; sourceType?: string | null; cost: { toString(): string }; model?: string; metadata?: string | null }>;
  channelNames: Map<string, string>;
};

export type ProjectModelMetric = {
  executionKind: "media" | "workflow" | "conversation";
  channelId: string | null;
  channel: string;
  model: string;
  attempts: number;
  succeeded: number;
  failed: number;
  canceled: number;
  successRate: number | null;
  rateLimited: number;
  durationSamples: number;
  averageDurationMs: number | null;
  recordedCost: string | null;
  cachedRequestsReused: number;
  estimatedCreditSavings: null;
};

export type ProjectModelMetrics = {
  since: string;
  until: string;
  windowDays: number;
  sampled: boolean;
  rows: ProjectModelMetric[];
};

export function summarizeProjectModelMetrics(input: MetricInput) {
  const buckets = new Map<string, {
    executionKind: "media" | "workflow" | "conversation";
    channelId: string | null;
    model: string;
    attempts: number;
    succeeded: number;
    failed: number;
    canceled: number;
    rateLimited: number;
    durationTotal: number;
    durationSamples: number;
    credits: number;
    cachedRequestsReused: number;
    hasRecordedCost: boolean;
  }>();
  const mediaCostByTask = new Map<string, number>();
  const workflowCostByAttempt = new Map<string, number>();
  for (const cost of input.costs) {
    if (!cost.sourceId || !["media_task", "workflow_step_attempt"].includes(cost.sourceType ?? "media_task")) continue;
    const value = Number(cost.cost.toString());
    if (!Number.isFinite(value)) continue;
    const target = cost.sourceType === "workflow_step_attempt" ? workflowCostByAttempt : mediaCostByTask;
    target.set(cost.sourceId, (target.get(cost.sourceId) ?? 0) + value);
  }

  function bucket(kind: "media" | "workflow" | "conversation", channelId: string | null, model: string) {
    const key = `${kind}\u0000${channelId ?? "unknown"}\u0000${model || "unknown"}`;
    let row = buckets.get(key);
    if (!row) {
      row = {
        executionKind: kind,
        channelId,
        model: model || "unknown",
        attempts: 0,
        succeeded: 0,
        failed: 0,
        canceled: 0,
        rateLimited: 0,
        durationTotal: 0,
        durationSamples: 0,
        credits: 0,
        cachedRequestsReused: 0,
        hasRecordedCost: false,
      };
      buckets.set(key, row);
    }
    return row;
  }

  for (const task of input.tasks) {
    const row = bucket("media", task.channelId, task.model);
    row.attempts += 1;
    if (task.status === "succeeded") row.succeeded += 1;
    else if (task.status === "failed") row.failed += 1;
    else if (task.status === "canceled") row.canceled += 1;
    const error = isRecord(task.error) ? task.error : {};
    if (classifyProviderFailure(`${String(error.code ?? "")} ${String(error.message ?? "")}`) === "rate_limit") row.rateLimited += 1;
    addDuration(row, task.startedAt, task.completedAt);
    if (mediaCostByTask.has(task.id)) {
      row.credits += mediaCostByTask.get(task.id)!;
      row.hasRecordedCost = true;
    }
  }

  const actualWorkflowCosts = input.costs.filter(cost => cost.sourceType === "workflow_step_attempt" && cost.model && cost.metadata);
  const billedAttempts = new Set(actualWorkflowCosts.map(cost => cost.sourceId));
  for (const attempt of input.attempts) {
    if (attempt.id && billedAttempts.has(attempt.id)) continue;
    if (!attempt.provider || !attempt.modelKey) continue;
    const row = bucket("workflow", attempt.provider, attempt.modelKey);
    row.attempts += 1;
    if (attempt.status === "succeeded") row.succeeded += 1;
    else if (attempt.status === "failed") row.failed += 1;
    else if (attempt.status === "canceled") row.canceled += 1;
    if (attempt.errorCode === "PROVIDER_RATE_LIMIT") row.rateLimited += 1;
    addDuration(row, attempt.startedAt, attempt.finishedAt);
    if (attempt.id && workflowCostByAttempt.has(attempt.id)) {
      row.credits += workflowCostByAttempt.get(attempt.id)!;
      row.hasRecordedCost = true;
    }
  }

  for (const cost of input.costs) {
    if (!(cost.sourceType === "model_request" || actualWorkflowCosts.includes(cost))) continue;
    let metadata: Record<string, unknown> = {};
    try { const parsed = JSON.parse(cost.metadata ?? "{}"); if (isRecord(parsed)) metadata = parsed; } catch { /* Legacy metadata can be empty. */ }
    const row = bucket(cost.sourceType === "workflow_step_attempt" ? "workflow" : "conversation", stringValue(metadata.channelId), cost.model ?? "unknown");
    row.attempts += 1;
    row.succeeded += 1;
    row.credits += Number(cost.cost.toString());
    row.hasRecordedCost = true;
  }

  const reusedRequests = new Set<string>();
  for (const event of input.cacheEvents) {
    if (!isRecord(event.payload) || event.payload.reused !== true) continue;
    const channelId = stringValue(event.payload.provider);
    const model = stringValue(event.payload.model);
    const requestId = stringValue(event.payload.requestId);
    if (!requestId) continue;
    const key = `${channelId ?? "unknown"}\u0000${model ?? "unknown"}\u0000${requestId}`;
    if (reusedRequests.has(key)) continue;
    reusedRequests.add(key);
    bucket("workflow", channelId, model ?? "unknown").cachedRequestsReused += 1;
  }

  return [...buckets.values()]
    .map((row): ProjectModelMetric => ({
      executionKind: row.executionKind,
      channelId: row.channelId,
      channel: row.channelId ? input.channelNames.get(row.channelId) ?? row.channelId : "Unknown channel",
      model: row.model,
      attempts: row.attempts,
      succeeded: row.succeeded,
      failed: row.failed,
      canceled: row.canceled,
      successRate: row.succeeded + row.failed ? row.succeeded / (row.succeeded + row.failed) : null,
      rateLimited: row.rateLimited,
      durationSamples: row.durationSamples,
      averageDurationMs: row.durationSamples ? Math.round(row.durationTotal / row.durationSamples) : null,
      recordedCost: row.hasRecordedCost ? row.credits.toFixed(6).replace(/\.?0+$/, "") : null,
      cachedRequestsReused: row.cachedRequestsReused,
      estimatedCreditSavings: null,
    }))
    .sort((left, right) => (right.attempts + right.cachedRequestsReused) - (left.attempts + left.cachedRequestsReused));
}

export async function getProjectModelMetrics(userId: string, projectId: string, now = new Date()): Promise<ProjectModelMetrics | null> {
  await assertConfigurationScope(userId, { projectId });
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const where = { userId, projectId, createdAt: { gte: since } };
  const [taskCount, tasks, attemptCount, attempts, cacheEventCount, cacheEvents, costCount, costs] = await Promise.all([
    prisma.mediaTask.count({ where }),
    prisma.mediaTask.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
      select: { id: true, channelId: true, provider: true, model: true, status: true, error: true, startedAt: true, completedAt: true },
    }),
    prisma.workflowStepAttempt.count({ where: { run: { userId, projectId }, createdAt: { gte: since } } }),
    prisma.workflowStepAttempt.findMany({
      where: { run: { userId, projectId }, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
      select: { id: true, provider: true, modelKey: true, status: true, errorCode: true, startedAt: true, finishedAt: true },
    }),
    prisma.workflowEvent.count({ where: { run: { userId, projectId }, type: "request_succeeded", createdAt: { gte: since } } }),
    prisma.workflowEvent.findMany({
      where: { run: { userId, projectId }, type: "request_succeeded", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
      select: { payload: true },
    }),
    prisma.usageCost.count({ where: { userId, projectId, sourceType: { in: ["media_task", "workflow_step_attempt", "model_request"] }, createdAt: { gte: since } } }),
    prisma.usageCost.findMany({
      where: { userId, projectId, sourceType: { in: ["media_task", "workflow_step_attempt", "model_request"] }, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
      select: { sourceId: true, sourceType: true, cost: true, model: true, metadata: true },
    }),
  ]);
  const channelIds = [...new Set([
    ...costs.flatMap(cost => { try { const metadata = JSON.parse(cost.metadata ?? "{}"); return isRecord(metadata) ? [stringValue(metadata.channelId)] : []; } catch { return []; } }),
    ...tasks.map((task) => task.channelId),
    ...attempts.map((attempt) => attempt.provider),
    ...cacheEvents.flatMap((event) => isRecord(event.payload) ? [stringValue(event.payload.provider)] : []),
  ].filter((value): value is string => !!value))];
  const channels = channelIds.length
    ? await prisma.channel.findMany({
        where: { ...accessibleChannelWhere(userId), id: { in: channelIds } },
        select: { id: true, name: true },
      })
    : [];
  const rows = summarizeProjectModelMetrics({
    tasks,
    attempts,
    cacheEvents,
    costs,
    channelNames: new Map(channels.map((channel) => [channel.id, channel.name])),
  });
  return {
    since: since.toISOString(),
    until: now.toISOString(),
    windowDays: WINDOW_DAYS,
    sampled: taskCount > tasks.length || attemptCount > attempts.length || cacheEventCount > cacheEvents.length || costCount > costs.length,
    rows,
  };
}

function addDuration(row: { durationTotal: number; durationSamples: number }, start: Date | null, end: Date | null) {
  if (!start || !end || end < start) return;
  row.durationTotal += end.getTime() - start.getTime();
  row.durationSamples += 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
