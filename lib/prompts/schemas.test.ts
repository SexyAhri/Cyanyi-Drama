import { describe, expect, it } from "vitest";

import {
  characterAnalysisSchema,
  locationPropAnalysisSchema,
  normalizeStudioWorkflowAgentResponse,
  studioWorkflowAgentSchema,
} from "./schemas";

describe("permissive asset analysis schemas", () => {
  it("accepts useful character data without evidence metadata", () => {
    expect(
      characterAnalysisSchema.parse({
        characters: [{ name: "韩宇", role: "主角" }],
        explanation: "ignored provider metadata",
      }),
    ).toEqual({
      characters: [
        {
          name: "韩宇",
          aliases: [],
          profile: {},
          evidence: [],
        },
      ],
    });
  });

  it("accepts locations and props without evidence metadata", () => {
    expect(
      locationPropAnalysisSchema.parse({
        locations: [{ name: "练武场" }],
        props: [{ name: "无字古籍", color: "玄色" }],
      }),
    ).toEqual({
      locations: [{ name: "练武场", evidence: [] }],
      props: [{ name: "无字古籍", evidence: [] }],
    });
  });
});

describe("studio workflow agent response compatibility", () => {
  it("accepts reply-only chat output and fills safe no-operation defaults", () => {
    const normalized = normalizeStudioWorkflowAgentResponse({ response: "这里是正常的文字回复。", providerMetadata: { id: "x" } });
    expect(studioWorkflowAgentSchema.parse(normalized)).toEqual({
      reply: "这里是正常的文字回复。", operation: null, targetId: null, canvasPrompt: null,
    });
  });

  it("accepts aliases and ignores extra fields while retaining an explicit valid operation", () => {
    const normalized = normalizeStudioWorkflowAgentResponse({
      message: "准备整理剧本。", action: "start_script_organization", target_id: "episode-1", extra: true,
    });
    expect(studioWorkflowAgentSchema.parse(normalized)).toEqual({
      reply: "准备整理剧本。", operation: "start_script_organization", targetId: "episode-1", canvasPrompt: null,
    });
  });

  it("drops unsupported operations instead of inferring actions from prose", () => {
    const normalized = normalizeStudioWorkflowAgentResponse({
      reply: "我建议执行危险操作。", operation: "delete_project", targetId: "project-1",
    });
    expect(studioWorkflowAgentSchema.parse(normalized).operation).toBeNull();
  });
});
