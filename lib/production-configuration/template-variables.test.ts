import { describe, expect, it } from "vitest";
import { insertTemplateVariable, inspectTemplateVariables, previewTemplateVariables, validateAgentTemplateVariables } from "./template-variables";

describe("Agent template variables", () => {
  it("reports missing and unknown placeholders before save", () => {
    expect(inspectTemplateVariables("{{source}} {{invented}}", ["source", "library"])).toEqual({
      missing: ["library"],
      unknown: ["invented"],
    });
  });

  it("previews actual values when available and labels sample values otherwise", () => {
    expect(previewTemplateVariables("Input: {{source}} · {{library}}", { source: "short sample" })).toBe(
      "Input: short sample · ⟦library⟧",
    );
  });

  it("inserts a variable at the selection and returns the next cursor position", () => {
    expect(insertTemplateVariable("Input: old text", "source", 7, 15)).toEqual({
      template: "Input: {{source}}",
      cursor: 17,
    });
  });

  it("preflights every configured Agent template before publishing", () => {
    const catalog = [{ id: "agent-a", variables: ["source", "library"] }];
    expect(validateAgentTemplateVariables({ "agent-a": { templateZh: "{{source}}" } }, catalog)).toContain("缺少变量");
    expect(validateAgentTemplateVariables({ "agent-a": { templateEn: "{{source}} {{unknown}} {{library}}" } }, catalog)).toContain("未知变量");
    expect(validateAgentTemplateVariables({ unknown: { templateZh: "{{source}}" } }, catalog)).toContain("未知 Agent");
    expect(validateAgentTemplateVariables({ "agent-a": { templateZh: "{{source}} {{library}}" } }, catalog)).toBeNull();
  });
});
