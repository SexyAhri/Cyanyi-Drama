import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StudioProjectModelMetrics } from "../types";
import { ModelMetricsTable, usageCostActionLabel } from "./costs-panel";

const rows: StudioProjectModelMetrics["rows"] = [{
  executionKind: "workflow", channelId: "channel-1", channel: "Text channel", model: "deepseek-v4-flash",
  attempts: 12, succeeded: 11, failed: 1, canceled: 0, successRate: 11 / 12, rateLimited: 1,
  durationSamples: 12, averageDurationMs: 24_500, recordedCost: "0.42", cachedRequestsReused: 2, estimatedCreditSavings: null,
}];

describe("project model statistics table", () => {
  it.each(["zh-CN", "en"] as const)("renders localized complete statistics in a responsive table (%s)", (locale) => {
    const html = renderToStaticMarkup(createElement(ModelMetricsTable, { locale, rows }));
    expect(html).toContain("<table");
    expect(html).toContain("min-w-[1050px]");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("deepseek-v4-flash");
    expect(html).toContain("Text channel");
    expect(html).toContain("24.5 s · 12");
    expect(html).toContain("11/12");
    expect(html).toContain("0.42");
    expect(html).toContain("2");
    expect(html).not.toContain("grid-cols-2");
  });
});

describe("localized project billing labels", () => {
  it("translates persisted English descriptions and machine target types for Chinese users", () => {
    expect(usageCostActionLabel("Agent test run estimate", "zh-CN")).toBe("Agent 试运行费用估算");
    expect(usageCostActionLabel("canvas_node", "zh-CN")).toBe("画布节点生成");
    expect(usageCostActionLabel("character_appearance", "zh-CN")).toBe("角色形象图生成");
    expect(usageCostActionLabel("some_new_enum", "zh-CN")).toBe("其他模型任务");
  });

  it("keeps the persisted action text in English locale", () => {
    expect(usageCostActionLabel("Agent test run estimate", "en")).toBe("Agent test run estimate");
  });
});
