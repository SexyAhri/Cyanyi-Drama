import { describe, expect, it } from "vitest";

import {
  validateActingCoverage,
  validateCharacterAnalysis,
  validateCinematographyCoverage,
  validateClipSegmentation,
  validateContinuityReview,
  validateLocationPropAnalysis,
  validateScreenplayConversion,
  validateStoryboardPlanning,
  validateStoryboardRefinement,
  validateVoiceAnalysis,
} from "./validators";
import { clipSegmentationSchema } from "./schemas";

const canonical = {
  characters: ["林澈"],
  locations: ["书房"],
  props: ["怀表"],
};

describe("domain semantic validators", () => {
  it("rejects analysis evidence that is not an exact source excerpt", () => {
    const issues = validateCharacterAnalysis(
      {
        characters: [
          {
            name: "林澈",
            aliases: [],
            profile: {},
            introduction: null,
            evidence: ["不存在的原文"],
          },
        ],
      },
      "林澈走进书房。",
    );

    expect(issues.map((item) => item.code)).toContain(
      "EVIDENCE_NOT_IN_SOURCE",
    );
  });

  it("rejects duplicate assets and unsupported asset evidence", () => {
    const issues = validateLocationPropAnalysis(
      {
        locations: [
          { name: "书房", summary: null, evidence: ["书房"] },
          { name: " 书房 ", summary: null, evidence: ["不存在"] },
        ],
        props: [],
      },
      "林澈走进书房。",
    );

    expect(issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_CANONICAL_NAME",
        "EVIDENCE_NOT_IN_SOURCE",
      ]),
    );
  });

  it("requires clips to reproduce the source without gaps", () => {
    const issues = validateClipSegmentation(
      {
        clips: [
          {
            start: "甲",
            end: "甲",
            text: "甲",
            summary: "第一段",
            location: "书房",
            characters: ["林澈"],
            props: [],
          },
        ],
      },
      { sourceText: "甲乙", canonical },
    );

    expect(issues.map((item) => item.code)).toContain(
      "SOURCE_COVERAGE_MISMATCH",
    );
  });

  it("does not trim exact source segments during schema parsing", () => {
    const parsed = clipSegmentationSchema.parse({
      clips: [
        {
          start: " 甲",
          end: "甲\n",
          text: " 甲\n",
          summary: "片段",
          location: null,
          characters: [],
          props: [],
        },
      ],
    });

    expect(parsed.clips[0].text).toBe(" 甲\n");
  });

  it("rejects nonsequential panels and unknown canonical entities", () => {
    const issues = validateStoryboardPlanning(
      {
        panels: [
          {
            panelIndex: 1,
            shotType: "中景",
            cameraMove: "固定镜头",
            durationSeconds: 1,
            motionTimeline: [
              {
                startSecond: 0,
                endSecond: 1,
                action: "陌生人进入",
                camera: "固定镜头",
              },
            ],
            description: "陌生人进入未知地点",
            locationName: "未知地点",
            characters: ["陌生人"],
            props: [],
            imagePrompt: null,
            videoPrompt: "陌生人进入未知地点",
            sourceEvidence: ["林澈走进书房"],
          },
        ],
      },
      { sourceText: "林澈走进书房", canonical },
    );

    expect(issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "PANEL_INDEX_NOT_SEQUENTIAL",
        "UNKNOWN_CANONICAL_NAME",
        "UNKNOWN_LOCATION",
      ]),
    );
  });

  it("requires one continuous motion beat for every shot second", () => {
    const issues = validateStoryboardPlanning(
      {
        panels: [
          {
            panelIndex: 0,
            shotType: "中景",
            cameraMove: "缓慢推近",
            durationSeconds: 3,
            motionTimeline: [
              {
                startSecond: 0,
                endSecond: 1,
                action: "林澈抬起怀表",
                camera: "中景缓慢推近",
              },
              {
                startSecond: 2,
                endSecond: 3,
                action: "林澈注视怀表",
                camera: "近景停稳",
              },
            ],
            description: "林澈看怀表",
            locationName: "书房",
            characters: ["林澈"],
            props: ["怀表"],
            imagePrompt: "林澈在书房举起怀表",
            videoPrompt: "林澈连续举起并注视怀表",
            sourceEvidence: ["林澈看怀表"],
          },
        ],
      },
      { sourceText: "林澈看怀表", canonical },
    );

    expect(issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "MOTION_TIMELINE_SECOND_COUNT_MISMATCH",
        "MOTION_TIMELINE_NOT_CONTIGUOUS",
      ]),
    );
  });

  it("preserves screenplay identity and source dialogue", () => {
    const issues = validateScreenplayConversion(
      {
        clipId: "changed",
        originalText: "changed text",
        scenes: [
          {
            sceneNumber: 2,
            heading: { intExt: "INT", location: "书房", time: "夜" },
            description: "",
            characters: ["林澈"],
            content: [
              {
                type: "dialogue",
                character: "陌生人",
                parenthetical: null,
                lines: "补写台词",
              },
              { type: "action", text: "补写动作" },
            ],
          },
        ],
      },
      { clipId: "clip-1", clipText: "林澈说：你好。", canonical },
    );

    expect(issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "CLIP_ID_CHANGED",
        "ORIGINAL_TEXT_CHANGED",
        "SPOKEN_TEXT_NOT_IN_SOURCE",
        "ACTION_NOT_IN_SOURCE",
        "UNKNOWN_SPEAKER",
        "SCENE_NUMBER_NOT_SEQUENTIAL",
      ]),
    );
  });

  it("detects missing photography and acting outputs per panel", () => {
    expect(
      validateCinematographyCoverage(
        {
          rules: [
            {
              panelIndex: 0,
              camera: "正面",
              cameraPosition: "角色正前方两米",
              focalLength: "50mm",
              lighting: "侧光",
              composition: "中景",
              depthOfField: "浅景深",
              colorTone: "冷色",
            },
          ],
        },
        [0, 1],
      ).map((item) => item.code),
    ).toContain("PANEL_OUTPUT_MISSING");

    expect(
      validateActingCoverage(
        { directions: [{ panelIndex: 0, characters: [] }] },
        [{ panelIndex: 0, characters: ["林澈"] }],
      ).map((item) => item.code),
    ).toContain("ENTITY_OUTPUT_MISSING");
  });

  it("rejects refinement changes to entities and source evidence", () => {
    const panel = {
      panelIndex: 0,
      shotType: "中景",
      cameraMove: "缓慢推近",
      durationSeconds: 2,
      motionTimeline: [
        {
          startSecond: 0,
          endSecond: 1,
          action: "林澈拿起怀表",
          camera: "中景缓慢推近",
        },
        {
          startSecond: 1,
          endSecond: 2,
          action: "林澈注视怀表",
          camera: "近景停稳",
        },
      ],
      description: "林澈看怀表",
      locationName: "书房",
      characters: ["林澈"],
      props: ["怀表"],
      imagePrompt: null,
      videoPrompt: "林澈连续拿起并注视怀表",
      sourceEvidence: ["林澈看怀表"],
    };
    const issues = validateStoryboardRefinement(
      {
        panels: [
          {
            ...panel,
            cameraMove: "快速摇镜",
            durationSeconds: 3,
            motionTimeline: [
              panel.motionTimeline[0],
              {
                ...panel.motionTimeline[1],
                startSecond: 2,
                endSecond: 3,
              },
              {
                startSecond: 3,
                endSecond: 4,
                action: "林澈继续注视怀表",
                camera: "镜头停稳",
              },
            ],
            characters: ["林澈", "林澈"],
            sourceEvidence: ["改写证据"],
          },
        ],
      },
      [panel],
    );

    expect(issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "CAMERA_MOVE_CHANGED",
        "SHOT_DURATION_CHANGED",
        "MOTION_TIMELINE_BOUNDARIES_CHANGED",
        "DUPLICATE_ENTITY",
        "SOURCE_EVIDENCE_CHANGED",
      ]),
    );
  });

  it("rejects invented dialogue and unknown panel mappings", () => {
    const issues = validateVoiceAnalysis(
      {
        lines: [
          {
            speaker: "林澈",
            content: "模型补写的台词",
            emotionPrompt: null,
            emotionStrength: 0.5,
            matchedPanelIndex: 9,
          },
        ],
      },
      {
        sourceText: "林澈说：你好。",
        characters: canonical.characters,
        panelIndices: [0],
      },
    );

    expect(issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(["VOICE_CONTENT_NOT_IN_SOURCE", "UNKNOWN_PANEL"]),
    );
  });

  it("rejects continuity issues that reference unknown panels and entities", () => {
    const issues = validateContinuityReview(
      {
        passed: true,
        issues: [
          {
            code: "PROP_JUMP",
            severity: "warning",
            panelIndex: 8,
            entityType: "prop",
            entityName: "未知道具",
            message: "道具位置跳变",
            suggestedFix: null,
          },
        ],
      },
      { panelIndices: [0], canonical },
    );

    expect(issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(["UNKNOWN_PANEL", "UNKNOWN_ENTITY"]),
    );
  });
});
