import { describe, expect, it } from "vitest";

import type {
  StudioExecutionSpan,
  StudioUsageCost,
  WorkflowStepSummary,
  WorkspaceSnapshot,
} from "../types";
import {
  buildOperationItems,
  filterOperationItems,
  prioritizeFocusedOperation,
  buildTraceRows,
  isOperationDeletable,
  isOperationRetryable,
  operationErrorMessage,
  operationCauseKey,
  operationModelKey,
  operationPhaseKey,
  formatElapsedDuration,
  localizedTraceAttributes,
  traceEventLabel,
  traceEventDisplayStatus,
  traceEventSourceLabel,
  traceAgentLabel,
  traceArtifactLabel,
  traceConfigurationSources,
  traceSpanKindLabel,
  traceSpanLabel,
  type OperationItem,
  summarizeUsageCosts,
  workflowAttemptLabel,
} from "./inspector-view-model";

describe("studio inspector view model", () => {
  it("puts a directly linked workflow or media run at the start of the operations list", () => {
    const items = [
      { id: "step-a", kind: "workflow-step", updatedAt: "1", workflow: { id: "run-a" }, step: { id: "step-a" } },
      { id: "task-b", kind: "task", updatedAt: "2", task: { id: "task-b" } },
    ] as unknown as OperationItem[];
    expect(prioritizeFocusedOperation(items, "task-b").map((item) => item.id)).toEqual(["task-b", "step-a"]);
    expect(prioritizeFocusedOperation(items, "run-a").map((item) => item.id)).toEqual(["step-a", "task-b"]);
    expect(prioritizeFocusedOperation(items)).toBe(items);
  });
  it("filters failed operation items by cause, model, and persisted phase", () => {
    const rateLimited = { id: "media-1", kind: "task", updatedAt: "1", task: {
      id: "media-1", model: "image-a", status: "failed", executionPhase: "failed",
      error: { code: "PROVIDER_HTTP_429", message: "rate limit" },
    } } as unknown as OperationItem;
    const saveFailure = { id: "media-2", kind: "task", updatedAt: "2", task: {
      id: "media-2", model: "image-b", status: "failed", executionPhase: "failed",
      error: { failureStage: "result_storage", message: "download failed" },
    } } as unknown as OperationItem;
    const dependency = { id: "step-1", kind: "workflow-step", updatedAt: "3", workflow: {
      id: "run-1", steps: [],
    }, step: { id: "step-1", status: "blocked", error: { code: "WORKFLOW_DEPENDENCY_BLOCKED" } } } as unknown as OperationItem;

    expect([rateLimited, saveFailure, dependency].map(operationCauseKey)).toEqual([
      "rate_limit", "result_storage", "dependency",
    ]);
    expect(operationModelKey(rateLimited)).toBe("image-a");
    expect(operationPhaseKey(dependency)).toBe("blocked");
    expect(filterOperationItems([rateLimited, saveFailure, dependency], {
      cause: "result_storage", model: "image-b", phase: "failed",
    })).toEqual([saveFailure]);
  });

  it("formats persisted elapsed time without inventing progress for active spans", () => {
    expect(formatElapsedDuration("2026-10-14T10:00:00.000Z", "2026-10-14T10:00:12.500Z", "zh-CN")).toBe("12 秒");
    expect(formatElapsedDuration("2026-10-14T10:00:00.000Z", "2026-10-14T10:02:03.000Z", "en")).toBe("2 min 3 s");
    expect(formatElapsedDuration("invalid", "also-invalid", "en")).toBe("—");
    expect(formatElapsedDuration("2026-10-14T10:00:00.000Z", undefined, "en")).toBe("In progress");
  });
  it("sorts project operations and filters the selected episode", () => {
    const snapshot = {
      project: { episodes: [] },
      workflows: [
        {
          id: "run-project",
          updatedAt: "2026-01-05T00:00:00.000Z",
          steps: [
            {
              id: "step-visual-design",
              completedAt: "2026-01-05T00:01:00.000Z",
              key: "design_asset_visual",
              type: "design_asset_visual",
            },
          ],
        },
        {
          id: "run-1",
          episodeId: "episode-1",
          updatedAt: "2026-01-01T00:00:00.000Z",
          steps: [
            {
              id: "step-parse",
              completedAt: "2026-01-01T00:01:00.000Z",
              key: "parse",
              type: "parse_novel",
            },
            {
              id: "step-split",
              completedAt: "2026-01-01T00:02:00.000Z",
              key: "split",
              type: "split_clips",
            },
            {
              id: "step-screenplay",
              completedAt: "2026-01-01T00:03:00.000Z",
              key: "screenplay",
              type: "generate_screenplay_beats",
            },
          ],
        },
      ],
      tasks: [
        { id: "task-1", episodeId: "episode-1", updatedAt: "2026-01-02T00:00:00.000Z" },
        { id: "task-2", episodeId: "episode-2", updatedAt: "2026-01-03T00:00:00.000Z" },
        { id: "task-project", updatedAt: "2026-01-04T00:00:00.000Z" },
      ],
    } as unknown as WorkspaceSnapshot;

    expect(buildOperationItems(snapshot, "episode-1").map((item) => item.id)).toEqual([
      "step-visual-design",
      "task-project",
      "task-1",
      "step-screenplay",
      "step-split",
      "step-parse",
    ]);
  });

  it("merges granular workflow steps with media tasks", () => {
    const snapshot = {
      project: { episodes: [] },
      workflows: [
        {
          id: "run-1",
          episodeId: "episode-1",
          updatedAt: "2026-01-01T00:00:00.000Z",
          steps: [
            {
              id: "step-1",
              key: "parse",
              type: "parse_novel",
              startedAt: "2026-01-03T00:00:00.000Z",
            },
          ],
        },
      ],
      tasks: [
        {
          id: "task-1",
          episodeId: "episode-1",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    } as unknown as WorkspaceSnapshot;

    expect(buildOperationItems(snapshot, "episode-1")).toMatchObject([
      { id: "step-1", kind: "workflow-step" },
      { id: "task-1", kind: "task" },
    ]);
  });

  it("totals persisted usage costs", () => {
    const costs = [
      { cost: "0.125", quantity: 2 },
      { cost: "0.375", quantity: 3 },
    ] as StudioUsageCost[];
    expect(summarizeUsageCosts(costs)).toEqual({ quantity: 5, total: 0.5 });
  });

  it("allows explicit retries for every failed media task and workflow step", () => {
    const task = {
      id: "task-1",
      kind: "task",
      updatedAt: "2026-01-01T00:00:00.000Z",
      task: {
        status: "failed",
        retryCount: 0,
        maxRetries: 2,
        error: { message: "provider rejected request", retryable: false },
      },
    } as OperationItem;
    expect(isOperationRetryable(task)).toBe(true);
    expect(
      isOperationRetryable({
        id: "task-1",
        kind: "task",
        updatedAt: "2026-01-01T00:00:00.000Z",
        task: {
          status: "failed",
          retryCount: 2,
          maxRetries: 2,
          error: { message: "timeout", retryable: true },
        },
      } as OperationItem),
    ).toBe(true);

    const step = {
      id: "step-1",
      kind: "workflow-step",
      updatedAt: "2026-01-01T00:00:00.000Z",
      workflow: { status: "failed" },
      step: {
        status: "failed",
        retryable: true,
        attempt: 1,
        maxAttempts: 3,
      },
    } as OperationItem;
    expect(isOperationRetryable(step)).toBe(true);
    expect(
      isOperationRetryable({
        ...step,
        workflow: { status: "failed" },
        step: {
          status: "failed",
          retryable: false,
          attempt: 3,
          maxAttempts: 1,
        },
      } as OperationItem),
    ).toBe(true);
  });

  it("exposes one delete action for every terminal workflow", () => {
    const workflow = {
      id: "run-1",
      status: "failed",
      steps: [
        { id: "step-1", status: "succeeded" },
        { id: "step-2", status: "failed" },
        { id: "step-3", status: "pending" },
      ],
    };
    expect(
      isOperationDeletable({
        id: "step-1",
        kind: "workflow-step",
        updatedAt: "",
        workflow,
        step: workflow.steps[0],
      } as OperationItem),
    ).toBe(false);
    expect(
      isOperationDeletable({
        id: "step-2",
        kind: "workflow-step",
        updatedAt: "",
        workflow,
        step: workflow.steps[1],
      } as OperationItem),
    ).toBe(true);
  });

  it("labels run attempts without presenting a manual retry limit", () => {
    const step = {
      status: "failed",
      attempt: 3,
      maxAttempts: 3,
    } as WorkflowStepSummary;
    expect(workflowAttemptLabel(step, "zh-CN")).toBe("第 3 次运行");
    expect(workflowAttemptLabel({ ...step, attempt: 0 }, "en")).toBe("Not run");
    expect(
      operationErrorMessage(
        {
          message:
            "SCREENPLAY_CONVERT_PARTIAL_FAILED:STRUCTURED_PROVIDER_TRANSPORT_FAILED:stage=response_body;attempts=3;timeoutMs=600000;elapsedMs=41872;reason=terminated;causeCode=UND_ERR_SOCKET",
        },
        "zh-CN",
      ),
    ).toContain("不是应用超时");
  });

  it("turns provider failures into actionable localized recovery steps", () => {
    expect(operationErrorMessage({ message: "STRUCTURED_PROVIDER_FAILED:429:rate limit" }, "zh-CN"))
      .toContain("等待限流窗口");
    expect(operationErrorMessage({ message: "STRUCTURED_PROVIDER_FAILED:401:unauthorized" }, "en"))
      .toContain("check the API key");
    expect(operationErrorMessage({ message: "insufficient_quota" }, "zh-CN"))
      .toContain("补足额度");
    expect(operationErrorMessage({ failureStage: "result_storage", message: "MEDIA_DOWNLOAD_FAILED:503" }, "zh-CN"))
      .toContain("重试会复用已保存的模型结果");
    expect(operationErrorMessage({ failureStage: "generation", message: "provider rejected input" }, "en"))
      .toContain("Model generation failed");
  });

  it("explains media budget overrun and missing price blockers", () => {
    expect(operationErrorMessage({ code: "BILLING_MEDIA_BUDGET_EXCEEDED", message: "BILLING_MEDIA_BUDGET_EXCEEDED" }, "zh-CN"))
      .toContain("提高预算");
    expect(operationErrorMessage({ code: "BILLING_MEDIA_BUDGET_PRICE_UNKNOWN", message: "BILLING_MEDIA_BUDGET_PRICE_UNKNOWN" }, "en"))
      .toContain("Configure pricing");
  });

  it("shows the exact unfinished prerequisite on dependency-blocked workflow steps", () => {
    const error = {
      code: "WORKFLOW_DEPENDENCY_BLOCKED",
      blockedSteps: [{
        stepKey: "render",
        waitingOn: [{ stepKey: "storyboard", status: "running" }],
      }],
    };
    expect(operationErrorMessage(error, "zh-CN")).toContain("storyboard（进行中）");
    expect(operationErrorMessage(error, "en")).toContain("storyboard (running)");
  });

  it("builds trace rows from parent span relationships", () => {
    const spans = [
      { spanId: "root" },
      { spanId: "task", parentSpanId: "step" },
      { spanId: "step", parentSpanId: "root" },
    ] as StudioExecutionSpan[];
    expect(
      buildTraceRows(spans).map(({ depth, span }) => [span.spanId, depth]),
    ).toEqual([
      ["root", 0],
      ["step", 1],
      ["task", 2],
    ]);
  });

  it("renders media task events as history unless the latest event is active", () => {
    const event = {
      source: "media_task" as const,
      id: "event-running",
      spanId: "span-media",
      type: "running",
      status: "running",
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    expect(traceEventDisplayStatus(event, "failed", false)).toBe("succeeded");
    expect(traceEventDisplayStatus(event, "running", false)).toBe("succeeded");
    expect(traceEventDisplayStatus(event, "running", true)).toBe("running");
    expect(
      traceEventDisplayStatus(
        { ...event, type: "retry_scheduled", status: "failed" },
        "failed",
        true,
      ),
    ).toBe("failed");
  });

  it("localizes trace labels without hiding diagnostic values", () => {
    const artifact = {
      spanId: "artifact-1",
      kind: "workflow_artifact",
      name: "screenplay.clip #1",
      status: "failed",
      startedAt: "2026-01-01T00:00:00.000Z",
      attributes: {
        artifactType: "screenplay.clip",
        clipIndex: 0,
        success: false,
        provider: null,
        error: "STRUCTURED_SCHEMA_INVALID:scenes.0.content.17",
      },
    } satisfies StudioExecutionSpan;

    expect(traceSpanLabel(artifact, "zh-CN")).toBe("剧本片段 1");
    expect(
      traceSpanLabel(
        {
          ...artifact,
          name: "asset-visual-design",
          kind: "workflow_run",
          attributes: {},
        },
        "zh-CN",
      ),
    ).toBe("AI 视觉设计");
    expect(
      traceSpanLabel(
        {
          ...artifact,
          name: "asset.visual-profile",
          attributes: { artifactType: "asset.visual-profile" },
        },
        "zh-CN",
      ),
    ).toBe("资产视觉设定");
    expect(traceSpanKindLabel(artifact.kind, "zh-CN")).toBe("中间结果");
    expect(traceEventLabel("artifact_committed", "zh-CN")).toBe(
      "中间结果已保存",
    );
    expect(traceEventLabel("queued", "zh-CN")).toBe("等待后台执行");
    expect(traceEventLabel("blocked", "zh-CN", "步骤 B 等待前置步骤：A（进行中）")).toBe("等待前置步骤");
    expect(traceEventLabel("blocked", "zh-CN")).toBe("等待人工确认");
    expect(traceEventSourceLabel("workflow", "zh-CN")).toBe("工作流");
    expect(traceAgentLabel("production_storyboard-generation", "zh-CN")).toBe("分镜生成");
    expect(traceAgentLabel("custom_agent", "en")).toBe("Custom agent");
    expect(traceArtifactLabel("screenplay.clip", "zh-CN")).toBe("剧本片段");
    expect(traceConfigurationSources([
      { scopeKey: "project:project-1", version: 4 },
      { scopeKey: "episode:episode-1", version: 2 },
      { scopeKey: "invalid", version: 9 },
      { scopeKey: "panel:panel-1", version: "bad" },
      { scopeKey: "user", version: 3 },
    ], "zh-CN")).toEqual([
      "项目:project-1 v4", "剧集:episode-1 v2", "invalid v9", "镜头:panel-1", "个人 v3",
    ]);
    expect(localizedTraceAttributes(artifact.attributes, "zh-CN")).toMatchObject({
      "片段序号": 0,
      "是否成功": false,
      "错误详情": "STRUCTURED_SCHEMA_INVALID:scenes.0.content.17",
    });
    expect(localizedTraceAttributes(artifact.attributes, "zh-CN")).not.toHaveProperty(
      "模型渠道",
    );
    expect(localizedTraceAttributes({ reused: true, reuseReason: "cache_fingerprint_match",
      cacheVersion: "workflow-cache-v2", promptVersion: "5", promptVersionHash: "prompt-hash" }, "zh-CN"))
      .toMatchObject({
        "复用已有结果": true,
        "复用原因": "cache_fingerprint_match",
        "缓存指纹版本": "workflow-cache-v2",
        "提示词版本": "5",
        "提示词版本摘要": "prompt-hash",
      });
    expect(localizedTraceAttributes({ fallbackUsed: true, fallbackReason: "http_503", fallbackPriceCompatibility: "different" }, "zh-CN"))
      .toMatchObject({ "降级原因": "http_503", "备用模型价格兼容性": "different" });
  });
});
