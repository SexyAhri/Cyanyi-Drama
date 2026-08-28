import { describe, expect, it } from "vitest";

import { dialogueVideoPrompt } from "./project-asset-tasks";

describe("storyboard video audio contract", () => {
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
});
