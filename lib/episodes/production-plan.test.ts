import { describe, expect, it } from "vitest";

import {
  buildAdaptationSourceUnits,
  episodeAdaptationOutputSchema,
  isEpisodeTargetDurationSeconds,
  type EpisodeProductionPlanDraft,
  validateEpisodeAdaptationOutput,
  validateEpisodeProductionPlan,
} from "./production-plan";

const sourceUnits = [
  unit("U0001", "第1章 寒门少年\n", "heading", 0),
  unit("U0002", "韩宇举起铁石。\n", "narrative", 10),
  unit("U0003", "他离开练武场，穿过回廊，推门进入偏院。\n", "narrative", 19),
  unit("U0004", "铁盒开启，奇异气息弥漫而出。\n", "narrative", 42),
  unit("U0005", "父亲说：“你母亲还在世。”", "dialogue", 59),
] as const;

const beatText = {
  B01: "韩宇咬紧牙关，双手握住石把，双腿微屈，猛然发力，铁石缓缓离地，铁石稳稳落地。",
  B02: "韩宇放稳铁石，转身离开练武场，穿过灯笼摇曳的回廊，推开竹篱院门，进入偏院后停下脚步。",
  B03: "父亲掀开铁盒，铁盒开启，奇异气息弥漫而出，室内响起低沉嗡鸣，韩宇屏息注视。",
  B04: "父亲看着韩宇，轻声说：“你母亲还在世。”韩宇猛地抬眼。",
} as const;

const adaptedText = Object.values(beatText).join("\n");

function unit(
  unitId: string,
  text: string,
  kind: "heading" | "narrative" | "dialogue" | "exposition",
  startIndex: number,
) {
  return {
    unitId,
    text,
    kind,
    startIndex,
    endIndex: startIndex + text.length,
  };
}

function beatMarkers(text: string) {
  return {
    adaptedStartMarker: text.slice(0, 8),
    adaptedEndMarker: text.slice(-8),
  };
}

function fixture(): EpisodeProductionPlanDraft {
  return {
    version: 1,
    runtime: {
      targetDurationSeconds: 85,
      plannedDurationSeconds: 85,
      hardMaxDurationSeconds: 90,
      estimatedShotCount: 19,
      fit: "target",
    },
    beats: [
      {
        beatId: "B01",
        kind: "action",
        purpose: "完成举石训练",
        location: "练武场",
        durationSeconds: 18,
        ...beatMarkers(beatText.B01),
        actionChain: {
          triggerOrIntent: "韩宇咬紧牙关",
          preparation: "双手握住石把",
          execution: "猛然发力",
          stateChange: "铁石缓缓离地",
          settleOrReaction: "铁石稳稳落地",
        },
        transition: null,
        performanceIntent: "用呼吸和手臂颤动表现吃力",
        interactions: [],
        effects: [],
      },
      {
        beatId: "B02",
        kind: "transition",
        purpose: "连续完成练武场到偏院的移动",
        location: "偏院",
        durationSeconds: 20,
        ...beatMarkers(beatText.B02),
        actionChain: {
          triggerOrIntent: "韩宇放稳铁石",
          preparation: "转身离开练武场",
          execution: "穿过灯笼摇曳的回廊",
          stateChange: "推开竹篱院门",
          settleOrReaction: "进入偏院后停下脚步",
        },
        transition: {
          exitAction: "转身离开练武场",
          pathCompression: "穿过灯笼摇曳的回廊",
          entryAction: "推开竹篱院门",
          arrivalState: "进入偏院后停下脚步",
        },
        performanceIntent: "训练后的疲惫延续到步态和呼吸",
        interactions: [],
        effects: [],
      },
      {
        beatId: "B03",
        kind: "reveal",
        purpose: "展示母亲留下的异常典籍",
        location: "偏院",
        durationSeconds: 19,
        ...beatMarkers(beatText.B03),
        actionChain: null,
        transition: null,
        performanceIntent: "父亲动作慎重，韩宇视线追随铁盒",
        interactions: [
          {
            actor: "父亲",
            target: "铁盒",
            action: "父亲掀开铁盒",
            reaction: "韩宇屏息注视",
          },
        ],
        effects: [
          {
            kind: "artifact",
            trigger: "铁盒开启",
            visualIntent: "奇异气息弥漫而出",
            soundIntent: "低沉嗡鸣",
            provenance: "source",
          },
        ],
      },
      {
        beatId: "B04",
        kind: "hook",
        purpose: "揭示母亲仍在世",
        location: "偏院",
        durationSeconds: 28,
        ...beatMarkers(beatText.B04),
        actionChain: null,
        transition: null,
        performanceIntent: "父亲压低声音，韩宇在揭示后猛地抬眼",
        interactions: [
          {
            actor: "父亲",
            target: "韩宇",
            action: "父亲看着韩宇",
            reaction: "韩宇猛地抬眼",
          },
        ],
        effects: [],
      },
    ],
    sourceCoverage: [
      coverage("U0002", "B01", "铁石缓缓离地", "visualized"),
      coverage("U0003", "B02", "穿过灯笼摇曳的回廊", "visualized"),
      coverage("U0004", "B03", "奇异气息弥漫而出", "preserved"),
      coverage("U0005", "B04", "你母亲还在世", "preserved"),
    ],
    dialoguePlan: [
      {
        lineId: "L01",
        beatId: "B04",
        speaker: "父亲",
        type: "dialogue",
        text: "你母亲还在世。",
        sourceUnitIds: ["U0005"],
        treatment: "preserved",
      },
    ],
    narrationPlan: [],
    cliffhanger: {
      beatId: "B04",
      setup: "父亲提及母亲",
      finalImageOrLine: "韩宇猛地抬眼",
    },
  };
}

