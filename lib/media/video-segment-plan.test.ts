import { describe, expect, it } from "vitest";

import {
  planVideoSegments,
  resolveVideoModelLimits,
} from "./video-segment-plan";

describe("video segment planning", () => {
  it("uses the configured AutoDL model duration and reference limits", () => {
    expect(
      resolveVideoModelLimits({
        model: "minimax_h3_lightx2v_v5_15s",
        protocol: "autodl-comfyui",
      }),
    ).toEqual({ maxDurationSeconds: 15, maxReferenceImages: 9 });
  });

  it("keeps a scene within the model limit as one unchanged prompt", () => {
    expect(
      planVideoSegments({
        action: "韩宇抬起铁石。",
        durationSeconds: 15,
        maxDurationSeconds: 15,
        prompt: "完整提示词",
      }),
    ).toEqual([
      {
        action: "韩宇抬起铁石。",
        durationSeconds: 15,
        endSeconds: 15,
        index: 0,
        prompt: "完整提示词",
        startSeconds: 0,
      },
    ]);
  });

  it("balances an overlong scene and assigns actions in narrative order", () => {
    const segments = planVideoSegments({
      action: "韩宇看向铁盒。韩子枫打开盒盖。古籍泛起微光。",
      durationSeconds: 18,
      maxDurationSeconds: 15,
      prompt: "从参考首帧 t=0 向前生成。\n唯一向前动作：完整动作\n仅生成静音视频。",
    });

    expect(segments.map((segment) => segment.durationSeconds)).toEqual([9, 9]);
    expect(segments.map((segment) => segment.action)).toEqual([
      "韩宇看向铁盒。韩子枫打开盒盖。",
      "古籍泛起微光。",
    ]);
    expect(segments[0].prompt).toContain("本场次第 1/2 段");
    expect(segments[0].prompt).toContain(
      "本片段可见动作：韩宇看向铁盒。韩子枫打开盒盖。",
    );
    expect(segments[0].prompt).not.toContain("唯一向前动作：完整动作");
    expect(segments[0].prompt.match(/本片段可见动作：/gu)).toHaveLength(1);
    expect(segments[1].prompt).toContain("不重复前段动作");
  });
});
