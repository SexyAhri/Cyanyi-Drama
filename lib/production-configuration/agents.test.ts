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
    expect(() => validateConfigurationAgents({ agents: { [PROMPT_IDS.STUDIO_WORKFLOW_AGENT]: { disabledOperations: ["invented-tool"] } } })).toThrow(/未实现/);
    expect(() => validateConfigurationAgents({ agents: { [PROMPT_IDS.STORY_CHARACTER_ANALYSIS]: { templateZh: "{{source_text}} {{character_library}}" } } })).not.toThrow();
  });
});