function coverage(
  sourceUnitId: string,
  beatId: string,
  adaptedEvidence: string,
  treatment: "preserved" | "condensed" | "visualized" | "dialogized",
) {
  return { sourceUnitId, beatId, adaptedEvidence, treatment };
}

function issueCodes(plan: EpisodeProductionPlanDraft, text = adaptedText) {
  return validateEpisodeProductionPlan({
    plan,
    sourceUnits,
    adaptedText: text,
    targetDurationSeconds: 85,
  }).map((entry) => entry.code);
}

describe("episode production plan", () => {
  it.each([
    [59, false],
    [60, true],
    [85, true],
    [90, true],
    [91, false],
    [85.5, false],
  ])("validates project target duration %s", (value, valid) => {
    expect(isEpisodeTargetDurationSeconds(value)).toBe(valid);
  });

  it("splits source units without losing a character and isolates the heading", () => {
    const source = `第1章 测试\r\n${"寒风掠过练武场。".repeat(80)}\n“父亲，我回来了。”`;
    const units = buildAdaptationSourceUnits(source);

    expect(units.map((entry) => entry.text).join("")).toBe(source);
    expect(units[0]).toMatchObject({ kind: "heading", text: "第1章 测试\r\n" });
    expect(units.every((entry, index) => entry.startIndex === (index ? units[index - 1].endIndex : 0))).toBe(true);
  });

  it.each([89, 90])("accepts a valid %i-second plan", (seconds) => {
    const plan = fixture();
    plan.beats[3].durationSeconds += seconds - 85;
    plan.runtime.plannedDurationSeconds = seconds;
    expect(issueCodes(plan)).toEqual([]);
  });

  it("rejects a 91-second plan", () => {
    const plan = fixture();
    plan.beats[3].durationSeconds = 34;
    plan.runtime.plannedDurationSeconds = 91;
    expect(issueCodes(plan)).toContain("EPISODE_RUNTIME_OVERFLOW");
  });

  it("rejects missing and duplicate source-unit coverage", () => {
    const plan = fixture();
    plan.sourceCoverage = [plan.sourceCoverage[0], plan.sourceCoverage[0], ...plan.sourceCoverage.slice(2)];
    expect(issueCodes(plan)).toEqual(expect.arrayContaining([
      "PRODUCTION_SOURCE_UNIT_DUPLICATE",
      "PRODUCTION_SOURCE_UNIT_MISSING",
    ]));
  });

  it("rejects an action-chain step that exists only as a label", () => {
    const plan = fixture();
    plan.beats[0].actionChain!.execution = "腾空旋转三周";
    expect(issueCodes(plan)).toContain("PRODUCTION_ACTION_NOT_MATERIALIZED");
  });

  it("rejects an interaction that exists only in the plan", () => {
    const plan = fixture();
    plan.beats[3].interactions[0].action = "父亲起身拥抱韩宇";
    expect(issueCodes(plan)).toContain("PRODUCTION_INTERACTION_NOT_MATERIALIZED");
  });

  it("requires a complete transition when the location changes", () => {
    const plan = fixture();
    plan.beats[1].transition = null;
    expect(issueCodes(plan)).toContain("PRODUCTION_LOCATION_TRANSITION_REQUIRED");
  });

  it("rejects narration above 60 Chinese characters", () => {
    const plan = fixture();
    const narration = "这是无法通过画面简洁说明的世界规则".repeat(4);
    const text = `${adaptedText}\n${narration}`;
    plan.beats[3].adaptedEndMarker = narration.slice(-8);
    plan.narrationPlan = [{
      lineId: "N01",
      beatId: "B04",
      text: narration,
      sourceUnitIds: ["U0005"],
      reason: "world_rule",
    }];
    expect(issueCodes(plan, text)).toContain("PRODUCTION_NARRATION_OVERFLOW");
  });

  it("rejects spoken text that cannot fit its beat", () => {
    const plan = fixture();
    const dialogue = "我必须把这个重要事实完整说清楚".repeat(12);
    const text = `${adaptedText}\n${dialogue}`;
    plan.beats[3].adaptedEndMarker = dialogue.slice(-8);
    plan.dialoguePlan[0].text = dialogue;
    expect(issueCodes(plan, text)).toContain("PRODUCTION_DIALOGUE_DURATION_OVERFLOW");
  });

  it("requires a source phenomenon to have an effect on its actual beat", () => {
    const missing = fixture();
    missing.beats[2].effects = [];
    expect(issueCodes(missing)).toContain("PRODUCTION_EFFECT_REQUIRED");

    const misplaced = fixture();
    const [effect] = misplaced.beats[2].effects;
    misplaced.beats[2].effects = [];
    misplaced.beats[0].effects = [effect];
    expect(issueCodes(misplaced)).toContain("PRODUCTION_EFFECT_NOT_MATERIALIZED");
  });

  it("accepts a known split recommendation without inventing a second result shape", () => {
    const output = episodeAdaptationOutputSchema.parse({
      status: "split_recommended",
      title: "寒门少年",
      reason: "关键事件无法在硬上限内完整容纳",
      suggestedBoundarySourceUnitId: "U0004",
      firstPartHook: "铁盒出现",
      secondPartOpening: "父亲打开铁盒",
    });
    expect(validateEpisodeAdaptationOutput({
      output,
      sourceUnits,
      targetDurationSeconds: 85,
    })).toEqual([]);
  });
});
