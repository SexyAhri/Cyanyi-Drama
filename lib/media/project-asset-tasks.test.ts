import { describe, expect, it } from "vitest";

import {
  assertStoryboardApprovedForMedia,
  compileStoryboardEventBlueprint,
  dialogueVideoPrompt,
  parseGenerationIterationDiagnostics,
  ProjectAssetTaskError,
  redactStoryboardSpeechForVideo,
} from "./project-asset-tasks";

describe("storyboard video audio contract", () => {
  it("allows advisory review states and blocks only unfinished storyboards", () => {
    expect(() => assertStoryboardApprovedForMedia("ready")).not.toThrow();
    expect(() =>
      assertStoryboardApprovedForMedia("review_required"),
    ).not.toThrow();
    expect(() =>
      assertStoryboardApprovedForMedia("continuity_warning"),
    ).not.toThrow();
    let error: unknown;
    try {
      assertStoryboardApprovedForMedia("draft");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ProjectAssetTaskError);
    expect(error).toMatchObject({ status: 409 });
  });

  it("withholds character lines from the silent video performance prompt", () => {
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

    expect(prompt).toContain("只生成与画面动作严格同步的空间环境声");
    expect(prompt).toContain("龙炎轰鸣、破空锐响、能量冲击");
    expect(prompt).toContain("禁止角色声音、对白、旁白");
    expect(prompt).toContain("音轨只保留环境声与动作音效");
    expect(prompt).toContain("韩宇先压住慌乱，再缓慢抬眼看向父亲");
    expect(prompt).toContain("担忧父亲却努力显得镇定");
    expect(prompt).toContain("扶床沿的手指先收紧再放松");
    expect(prompt).toContain("眉心短暂收紧，抬眼时嘴角克制");
    expect(prompt).toContain("禁止全程中性脸、僵硬凝视、机械站立");
    expect(prompt).not.toContain("父亲，我会想办法。");
  });

  it("removes known dialogue and speech sound cues from video prompts", () => {
    const prompt = redactStoryboardSpeechForVideo(
      [
        "韩宇开口说话，仅做无声口部表演。",
        "0-3s | foley | 说话声",
        "原文：父亲，你怎么起来了？",
      ].join("\n"),
      ["父亲，你怎么起来了？"],
    );

    expect(prompt).toContain("韩宇开口说话");
    expect(prompt).toContain("[台词正文由配音阶段处理]");
    expect(prompt).not.toContain("父亲，你怎么起来了？");
    expect(prompt).not.toContain("说话声");
  });

  it("uses estimated dialogue timing before dubbing without claiming final lip sync", () => {
    const prompt = dialogueVideoPrompt({
      description: "韩宇看向父亲，准备开口。",
      motionPrompt: "镜头稳定推近韩宇。",
      actingDirections: [],
      durationSeconds: 3,
      lines: [
        { speaker: "韩宇", content: "父亲，我会想办法。", delivery: "dialogue" },
      ],
      playbackRate: 1,
      timings: [{ lineIndex: 0, startSeconds: 0, endSeconds: 3 }],
      usesEstimatedTiming: true,
    });

    expect(prompt).toContain("按对白文本预估节奏");
    expect(prompt).toContain("精准口型留待后期");
    expect(prompt).toContain("角色配音将在独立声音模型生成");
    expect(prompt).not.toContain("已生成配音");
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

  it("compiles ordered production layers without dumping raw JSON", () => {
    const prompt = compileStoryboardEventBlueprint(
      "保持克制",
      {
        description: "林澈格挡顾言的剑",
        charactersJson: JSON.stringify(["林澈", "顾言"]),
        propsJson: JSON.stringify(["长剑"]),
        startStateJson: JSON.stringify({
          body: "两人相对",
          environmentState: {
            keyLightSource: "窗光",
            lightDirection: "画左至画右",
            weather: "雨",
            damageState: [],
            particles: ["雨雾"],
          },
        }),
        endStateJson: JSON.stringify({ body: "剑刃相抵后停稳" }),
        worldContextJson: JSON.stringify({
          shotIntent: {
            audienceTakeaway: "林澈勉强守住",
            primaryVisibleEvent: "双剑相抵",
            endBeat: "林澈退半步停稳",
          },
          constraints: {
            mustHold: ["仅两名角色"],
            changesHere: ["林澈退半步"],
            mustNotAppear: ["第三人"],
          },
          riskFocus: ["interaction_physics"],
        }),
        motionBeatsJson: JSON.stringify([
          {
            startSecond: 0,
            endSecond: 2,
            trigger: "顾言挥剑",
            preparation: "林澈沉肩举剑",
            forceSource: "后腿蹬地",
            action: "双剑相抵",
            contactMaterial: "金属剑刃",
            settle: "林澈退半步停稳",
          },
        ]),
        photographyRules: JSON.stringify({
          cameraPath: { primaryMovement: "track", direction: "向画右" },
        }),
      },
      "video",
    );

    expect(prompt).toContain("1. 镜头意图");
    expect(prompt).toContain("唯一主要可见事件：双剑相抵");
    expect(prompt).toContain("动作时间线 1：0-2秒");
    expect(prompt).toContain("forceSource=后腿蹬地");
    expect(prompt).toContain("唯一主运镜路径：primaryMovement=track");
    expect(prompt).toContain("不得出现：第三人");
    expect(prompt).not.toContain('{"');
  });

  it("does not leak dialogue evidence or speech cues into a video blueprint", () => {
    const dialogue = "父亲，你怎么起来了？";
    const prompt = compileStoryboardEventBlueprint(
      `韩宇无声说话。\n0-3s | foley | 说话声\n${dialogue}`,
      {
        description: "韩宇看向父亲",
        lipSyncText: dialogue,
        sourceEvidenceJson: JSON.stringify([dialogue]),
        actingNotesJson: JSON.stringify({
          characters: [
            {
              name: "韩宇",
              action: "无声口部表演",
              beats: [{ action: "嘴部动作", evidence: dialogue }],
            },
          ],
        }),
        sfxCuesJson: JSON.stringify([
          { startSecond: 0, endSecond: 3, type: "foley", description: "说话声" },
          { startSecond: 0, endSecond: 3, type: "ambience", description: "室内底噪" },
        ]),
      },
      "video",
    );

    expect(prompt).not.toContain(dialogue);
    expect(prompt).not.toContain("说话声");
    expect(prompt).toContain("室内底噪");
    expect(prompt).toContain("原文台词正文：由独立配音与口型阶段处理");
  });

  it("persists complete iteration diagnostics and escalates after two flat rounds", () => {
    expect(
      parseGenerationIterationDiagnostics({
        failureCode: "CONTACT_SLIDES",
        responsibilityLayer: "action_physics",
        changedVariables: ["contactPoint", "settle"],
        hypothesis: "接触与收势不够明确",
        expectedImprovement: "剑刃接触稳定且不滑移",
        mustRemainUnchanged: ["角色身份", "镜头轴线"],
        noImprovementCount: 1,
      }),
    ).toEqual(
      expect.objectContaining({
        failureCode: "CONTACT_SLIDES",
        responsibilityLayer: "action_physics",
        noImprovementCount: 1,
      }),
    );

    expect(() =>
      parseGenerationIterationDiagnostics({
        failureCode: "CONTACT_SLIDES",
        responsibilityLayer: "action_physics",
        changedVariables: ["contactPoint"],
        hypothesis: "继续同一假设",
        expectedImprovement: "接触更稳定",
        mustRemainUnchanged: ["角色身份"],
        noImprovementCount: 2,
      }),
    ).toThrow("连续两轮无改善");
  });
});
