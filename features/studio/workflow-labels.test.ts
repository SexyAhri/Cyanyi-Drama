import { describe, expect, it } from "vitest";

import type { StudioMediaTask, WorkflowStepSummary } from "./types";
import {
  mediaTaskOperationLabel,
  workflowStepOperationLabel,
} from "./workflow-labels";

describe("studio operation labels", () => {
  it("names every writing step independently", () => {
    const steps = [
      { key: "parse", type: "parse_novel" },
      { key: "split", type: "split_clips" },
      { key: "screenplay_beats", type: "generate_screenplay_beats" },
      { key: "screenplay_dialogue", type: "generate_screenplay_dialogue" },
      { key: "screenplay_narration", type: "generate_screenplay_narration" },
      { key: "screenplay_effects", type: "generate_screenplay_effects" },
      { key: "assemble_screenplay", type: "assemble_screenplay" },
    ] as WorkflowStepSummary[];
    expect(
      steps.map((step) =>
        workflowStepOperationLabel("zh-CN", "story-to-script", step),
      ),
    ).toEqual([
      "编剧-小说解析",
      "编剧-剧情分片",
      "编剧-场次与节拍",
      "编剧-对白创作",
      "编剧-旁白创作",
      "编剧-动作与特效",
      "编剧-AI 分场合成",
    ]);
  });

  it("includes the resolved asset target in media task labels", () => {
    const task = {
      kind: "image",
      targetType: "character_appearance",
      displayName: "韩宇",
    } as StudioMediaTask;
    expect(mediaTaskOperationLabel("zh-CN", task)).toBe(
      "角色-韩宇-素材生成",
    );
  });

  it("names project-level AI visual design work", () => {
    expect(
      workflowStepOperationLabel("zh-CN", "asset-visual-design", {
        key: "design_asset_visual",
        type: "design_asset_visual",
      } as WorkflowStepSummary),
    ).toBe("AI 视觉设计-生成资产视觉设定");
  });

  it("names storyboard prompt design as its own visible operation", () => {
    expect(
      workflowStepOperationLabel("zh-CN", "storyboard-prompt-design", {
        key: "design_storyboard_media_prompt",
        type: "design_storyboard_media_prompt",
      } as WorkflowStepSummary),
    ).toBe("AI 分镜提示设计-设计镜头提示词");
  });

  it("formats storyboard image and video tasks with shot indices", () => {
    const base = {
      targetType: "storyboard_panel",
      displayIndex: 3,
    } as StudioMediaTask;
    expect(mediaTaskOperationLabel("zh-CN", { ...base, kind: "image" })).toBe(
      "分镜-镜头 03-图片生成",
    );
    expect(mediaTaskOperationLabel("zh-CN", { ...base, kind: "video" })).toBe(
      "分镜-镜头 03-视频生成",
    );
  });
});
