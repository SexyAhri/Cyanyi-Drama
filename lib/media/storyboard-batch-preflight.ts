import { Prisma } from "@prisma/client";

import { previewStoryboardPanelPrompt, type StoryboardPromptPreview, ProjectAssetTaskError } from "@/lib/media/project-asset-tasks";
import { quantityForBillingUnit } from "@/lib/billing/service";
import { getMediaBudgetSummary } from "@/lib/billing/media-budget";
import { prisma } from "@/lib/server/prisma";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { isMediaChannelProtocol } from "@/lib/providers/media/registry";
import type { MediaGenerationDefaults } from "@/lib/settings/runtime-contract";

export type StoryboardBatchPreflightItemInput = {
  panelId: string;
  prompt?: string;
  mode?: "reference" | "first-last";
  lastFramePanelId?: string;
  previewConfigurationHash?: string;
  previewRequestHash?: string;
};

export type StoryboardBatchPreflightIssue = {
  blocking: boolean;
  code: string;
  message: string;
};

export type StoryboardBatchPreflightResult = {
  items: Array<{
    panelId: string;
    preview: StoryboardPromptPreview | null;
    issues: StoryboardBatchPreflightIssue[];
  }>;
  quota: {
    status: "sufficient" | "insufficient" | "unknown";
    availableCredits: string | null;
    estimatedCredits: string | null;
    providerBalance: "unavailable";
  };
  requestCount: number;
  projectBudget: Awaited<ReturnType<typeof getMediaBudgetSummary>>;
  batchBudget: { configured: boolean; limit: string | null; estimate: string | null; exceeds: boolean };
  blockers: StoryboardBatchPreflightIssue[];
};

