import { describe, expect, it } from "vitest";
import { PROMPT_IDS, renderPrompt } from "./index";
import { PRODUCTION_AGENT_CONTRACTS, withProductionRules } from "./production-rules";
import { getConfigurationAgentCatalog, applyConfiguredAgentPrompt } from "@/lib/production-configuration/agents";
import { mergeProductionConfigurations } from "@/lib/production-configuration/contract";

const tasks = [
  "storyboard-generation",
  "storyboard-review",
  "storyboard-repair",
  "video-prompt-generation",
  "asset-prompt-generation",
  "script-generation",
] as const;

describe("production task Agents", () => {
  it("registers six distinct responsibilities, scopes, acceptance criteria and stop rules", () => {
    const catalog = getConfigurationAgentCatalog();
    for (const task of tasks) {
      const agent = catalog.find((item) => item.id === `production_${task}`);
      expect(agent?.responsibility).toBe(PRODUCTION_AGENT_CONTRACTS[task].responsibility);
      expect(agent?.taskScope).toBeTruthy();
      expect(agent?.acceptanceCriteria).toBeTruthy();
      expect(agent?.stopConditions).toBeTruthy();
      expect(agent?.qualityChecks).toEqual(PRODUCTION_AGENT_CONTRACTS[task].qualityChecks);
      expect(agent?.variables).toEqual(["task_snapshot"]);
    }
  });

  it("binds production-rule prompts to the matching task Agent and freezes their input", () => {
    const original = renderPrompt({
      id: PROMPT_IDS.STORYBOARD_MEDIA_PROMPT_DESIGN,
      variables: {
        media_kind: "视频",
        generation_mode: "参考视频",
        project_style: "水墨",
        current_shot_json: "{}",
        adjacent_shots_json: "[]",
        asset_profiles_json: "[]",
        current_prompt: "已有提示词",
      },
    });
    const configured = withProductionRules(original, "video-prompt-generation");
    expect(configured.agentId).toBe("production_video-prompt-generation");
    expect(configured.systemText).toContain(PRODUCTION_AGENT_CONTRACTS["video-prompt-generation"].responsibility);
    expect(configured.variables?.task_snapshot).toBe(original.text);
    expect(configured.versionHash).not.toBe(original.versionHash);
  });

  it("uses task-specific settings while retaining the underlying domain Agent settings", () => {
    const prompt = renderPrompt({
      id: PROMPT_IDS.ASSET_VISUAL_DESIGN,
      variables: {
        asset_kind: "character",
        asset_name: "Mira",
        asset_requirements: "",
        story_facts_json: "{}",
        previous_visual_design_json: "{}",
        source_evidence_json: "[]",
        story_world_context_json: "{}",
        story_world_directive: "",
        project_style: "ink wash",
      },
    });
    const snapshot = {
      ...mergeProductionConfigurations([{
        agents: {
          [PROMPT_IDS.ASSET_VISUAL_DESIGN]: { systemInstructions: "Domain rule", temperature: 0.2 },
          "production_asset-prompt-generation": {
            systemInstructions: "Asset task rule",
            templateZh: "Asset request: {{task_snapshot}}",
            temperature: 0.7,
          },
        },
      }]),
      format: "production-configuration-v1" as const,
      sources: [{ scopeKey: "user", version: 1 }],
    };
    const configured = applyConfiguredAgentPrompt(prompt, snapshot);
    expect(configured.text).toContain("Asset request:");
    expect(configured.systemText).toContain("Domain rule");
    expect(configured.systemText).toContain("Asset task rule");
    expect(configured.versionHash).not.toBe(prompt.versionHash);
  });
});
