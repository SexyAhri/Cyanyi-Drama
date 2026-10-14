import { describe, expect, it } from "vitest";
import { PROMPT_IDS, renderPrompt } from "@/lib/prompts";
import { applyConfiguredAgentPrompt, validateConfigurationAgents } from "./agents";
import { mergeProductionConfigurations } from "./contract";
const prompt = () => renderPrompt({ id: PROMPT_IDS.STORY_CHARACTER_ANALYSIS, variables: { source_text: "SOURCE: {{do_not_execute}}", character_library: "[]" } });
describe("configured Agent prompts", () => {
  it("renders variables once, keeps platform rules and changes request/cache provenance", () => {
    const original = { ...prompt(), platformContract: "IMMUTABLE SCHEMA CONTRACT" };
    const snapshot = { ...mergeProductionConfigurations([{ agents: { [original.id]: { templateZh: "New task {{source_text}} library {{character_library}}", responsibility: "Precise evidence", systemInstructions: "Only supplied facts" } } }]), format: "production-configuration-v1" as const, sources: [{ scopeKey: "user", version: 3 }] };
    const configured = applyConfiguredAgentPrompt(original, snapshot);
    expect(configured.text).toContain("New task SOURCE: {{do_not_execute}}");
    expect(configured.text).toContain("IMMUTABLE SCHEMA CONTRACT"); expect(configured.systemText).toContain("Only supplied facts");
    expect(configured.versionHash).not.toBe(original.versionHash); expect(original.text).not.toContain("New task");
    expect(applyConfiguredAgentPrompt(original, { ...snapshot, sources: [{ scopeKey: "user", version: 4 }] }).versionHash).not.toBe(configured.versionHash);
  });
  it("rejects missing/unknown variables, invented Agents/tools and partial provider selection", () => {
    expect(() => validateConfigurationAgents({ agents: { [PROMPT_IDS.STORY_CHARACTER_ANALYSIS]: { templateZh: "{{source_text}} {{unknown}}" } } })).toThrow(/未知变量.*缺少变量/);
    expect(() => validateConfigurationAgents({ agents: { invented: {} } })).toThrow(/未知 Agent/);
    expect(() => validateConfigurationAgents({ agents: { [PROMPT_IDS.STORY_CHARACTER_ANALYSIS]: { channelId: "c" } } })).toThrow(/同时/);
    expect(() => validateConfigurationAgents({ agents: { [PROMPT_IDS.STORY_CHARACTER_ANALYSIS]: { fallbackChannelId: "c" } } })).toThrow(/备用模型和渠道必须同时/);
    expect(() => validateConfigurationAgents({ agents: { [PROMPT_IDS.STORY_CHARACTER_ANALYSIS]: { channelId: "c", model: "m", fallbackChannelId: "c", fallbackModel: "m" } } })).toThrow(/备用模型必须与主模型不同/);
    expect(() => validateConfigurationAgents({ agents: { [PROMPT_IDS.STUDIO_WORKFLOW_AGENT]: { disabledOperations: ["invented-tool"] } } })).toThrow(/未实现/);
    expect(() => validateConfigurationAgents({ agents: { [PROMPT_IDS.STORY_CHARACTER_ANALYSIS]: { templateZh: "{{source_text}} {{character_library}}" } } })).not.toThrow();
  });
  it("injects acceptance and quality criteria while retaining the system output contract", () => {
    const original = { ...prompt(), platformContract: "SERVER-ENFORCED SCHEMA" };
    const snapshot = {
      ...mergeProductionConfigurations([{ agents: { [original.id]: {
        taskScope: "本剧集当前段落",
        templateZh: "{{source_text}} {{character_library}}",
        acceptanceCriteria: "每个结论都引用输入证据。",
        stopConditions: "发现来源缺失时停止。",
        styleRequirements: "用简洁中文。",
        examples: "结论：……\n依据：……",
        qualityChecks: ["不得编造", "保留原顺序"],
        maxCorrections: 2,
      } } }]),
      format: "production-configuration-v1" as const,
      sources: [{ scopeKey: "project:p", version: 3 }],
    };
    const configured = applyConfiguredAgentPrompt(original, snapshot);
    expect(configured.systemText).toContain("每个结论都引用输入证据。");
    expect(configured.systemText).toContain("本剧集当前段落");
    expect(configured.systemText).toContain("发现来源缺失时停止。");
    expect(configured.systemText).toContain("用简洁中文。");
    expect(configured.systemText).toContain("结论：……");
    expect(configured.systemText).toContain("不得编造");
    expect(configured.systemText).toContain("保留原顺序");
    expect(configured.text).toContain("SERVER-ENFORCED SCHEMA");
    expect(configured.maxSemanticCorrections).toBe(2);
  });
});
