import { describe, expect, it } from "vitest";
import { studioAgentTestRunRequestSchema } from "./agent-test-run-contract";

describe("Studio Agent test-run request contract", () => {
  it("accepts project, episode and selected shot context with a temporary draft", () => {
    expect(studioAgentTestRunRequestSchema.parse({
      content: "Review continuity only",
      context: { stageId: "shots", episodeId: "episode-1", selection: { id: "shot-1", kind: "storyboard_panel", label: "Shot 1" } },
      draft: { agents: { studio_workflow_agent: { temperature: 0.2 } } },
    })).toMatchObject({ locale: "zh-CN", context: { episodeId: "episode-1", selection: { id: "shot-1" } } });
  });

  it("rejects empty requests, invalid scopes, secrets and unknown properties", () => {
    expect(studioAgentTestRunRequestSchema.safeParse({ content: " ", context: { stageId: "shots" } }).success).toBe(false);
    expect(studioAgentTestRunRequestSchema.safeParse({ content: "x", context: { stageId: "unknown" } }).success).toBe(false);
    expect(studioAgentTestRunRequestSchema.safeParse({ content: "x", apiKey: "secret", context: { stageId: "shots" } }).success).toBe(false);
    expect(studioAgentTestRunRequestSchema.safeParse({ content: "x", context: { stageId: "shots" }, draft: { sound: { mode: "silent" } } }).success).toBe(false);
    expect(studioAgentTestRunRequestSchema.safeParse({ content: "x", context: { stageId: "shots" }, draft: { workflow: { concurrency: 4 } } }).success).toBe(false);
  });
});
