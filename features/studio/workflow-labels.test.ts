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
      { key: "screenplay", type: "convert_screenplay" },
    ] as WorkflowStepSummary[];
    expect(
      steps.map((step) =>
        workflowStepOperationLabel("zh-CN", "story-to-script", step),
      ),
    ).toEqual(["编剧-小说解析", "编剧-剧情分片", "编剧-剧本转换"]);
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