export async function preflightStoryboardBatch(input: {
  userId: string;
  projectId: string;
  episodeId: string;
  channelId: string;
  model: string;
  kind: "image" | "video";
  mode?: "reference" | "first-last";
  ratio?: string;
  resolution?: string;
  duration?: string;
  batchBudgetLimit?: string | number | null;
  items: StoryboardBatchPreflightItemInput[];
  mediaDefaults: MediaGenerationDefaults;
}): Promise<StoryboardBatchPreflightResult> {
  const channel = await prisma.channel.findFirst({
    where: accessibleChannelWhere(input.userId, input.channelId),
    select: { id: true, providerKey: true, protocol: true },
  });
  const selectedModel = channel && isMediaChannelProtocol(channel.protocol)
    ? await prisma.providerModel.findFirst({
        where: {
          channelId: input.channelId,
          modelId: input.model,
          selected: true,
          OR: [
            { modelType: input.kind },
            { capabilitiesJson: { contains: `"${input.kind}"` } },
          ],
        },
        select: { id: true },
      })
    : null;
  const modelIssue: StoryboardBatchPreflightIssue | null = !channel || !isMediaChannelProtocol(channel.protocol)
    ? { blocking: true, code: "invalid_media_channel", message: "所选媒体渠道不存在、无权访问或协议不受支持" }
    : !selectedModel
      ? { blocking: true, code: "invalid_media_model", message: `所选渠道未启用该${input.kind === "image" ? "图片" : "视频"}模型` }
      : null;

  const activeTasks = await prisma.mediaTask.findMany({
    where: {
      userId: input.userId,
      targetType: "storyboard_panel",
      targetId: { in: input.items.map((item) => item.panelId) },
      kind: input.kind,
      status: { in: ["queued", "running"] },
    },
    select: { targetId: true },
  });
  const activePanelIds = new Set(activeTasks.map((task) => task.targetId));
  const seenPanels = new Set<string>();

  const items = await Promise.all(input.items.map(async (item) => {
    const issues: StoryboardBatchPreflightIssue[] = [];
    let preview: StoryboardPromptPreview | null = null;
    if (seenPanels.has(item.panelId)) {
      issues.push({ blocking: true, code: "duplicate_panel", message: "同一镜头不能在一个批次中重复提交" });
    }
    seenPanels.add(item.panelId);
    if (modelIssue) issues.push(modelIssue);
    if (activePanelIds.has(item.panelId)) {
      issues.push({ blocking: true, code: "panel_generation_active", message: "该镜头已有同类型任务正在排队或运行" });
    }
    if (!modelIssue) {
      try {
        preview = await previewStoryboardPanelPrompt({
          userId: input.userId,
          projectId: input.projectId,
          episodeId: input.episodeId,
          panelId: item.panelId,
          kind: input.kind,
          mode: item.mode ?? input.mode,
          prompt: item.prompt,
          lastFramePanelId: item.lastFramePanelId,
          channelId: input.channelId,
          model: input.model,
          ratio: input.ratio,
          resolution: input.resolution,
          duration: input.duration,
          mediaDefaults: input.mediaDefaults,
        });
        issues.push(...preview.issues);
        if (item.previewConfigurationHash && preview.configurationHash !== item.previewConfigurationHash) {
          issues.push({ blocking: true, code: "stale_configuration_preview", message: "制作配置在预览后已变化，请重新检查本批设置" });
        }
        if (item.previewRequestHash && preview.requestHash !== item.previewRequestHash) {
          issues.push({ blocking: true, code: "stale_request_preview", message: "实际请求参数或素材在预览后已变化，请重新检查本批设置" });
        }
      } catch (error) {
        issues.push({
          blocking: true,
          code: error instanceof ProjectAssetTaskError ? `preflight_${error.status}` : "preflight_failed",
          message: error instanceof Error ? error.message : "无法完成该镜头的生成前检查",
        });
      }
    }
    return { panelId: item.panelId, preview, issues };
  }));

  const billableRequests: Array<Record<string, unknown>> = [];
  for (const item of items) {
    const { preview } = item;
    if (!preview || item.issues.some((issue) => issue.blocking)) continue;
    if (input.kind === "video") {
      billableRequests.push(...(preview.segments?.length ? preview.segments : [{ durationSeconds: 5, prompt: preview.finalPrompt }]).map((segment) => ({
        prompt: segment.prompt,
        duration: `${segment.durationSeconds}s`,
      })));
    } else {
      billableRequests.push({ prompt: preview.finalPrompt, count: input.mediaDefaults.imageGenerationCount ?? 1 });
    }
  }
  const prices = channel && billableRequests.length
    ? await prisma.modelPrice.findMany({
        where: { provider: channel.providerKey, model: input.model, capability: input.kind, active: true },
        select: { unit: true, unitPrice: true },
      })
    : [];
  const balance = prices.length ? await prisma.userBalance.findUnique({
    where: { userId: input.userId },
    select: { balance: true, frozenAmount: true },
  }) : null;
  const estimated = estimateMediaBatchCharge(prices, billableRequests);
  const available = balance
    ? balance.balance.sub(balance.frozenAmount)
    : prices.length ? new Prisma.Decimal(0) : null;
  const quotaStatus = estimated === null || available === null
    ? "unknown"
    : available.lt(estimated) ? "insufficient" : "sufficient";
  const blockers = items.flatMap((item) => item.issues.filter((issue) => issue.blocking));
  if (quotaStatus === "insufficient") {
    blockers.push({ blocking: true, code: "insufficient_credits", message: "当前可用余额不足以提交本批次已配置计费的任务" });
  }
  const projectBudget = await getMediaBudgetSummary({ userId: input.userId, projectId: input.projectId, scope: { type: "project", id: input.projectId } });
  if (projectBudget.configured && billableRequests.length) {
    if (estimated === null) blockers.push({ blocking: true, code: "media_budget_price_unknown", message: "项目启用了媒体预算，但模型没有计价配置；无法安全确认本批次是否在预算内" });
    else if (projectBudget.exceeded || new Prisma.Decimal(estimated).gt(projectBudget.remaining ?? "0")) {
      blockers.push({ blocking: true, code: "media_project_budget_exceeded", message: "本批次预计额度将超过项目媒体预算剩余额度" });
    }
  }
  let batchBudget: StoryboardBatchPreflightResult["batchBudget"] = { configured: false, limit: null, estimate: estimated?.toString() ?? null, exceeds: false };
  if (input.batchBudgetLimit !== undefined && input.batchBudgetLimit !== null) {
    const limit = new Prisma.Decimal(input.batchBudgetLimit);
    const exceeds = estimated === null ? billableRequests.length > 0 : estimated.gt(limit);
    batchBudget = { configured: true, limit: limit.toString(), estimate: estimated?.toString() ?? null, exceeds };
    if (exceeds) blockers.push({ blocking: true, code: estimated === null ? "media_batch_budget_price_unknown" : "media_batch_budget_exceeded", message: estimated === null ? "设置了批次预算，但模型没有计价配置，无法确认是否在预算内" : "本批次预计额度将超过设定的批次预算" });
  }

  return {
    items,
    requestCount: billableRequests.length,
    projectBudget,
    batchBudget,
    quota: {
      status: quotaStatus,
      availableCredits: available?.toString() ?? null,
      estimatedCredits: estimated?.toString() ?? null,
      providerBalance: "unavailable",
    },
    blockers,
  };
}

export function estimateMediaBatchCharge(
  prices: Array<{ unit: string; unitPrice: Prisma.Decimal | string | number }>,
  requests: Array<Record<string, unknown>>,
) {
  if (!prices.length || !requests.length) return null;
  return requests.reduce((total, request) => total.add(prices.reduce(
    (requestTotal, price) => requestTotal.add(
      new Prisma.Decimal(price.unitPrice).mul(quantityForBillingUnit(price.unit, request)),
    ),
    new Prisma.Decimal(0),
  )), new Prisma.Decimal(0));
}
