import { describe, expect, it } from "vitest";

import {
  assertStoryboardApprovedForMedia,
  dialogueVideoPrompt,
  ProjectAssetTaskError,
} from "./project-asset-tasks";

describe("storyboard video audio contract", () => {
  it("blocks media generation until the storyboard is approved", () => {
    expect(() => assertStoryboardApprovedForMedia("ready")).not.toThrow();
    let error: unknown;
    try {
      assertStoryboardApprovedForMedia("review_required");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ProjectAssetTaskError);
    expect(error).toMatchObject({ status: 409 });
  });

  it("keeps native video audio ambient-only and withholds character lines", () => {
    const prompt = dialogueVideoPrompt({
      description: "韩宇扶住床沿，抬眼看向父亲。",
      motionPrompt: "韩宇先压住慌乱，再缓慢抬眼看向父亲。",
      actingDirections: [
        {
          name: "韩宇",
          emotion: "担忧父亲却努力显得镇定",
          action: "扶床沿的手指先收紧再放松",
          expression: "眉心短暂收紧，抬眼时嘴角克制",
        },
      ],
      durationSeconds: 4,
      lines: [
        { speaker: "韩宇", content: "父亲，我会想办法。", delivery: "dialogue" },
      ],
      playbackRate: 1,
      timings: [{ lineIndex: 0, startSeconds: 0, endSeconds: 4 }],
    });

    expect(prompt).toContain("只生成与场景匹配的环境声和动作音效");
    expect(prompt).toContain("禁止生成任何角色声音");
    expect(prompt).toContain("韩宇先压住慌乱，再缓慢抬眼看向父亲");
    expect(prompt).toContain("担忧父亲却努力显得镇定");
    expect(prompt).toContain("扶床沿的手指先收紧再放松");
    expect(prompt).toContain("眉心短暂收紧，抬眼时嘴角克制");
    expect(prompt).toContain("禁止全程中性脸、僵硬凝视、机械站立");
    expect(prompt).not.toContain("父亲，我会想办法。");
  });

  it("externalizes inner monologue without giving other characters knowledge", () => {
    const prompt = dialogueVideoPrompt({
      description: "韩宇沉默地看着父亲。",
      motionPrompt: "镜头缓慢推近韩宇的眼神变化。",
      actingDirections: [
        {
          name: "韩宇",
          emotion: "害怕失去父亲但不愿让对方察觉",
          action: "呼吸停顿半拍后缓慢恢复",
          expression: "眼眶微红，下颌绷紧后松开",
        },
      ],
      durationSeconds: 3,
      lines: [
        { speaker: "韩宇", content: "我不能让父亲担心。", delivery: "inner_monologue" },
      ],
      playbackRate: 1,
      timings: [{ lineIndex: 0, startSeconds: 0, endSeconds: 3 }],
    });

    expect(prompt).toContain("韩宇的内心独白/画外音时段");
    expect(prompt).toContain("其他角色不得感知未说出口的内容");
    expect(prompt).toContain("眼眶微红，下颌绷紧后松开");
    expect(prompt).not.toContain("我不能让父亲担心。");
  });

  it("propagates timed objective, subtext, gaze, and reaction into the video prompt", () => {
    const prompt = dialogueVideoPrompt({
      description: "韩宇接住父亲递来的铁盒。",
      motionPrompt: "0-2s 韩宇接住铁盒，父亲松手。",
      actingDirections: [
        {
          name: "韩宇",
          emotion: "克制的疑惑",
          action: "双手接盒",
          expression: "视线由父亲转向铁盒",
          beats: [
            {
              startSecond: 0,
              endSecond: 2,
              objective: "确认父亲的意图",
              subtext: "这件东西为何现在交给我",
              action: "双手接住铁盒",
              expression: "眉心轻收",
              gazeTarget: "铁盒",
              reactionTo: "B1",
            },
          ],
        },
      ],
      durationSeconds: 2,
      lines: [],
      playbackRate: 1,
      timings: [],
    });

    expect(prompt).toContain("目标=确认父亲的意图");
    expect(prompt).toContain("潜台词=这件东西为何现在交给我");
    expect(prompt).toContain("视线=铁盒");
    expect(prompt).toContain("反应于=B1");
  });
});
