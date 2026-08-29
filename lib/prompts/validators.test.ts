import { describe, expect, it } from "vitest";

import {
  buildSourceEvents,
  normalizeCharacterAnalysisEvidence,
  normalizeLocationPropAnalysisEvidence,
  validateActingCoverage,
  validateCharacterAnalysis,
  validateCinematographyCoverage,
  validateClipSegmentation,
  validateContinuityReview,
  isDirectSpeechExcerpt,
  isImplicitVisualBridgeAction,
  isSourceBackedTemporarySpeaker,
  normalizeStoryboardPlanningContract,
  normalizeStoryboardPlanningEntities,
  normalizeStoryboardRefinementContract,
  normalizeScreenplaySourceContract,
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
  it("keeps sentence-closing quotes with the preceding source event", () => {
    expect(
      buildSourceEvents(
        "“好灼热的火炎！”虚空中的老者眼眸中掠过惊诧，“此龙没有肉体！”\n“哇！”",
      ).map((event) => event.evidence),
    ).toEqual([
      "“好灼热的火炎！”",
      "虚空中的老者眼眸中掠过惊诧，“此龙没有肉体！”",
      "“哇！”",
    ]);
  });

  it("ignores a leading chapter title and punctuation-only fragments", () => {
    expect(
      buildSourceEvents('第313章 九炎战奥义境\n”\n“嘭！”\n龙炎席卷而来。').map(
        (event) => event.evidence,
      ),
    ).toEqual(["“嘭！”", "龙炎席卷而来。"]);
  });

  it("keeps only source-backed analysis evidence with a deterministic fallback", () => {
    const source = "海宏赡站在太炎镇上空，手持裂海之矛。";
    expect(
      normalizeCharacterAnalysisEvidence(
        {
          characters: [
            {
              name: "海宏赡",
              aliases: [],
              profile: {},
              introduction: null,
              evidence: ["模型改写的角色证据"],
            },
            {
              name: "不存在的人物",
              aliases: [],
              profile: {},
              introduction: null,
              evidence: ["另一条改写证据"],
            },
          ],
        },
        source,
      ).characters,
    ).toEqual([
      expect.objectContaining({ name: "海宏赡", evidence: ["海宏赡"] }),
    ]);
    expect(
      normalizeLocationPropAnalysisEvidence(
        {
          locations: [
            {
              name: "太炎镇",
              summary: null,
              evidence: ["太炎镇", "模型改写的地点证据"],
            },
          ],
          props: [
            {
              name: "裂海之矛",
              summary: null,
              evidence: ["模型改写的道具证据"],
            },
          ],
        },
        source,
      ),
    ).toEqual({
      locations: [
        { name: "太炎镇", summary: null, evidence: ["太炎镇"] },
      ],
      props: [
        { name: "裂海之矛", summary: null, evidence: ["裂海之矛"] },
      ],
    });
  });

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
            endUnitId: "U0001",
            summary: "第一段",
            location: "书房",
            characters: ["林澈"],
            props: [],
          },
        ],
      },
      {
        sourceUnits: [
          { id: "U0001", text: "甲" },
          { id: "U0002", text: "乙" },
        ],
        canonical,
      },
    );

    expect(issues.map((item) => item.code)).toContain(
      "SOURCE_COVERAGE_MISMATCH",
    );
  });

  it("accepts source-unit boundaries without copied source text", () => {
    const parsed = clipSegmentationSchema.parse({
      clips: [
        {
          endUnitId: "U0002",
          summary: "片段",
          location: null,
          characters: [],
          props: [],
        },
      ],
    });

    expect(parsed.clips[0]).toEqual(
      expect.objectContaining({ endUnitId: "U0002" }),
    );
    expect(parsed.clips[0]).not.toHaveProperty("text");
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
            vfxCues: [],
            sfxCues: [],
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

  it("requires continuous key motion beats without forcing one beat per second", () => {
    const issues = validateStoryboardPlanning(
      {
        panels: [
          {
            panelIndex: 0,
            shotType: "中景",
            cameraMove: "缓慢推近",
            durationSeconds: 3,
            vfxCues: [],
            sfxCues: [],
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
      expect.arrayContaining(["MOTION_TIMELINE_NOT_CONTIGUOUS"]),
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

  it("keeps source-backed collective speakers through screenplay, storyboard, and voice", () => {
    const source = "附近修者纷纷惊呼：“海氏宗族的人来了！”";
    const screenplay = {
      clipId: "clip-1",
      originalText: source,
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "书房", time: "日" },
          description: "",
          characters: ["附近修者"],
          content: [
            {
              type: "dialogue" as const,
              character: "附近修者",
              parenthetical: "惊呼",
              lines: "海氏宗族的人来了！",
            },
          ],
        },
      ],
    };

    expect(
      validateScreenplayConversion(screenplay, {
        clipId: "clip-1",
        clipText: source,
        canonical,
      }),
    ).toEqual([]);

    const screenplayText = JSON.stringify(screenplay);
    expect(
      validateStoryboardPlanning(
        {
          panels: [
            {
              panelIndex: 0,
              sceneNumber: 0,
              shotType: "中景",
              cameraMove: "稳定推近",
              durationSeconds: 7,
              speakingCharacter: "附近修者",
              lipSyncText: "海氏宗族的人来了！",
              voiceoverText: null,
              startState: {
                body: "附近修者站立",
                hands: "自然垂下",
                gaze: "看向海氏宗族",
                screenDirection: "面向画面左侧",
                props: "无",
              },
              endState: {
                body: "附近修者站立惊呼",
                hands: "自然垂下",
                gaze: "看向海氏宗族",
                screenDirection: "面向画面左侧",
                props: "无",
              },
              motionTimeline: [
                {
                  startSecond: 0,
                  endSecond: 7,
                  action: "附近修者惊呼",
                  camera: "稳定推近",
                },
              ],
              vfxCues: [],
              sfxCues: [],
              description: "附近修者惊呼",
              locationName: "书房",
              characters: ["附近修者"],
              props: [],
              imagePrompt: "附近修者惊呼",
              videoPrompt: "附近修者惊呼，仅动作与环境声",
              sourceEvidence: ["附近修者"],
            },
          ],
        },
        { sourceText: screenplayText, canonical, screenplay },
      ),
    ).toEqual([]);

    expect(
      validateVoiceAnalysis(
        {
          lines: [
            {
              speaker: "附近修者",
              content: "海氏宗族的人来了！",
              delivery: "dialogue",
              emotionPrompt: "惊讶",
              emotionStrength: 0.7,
              matchedPanelIndex: 0,
            },
          ],
        },
        {
          sourceText: source,
          characters: canonical.characters,
          temporarySpeakers: ["附近修者"],
          panelIndices: [0],
        },
      ),
    ).toEqual([]);
  });

  it("still rejects an invented collective speaker for quoted dialogue", () => {
    const source = "附近修者纷纷惊呼：“海氏宗族的人来了！”";
    const issues = validateScreenplayConversion(
      {
        clipId: "clip-1",
        originalText: source,
        scenes: [
          {
            sceneNumber: 0,
            heading: { intExt: "INT", location: "书房", time: "日" },
            description: "",
            characters: ["各方势力的修者"],
            content: [
              {
                type: "dialogue",
                character: "各方势力的修者",
                parenthetical: null,
                lines: "海氏宗族的人来了！",
              },
            ],
          },
        ],
      },
      { clipId: "clip-1", clipText: source, canonical },
    );

    expect(issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(["UNKNOWN_CANONICAL_NAME", "UNKNOWN_SPEAKER"]),
    );
  });

  it("rejects padded location summaries instead of treating missing facts as canon", () => {
    const issues = validateLocationPropAnalysis(
      {
        locations: [
          {
            name: "太炎镇",
            summary:
              "空间尺度为边陲小镇，地貌层级为无具体描述，建筑关系为无，静态概述：无",
            evidence: ["太炎镇坐落于大秦王朝西部边陲"],
          },
        ],
        props: [],
      },
      "太炎镇坐落于大秦王朝西部边陲。",
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        path: "locations.0.summary",
        code: "EMPTY_CANONICAL_FACT_TEMPLATE",
      }),
    );
  });

  it("attributes nearby quoted lines to exact collective source labels", () => {
    expect(
      isSourceBackedTemporarySpeaker(
        "这就是奥义境修者的神通么……",
        "下面的修者",
        "“这就是奥义境修者的神通么……”瞧得虚空中的海潮，下面的修者都是满脸不可思议。",
      ),
    ).toBe(true);
    expect(
      isSourceBackedTemporarySpeaker(
        "若是，能踏入这等境界那该多好啊！",
        "几大千古世家大族的半步奥义修者",
        "几大千古世家大族的半步奥义修者，不由咽了咽口水，“若是，能踏入这等境界那该多好啊！”",
      ),
    ).toBe(true);
    expect(
      isSourceBackedTemporarySpeaker(
        "好恐怖的火炎！",
        "虚空下的修者",
        "“好恐怖的火炎！”\n虚空下的修者眼角一阵抽搐。",
      ),
    ).toBe(true);
    expect(
      isSourceBackedTemporarySpeaker(
        "好恐怖的火炎！",
        "众人",
        "“好恐怖的火炎！”\n虚空下的修者眼角一阵抽搐。",
      ),
    ).toBe(false);
    expect(
      isSourceBackedTemporarySpeaker(
        "抵挡下来了，那龙莫非堪比奥义境？",
        "无数人",
        "“抵挡下来了，那龙莫非堪比奥义境？”无数人望着虚空中的巨龙。",
      ),
    ).toBe(true);
    expect(
      isSourceBackedTemporarySpeaker(
        "海氏宗族，此次定然不会罢休啊！",
        "一些人",
        "“海氏宗族，此次定然不会罢休啊！”一些人不由舔了舔舌头。",
      ),
    ).toBe(true);
    expect(
      isSourceBackedTemporarySpeaker(
        "海氏宗族，此次定然不会罢休啊！",
        "海氏宗族的修者",
        "“海氏宗族，此次定然不会罢休啊！”一些人不由舔了舔舌头。海氏宗族的修者眸光瞧向虚空。",
      ),
    ).toBe(false);
  });

  it("allows an exact source-backed collective role in the scene cast", () => {
    const source =
      "“这就是奥义境修者的神通么……”瞧得虚空中的海潮，下面的修者都是满脸不可思议。";
    expect(
      validateScreenplayConversion(
        {
          clipId: "clip-1",
          originalText: source,
          scenes: [
            {
              sceneNumber: 0,
              heading: { intExt: "EXT", location: "书房", time: "日" },
              description: "",
              characters: ["下面的修者"],
              content: [
                {
                  type: "dialogue",
                  character: "下面的修者",
                  parenthetical: null,
                  lines: "这就是奥义境修者的神通么……",
                },
              ],
            },
          ],
        },
        { clipId: "clip-1", clipText: source, canonical },
      ),
    ).toEqual([]);
  });

  it("restores deterministic source fields and drops ungrounded production terms", () => {
    const source = "林澈以筑基境施展青霄剑诀，剑光击中石壁。";
    const normalized = normalizeScreenplaySourceContract(
      {
        clipId: "changed",
        originalText: "normalized whitespace",
        coverage: [
          {
            eventId: "E001",
            evidence: "rewritten evidence",
            modes: ["visual"],
            reason: null,
          },
        ],
        scenes: [
          {
            sceneNumber: 0,
            heading: { intExt: "INT", location: "书房", time: "夜" },
            description: "",
            characters: ["林澈"],
            content: [
              {
                type: "action",
                text: source,
                origin: "source",
                actionDesign: {
                  kind: "skill",
                  performer: "林澈",
                  target: "石壁",
                  realm: "模型扩写的更高境界",
                  technique: "青霄剑诀",
                  choreography: ["林澈挥剑"],
                  impact: "剑光击中石壁",
                  environmentResponse: null,
                  vfxPlan: [],
                  sfxPlan: [],
                  evidence: [source],
                },
              },
            ],
          },
        ],
      },
      {
        clipId: "clip-1",
        clipText: source,
        sourceEvents: [{ eventId: "E001", evidence: source }],
      },
    );

    expect(normalized.clipId).toBe("clip-1");
    expect(normalized.originalText).toBe(source);
    expect(normalized.coverage?.[0].evidence).toBe(source);
    const action = normalized.scenes[0].content[0];
    expect(action.type).toBe("action");
    if (action.type !== "action") throw new Error("Expected action");
    expect(action.actionDesign?.realm).toBeNull();
    expect(action.actionDesign?.technique).toBe("青霄剑诀");
    expect(
      validateScreenplayConversion(normalized, {
        clipId: "clip-1",
        clipText: source,
        canonical,
        sourceEvents: [{ eventId: "E001", evidence: source }],
      }),
    ).toEqual([]);
  });

  it("downgrades or removes ungrounded inferred actions deterministically", () => {
    const source = "林澈看向虚空，握紧了剑柄。";
    const normalized = normalizeScreenplaySourceContract(
      {
        clipId: "changed",
        originalText: "changed",
        scenes: [
          {
            sceneNumber: 0,
            heading: { intExt: "INT", location: "书房", time: "日" },
            description: "",
            characters: ["林澈"],
            content: [
              {
                type: "action",
                text: "林澈喊道：“接招！”",
                origin: "inferred",
                inferenceType: "performance",
                evidence: [source],
                rationale: "模型推演",
                confidence: 0.8,
              },
              {
                type: "action",
                text: "林澈凭空消失。",
                origin: "bridge",
                evidence: ["不存在的依据"],
              },
            ],
          },
        ],
      },
      { clipId: "clip-1", clipText: source },
    );

    expect(normalized.scenes[0].content).toEqual([
      { type: "action", text: source, origin: "source" },
    ]);
    expect(
      validateScreenplayConversion(normalized, {
        clipId: "clip-1",
        clipText: source,
        canonical,
      }),
    ).toEqual([]);
  });

  it("accepts an exact source location that is not yet canonical", () => {
    const source = "太炎镇坐落于大秦王朝西部边陲。";
    const screenplay = {
      clipId: "clip-1",
      originalText: source,
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "EXT" as const, location: "太炎镇", time: "夜" },
          description: "",
          characters: [],
          content: [{ type: "action" as const, text: source }],
        },
      ],
    };

    expect(
      validateScreenplayConversion(screenplay, {
        clipId: "clip-1",
        clipText: source,
        canonical,
      }),
    ).toEqual([]);

    const sourceText = JSON.stringify(screenplay);
    const storyboardIssues = validateStoryboardPlanning(
      {
        panels: [
          {
            panelIndex: 0,
            sceneNumber: 0,
            shotType: "全景",
            cameraMove: "固定镜头",
            durationSeconds: 2,
            startState: {
              body: "无人物",
              hands: "无",
              gaze: "无",
              screenDirection: "无",
              props: "无",
            },
            endState: {
              body: "无人物",
              hands: "无",
              gaze: "无",
              screenDirection: "无",
              props: "无",
            },
            motionTimeline: [
              {
                startSecond: 0,
                endSecond: 2,
                action: "建立太炎镇地理环境",
                camera: "固定全景",
              },
            ],
            vfxCues: [],
            sfxCues: [],
            description: source,
            locationName: "太炎镇",
            characters: [],
            props: [],
            imagePrompt: source,
            videoPrompt: "太炎镇全景，仅环境声",
            sourceEvidence: [source],
          },
        ],
      },
      { sourceText, canonical, screenplay },
    );
    expect(storyboardIssues).toEqual([]);
  });

  it("allows adjacent lines by one speaker to share a shot", () => {
    const screenplay = {
      clipId: "clip-1",
      originalText: "林澈说：你好。回来。",
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "书房", time: "夜" },
          description: "",
          characters: ["林澈"],
          content: [
            {
              type: "dialogue" as const,
              character: "林澈",
              parenthetical: null,
              lines: "你好。",
            },
            {
              type: "dialogue" as const,
              character: "林澈",
              parenthetical: null,
              lines: "回来。",
            },
          ],
        },
      ],
    };
    const sourceText = JSON.stringify(screenplay);
    const issues = validateStoryboardPlanning(
      {
        panels: [
          {
            panelIndex: 0,
            sceneNumber: 0,
            shotType: "中景",
            cameraMove: "固定镜头",
            durationSeconds: 3,
            startState: {
              body: "林澈站立",
              hands: "双手自然垂下",
              gaze: "看向前方",
              screenDirection: "面向画面左侧",
              props: "无",
            },
            endState: {
              body: "林澈站立",
              hands: "双手自然垂下",
              gaze: "看向前方",
              screenDirection: "面向画面左侧",
              props: "无",
            },
            speakingCharacter: "林澈",
            lipSyncText: "你好。回来。",
            voiceoverText: null,
            motionTimeline: [
              {
                startSecond: 0,
                endSecond: 3,
                action: "林澈连续说完两句",
                camera: "固定中景",
              },
            ],
            vfxCues: [],
            sfxCues: [],
            description: "林澈说话",
            locationName: "书房",
            characters: ["林澈"],
            props: [],
            imagePrompt: "林澈在书房",
            videoPrompt: "林澈连续说话，只保留环境声",
            sourceEvidence: ["你好。"],
          },
        ],
      },
      { sourceText, canonical, screenplay },
    );

    expect(issues).toEqual([]);
  });

  it("accepts punctuation-aligned and ordered source actions", () => {
    const source =
      "林澈皱眉道：\"你好。\"他拿起怀表。林澈走到窗边。";
    const issues = validateScreenplayConversion(
      {
        clipId: "clip-1",
        originalText: source,
        scenes: [
          {
            sceneNumber: 0,
            heading: { intExt: "INT", location: "书房", time: "夜" },
            description: "",
            characters: ["林澈"],
            content: [
              { type: "action", text: "林澈皱眉道。" },
              {
                type: "dialogue",
                character: "林澈",
                parenthetical: null,
                lines: "你好。",
              },
              {
                type: "action",
                text: "他拿起怀表。林澈走到窗边。",
              },
            ],
          },
        ],
      },
      { clipId: "clip-1", clipText: source, canonical },
    );

    expect(issues.map((item) => item.code)).not.toContain(
      "ACTION_NOT_IN_SOURCE",
    );
  });

  it("accepts a source-grounded visual bridge but rejects an uncited bridge", () => {
    const source = "韩子枫从暗格取出铁盒，交给韩宇。";
    const base = {
      clipId: "clip-1",
      originalText: source,
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "书房", time: "夜" },
          description: "",
          characters: ["韩子枫", "韩宇"],
          content: [
            {
              type: "action" as const,
              text: "韩子枫走到暗格前，取出铁盒，转身双手递向韩宇。",
              origin: "bridge" as const,
              evidence: ["韩子枫从暗格取出铁盒，交给韩宇。"],
            },
          ],
        },
      ],
    };
    const input = {
      clipId: "clip-1",
      clipText: source,
      canonical: {
        characters: ["韩子枫", "韩宇"],
        locations: ["书房"],
        props: ["铁盒"],
      },
    };

    expect(validateScreenplayConversion(base, input)).toEqual([]);
    expect(
      validateScreenplayConversion(
        {
          ...base,
          scenes: [
            {
              ...base.scenes[0],
              content: [
                {
                  ...base.scenes[0].content[0],
                  evidence: ["不存在的原文依据"],
                },
              ],
            },
          ],
        },
        input,
      ).map((item) => item.code),
    ).toContain("INFERRED_ACTION_NOT_GROUNDED");
  });

  it("allows evidence-grounded performance inference with complete provenance", () => {
    const source = "林澈听见父亲病情加重，强忍着没有落泪。";
    const issues = validateScreenplayConversion(
      {
        clipId: "clip-1",
        originalText: source,
        coverage: [
          {
            eventId: "E001",
            evidence: source,
            modes: ["visual"],
            reason: null,
          },
        ],
        scenes: [
          {
            sceneNumber: 0,
            heading: { intExt: "INT", location: "书房", time: "夜" },
            description: "",
            characters: ["林澈"],
            content: [
              {
                type: "action",
                text: "林澈攥紧衣角，眼眶泛红却没有落泪。",
                origin: "inferred",
                inferenceType: "performance",
                evidence: [source],
                rationale: "把明确的克制悲伤转成可见表演，不改变事件。",
                confidence: 0.85,
              },
            ],
          },
        ],
      },
      {
        clipId: "clip-1",
        clipText: source,
        canonical,
        sourceEvents: [{ eventId: "E001", evidence: source }],
      },
    );

    expect(issues).toEqual([]);
  });

  it("rejects source coverage that exists only in the coverage table", () => {
    const source = "林澈进门。顾言递出怀表。";
    const issues = validateScreenplayConversion(
      {
        clipId: "clip-1",
        originalText: source,
        coverage: [
          {
            eventId: "E001",
            evidence: "林澈进门。",
            modes: ["visual"],
            reason: null,
          },
          {
            eventId: "E002",
            evidence: "顾言递出怀表。",
            modes: ["visual"],
            reason: null,
          },
        ],
        scenes: [
          {
            sceneNumber: 0,
            heading: { intExt: "INT", location: "书房", time: "夜" },
            description: "",
            characters: ["林澈"],
            content: [{ type: "action", text: "林澈进门。" }],
          },
        ],
      },
      {
        clipId: "clip-1",
        clipText: source,
        canonical,
        sourceEvents: [
          { eventId: "E001", evidence: "林澈进门。" },
          { eventId: "E002", evidence: "顾言递出怀表。" },
        ],
      },
    );

    expect(issues.map((item) => item.code)).toContain(
      "SOURCE_EVENT_MODE_NOT_MATERIALIZED",
    );
  });

  it("does not let one screenplay action satisfy repeated source events", () => {
    const repeated = "钟声响起。";
    const issues = validateScreenplayConversion(
      {
        clipId: "clip-1",
        originalText: repeated.repeat(2),
        coverage: [
          { eventId: "E001", evidence: repeated, modes: ["visual"], reason: null },
          { eventId: "E002", evidence: repeated, modes: ["visual"], reason: null },
        ],
        scenes: [
          {
            sceneNumber: 0,
            heading: { intExt: "INT", location: "书房", time: "夜" },
            description: "",
            characters: [],
            content: [{ type: "action", text: repeated }],
          },
        ],
      },
      {
        clipId: "clip-1",
        clipText: repeated.repeat(2),
        canonical,
        sourceEvents: [
          { eventId: "E001", evidence: repeated },
          { eventId: "E002", evidence: repeated },
        ],
      },
    );

    expect(issues.map((item) => item.code)).toContain(
      "SOURCE_EVENT_MODE_NOT_MATERIALIZED",
    );
  });

  it("keeps realm-specific fight design grounded and requires timed VFX/SFX cues", () => {
    const source = "林澈以筑基境施展青霄剑诀，剑光击中石壁，碎石迸裂。";
    const action = {
      type: "action" as const,
      text: source,
      origin: "source" as const,
      actionDesign: {
        kind: "skill" as const,
        performer: "林澈",
        target: "石壁",
        realm: "筑基境",
        technique: "青霄剑诀",
        visualMotif: "青白剑气呈窄长弧线，银色边缘粒子沿轨迹快速收束消散",
        visualMotifSource: "production_inference" as const,
        visualMotifRationale: "依据已确认剑诀事实设计可复用表现，不增加能力或结果",
        choreography: ["沉肩起剑蓄力", "剑光释放并命中石壁"],
        impact: "碎石迸裂",
        environmentResponse: "石壁碎石迸裂",
        vfxPlan: [
          {
            phase: "release" as const,
            category: "weapon_trail" as const,
            description: "剑光沿挥剑方向形成连续轨迹",
          },
        ],
        sfxPlan: [
          {
            phase: "impact" as const,
            type: "destruction" as const,
            description: "剑光命中与碎石爆裂",
          },
        ],
        evidence: [source],
      },
    };
    const screenplay = {
      clipId: "clip-1",
      originalText: source,
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "书房", time: "夜" },
          description: "",
          characters: ["林澈"],
          content: [action],
        },
      ],
    };
    expect(
      validateScreenplayConversion(screenplay, {
        clipId: "clip-1",
        clipText: source,
        canonical,
      }),
    ).toEqual([]);

    const sourceText = JSON.stringify(screenplay);
    const issues = validateStoryboardPlanning(
      {
        panels: [
          {
            panelIndex: 0,
            sceneNumber: 0,
            shotType: "全景",
            cameraMove: "跟随剑光快速横移",
            durationSeconds: 3,
            startState: {
              body: "林澈沉肩持剑",
              hands: "双手握剑",
              gaze: "锁定石壁",
              screenDirection: "面向画面右侧",
              props: "青霄剑保持完整",
              characterStates: [
                {
                  name: "林澈",
                  position: "石壁左侧",
                  posture: "沉肩持剑",
                  facing: "面向石壁",
                  gazeTarget: "石壁",
                  leftHand: "握住剑柄",
                  rightHand: "握住剑柄",
                  contact: null,
                },
              ],
              propStates: [],
            },
            endState: {
              body: "林澈完成挥剑后收势",
              hands: "双手仍握剑",
              gaze: "看向命中点",
              screenDirection: "面向画面右侧",
              props: "青霄剑保持完整",
              characterStates: [
                {
                  name: "林澈",
                  position: "石壁左侧",
                  posture: "挥剑后收势",
                  facing: "面向石壁",
                  gazeTarget: "命中点",
                  leftHand: "握住剑柄",
                  rightHand: "握住剑柄",
                  contact: null,
                },
              ],
              propStates: [],
            },
            worldContext: {
              realm: "筑基境",
              technique: "青霄剑诀",
              powerRule: "剑光可击裂石壁",
              visualMotif:
                "青白剑气呈窄长弧线，银色边缘粒子沿轨迹快速收束消散",
              environmentScale: "人物与石壁同框建立破坏尺度",
              evidence: [source],
            },
            motionTimeline: [
              {
                startSecond: 0,
                endSecond: 1,
                action: "沉肩起剑",
                camera: "全景锁定轴线",
                phase: "anticipation",
                beatId: "B1",
                actor: "林澈",
                target: "石壁",
                bodyPart: "双肩与双手",
                prop: "青霄剑",
                trajectory: "剑身由低位抬至肩侧",
                contact: "none",
                contactPoint: null,
                reaction: null,
                result: "完成沉肩起剑蓄力",
                causedBy: null,
                choreographyStep: "沉肩起剑蓄力",
              },
              {
                startSecond: 1,
                endSecond: 2,
                action: "挥剑释放剑光",
                camera: "跟随剑光横移",
                phase: "release",
                beatId: "B2",
                actor: "林澈",
                target: "石壁",
                bodyPart: "双手",
                prop: "青霄剑",
                trajectory: "剑光沿挥剑方向横向命中石壁",
                contact: "strike",
                contactPoint: "石壁中心",
                reaction: "石壁受击开裂",
                result: "剑光释放并命中石壁",
                causedBy: "B1",
                choreographyStep: "剑光释放并命中石壁",
              },
              {
                startSecond: 2,
                endSecond: 3,
                action: "石壁碎裂，林澈收势",
                camera: "停在命中点后回收",
                phase: "aftermath",
                beatId: "B3",
                actor: "林澈",
                target: "石壁",
                bodyPart: "双手",
                prop: "青霄剑",
                trajectory: "剑身沿原挥动方向回收",
                contact: "none",
                contactPoint: null,
                reaction: "石壁碎石迸裂",
                result: "石壁碎石迸裂，林澈完成收势",
                causedBy: "B2",
                choreographyStep: null,
              },
            ],
            vfxCues: [
              {
                atSecond: 1,
                phase: "release",
                category: "weapon_trail",
                description: "剑光沿挥剑方向延伸并命中石壁",
                evidence: [source],
              },
            ],
            sfxCues: [
              {
                startSecond: 2,
                endSecond: 3,
                type: "destruction",
                description: "命中冲击、碎石爆裂与室内回声",
                evidence: [source],
              },
            ],
            description: source,
            locationName: "书房",
            characters: ["林澈"],
            props: [],
            imagePrompt: source,
            videoPrompt: source,
            sourceEvidence: [source],
          },
        ],
      },
      { sourceText, canonical, screenplay },
    );
    expect(issues).toEqual([]);

    const invented = structuredClone(screenplay);
    invented.scenes[0].content[0].actionDesign.technique = "万雷灭世诀";
    expect(
      validateScreenplayConversion(invented, {
        clipId: "clip-1",
        clipText: source,
        canonical,
      }).map((item) => item.code),
    ).toContain("ACTION_DESIGN_TERM_NOT_GROUNDED");

    const missingMotif = structuredClone(screenplay);
    delete (missingMotif.scenes[0].content[0].actionDesign as {
      visualMotif?: string;
    }).visualMotif;
    expect(
      validateScreenplayConversion(missingMotif, {
        clipId: "clip-1",
        clipText: source,
        canonical,
      }).map((item) => item.code),
    ).toContain("VFX_VISUAL_MOTIF_REQUIRED");

    const missingRationale = structuredClone(screenplay);
    delete (missingRationale.scenes[0].content[0].actionDesign as {
      visualMotifRationale?: string;
    }).visualMotifRationale;
    expect(
      validateScreenplayConversion(missingRationale, {
        clipId: "clip-1",
        clipText: source,
        canonical,
      }).map((item) => item.code),
    ).toContain("VFX_VISUAL_MOTIF_RATIONALE_REQUIRED");

  });

  it("rejects narration and accepts an explicitly introduced unquoted line", () => {
    const source =
      "韩子枫望着儿子，既欣慰又愧疚。若自己没有重伤，韩宇本可早早突破。韩宇反而安慰父亲，只要坚持，终有一天能让轻视他们的人闭嘴。";
    const issues = validateScreenplayConversion(
      {
        clipId: "clip-1",
        originalText: source,
        scenes: [
          {
            sceneNumber: 0,
            heading: { intExt: "INT", location: "书房", time: "夜" },
            description: "",
            characters: ["韩宇", "韩子枫"],
            content: [
              {
                type: "dialogue",
                character: "韩宇",
                parenthetical: null,
                lines: "韩宇本可早早突破。",
              },
              {
                type: "dialogue",
                character: "韩宇",
                parenthetical: null,
                lines: "只要坚持，终有一天能让轻视他们的人闭嘴。",
              },
            ],
          },
        ],
      },
      {
        clipId: "clip-1",
        clipText: source,
        canonical: {
          characters: ["韩宇", "韩子枫"],
          locations: ["书房"],
          props: [],
        },
      },
    );

    expect(issues.map((item) => item.code)).toContain(
      "DIALOGUE_NOT_DIRECT_SPEECH",
    );
    expect(
      issues.filter((item) => item.path.endsWith(".lines")).map((item) => item.code),
    ).toEqual(["DIALOGUE_NOT_DIRECT_SPEECH"]);
  });

  it("does not treat calling someone into a room as spoken dialogue", () => {
    expect(
      isDirectSpeechExcerpt(
        "从暗格中取出一个精致铁盒。",
        "韩子枫",
        "韩子枫神色郑重地把韩宇叫进卧房，从暗格中取出一个精致铁盒。",
      ),
    ).toBe(false);
  });

  it("does not treat a shouted sound followed by action as dialogue", () => {
    expect(
      isDirectSpeechExcerpt(
        "身前的平静海潮顿时骇浪升起，向着九炎天龙席卷而去。",
        "海宏赡",
        "海宏赡厉喝一声，身前的平静海潮顿时骇浪升起，向着九炎天龙席卷而去。",
      ),
    ).toBe(false);
  });

  it("removes exact empty entity placeholders from storyboard planning", () => {
    const normalized = normalizeStoryboardPlanningEntities({
      panels: [
        {
          panelIndex: 0,
          shotType: "中景",
          cameraMove: "稳定",
          durationSeconds: 2,
          motionTimeline: [
            {
              startSecond: 0,
              endSecond: 2,
              action: "海潮升起",
              camera: "稳定",
            },
          ],
          vfxCues: [],
          sfxCues: [],
          description: "海潮升起",
          locationName: "书房",
          characters: ["林澈", "无"],
          props: ["无", "无字古籍"],
          imagePrompt: null,
          videoPrompt: "海潮升起",
          sourceEvidence: ["海潮升起"],
        },
      ],
    });

    expect(normalized.panels[0].characters).toEqual(["林澈"]);
    expect(normalized.panels[0].props).toEqual(["无字古籍"]);
  });

  it("grounds planning evidence and corrects a voiceover placed in lip sync", () => {
    const screenplay = {
      clipId: "clip-1",
      originalText: "剑光劈开石壁。天地震动。",
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "书房", time: "夜" },
          description: "",
          characters: ["林澈"],
          content: [
            { type: "action" as const, text: "剑光劈开石壁。" },
            {
              type: "voiceover" as const,
              character: null,
              text: "天地震动。",
            },
          ],
        },
      ],
    };
    const sourceText = JSON.stringify(screenplay, null, 2);
    const normalized = normalizeStoryboardPlanningContract(
      {
        panels: [
          {
            panelIndex: 0,
            sceneNumber: 0,
            shotType: "中景",
            cameraMove: "稳定",
            durationSeconds: 3,
            motionTimeline: [
              {
                startSecond: 0,
                endSecond: 3,
                action: "剑光劈开石壁，天地震动",
                camera: "稳定",
                beatId: "B1",
                actor: "林澈",
                target: "石壁",
                bodyPart: "双手",
                prop: null,
                trajectory: "剑光由林澈挥剑方向劈向石壁",
                contact: "strike",
                contactPoint: "石壁中心",
                reaction: "石壁劈开并震动",
                result: "剑光劈开石壁，天地震动",
                causedBy: null,
                choreographyStep: "剑光劈开石壁",
              },
            ],
            startState: {
              body: "林澈挥剑",
              hands: "持剑",
              gaze: "看向石壁",
              screenDirection: "面向画面右侧",
              props: "无",
              characterStates: [
                {
                  name: "林澈",
                  position: "石壁左侧",
                  posture: "挥剑",
                  facing: "面向石壁",
                  gazeTarget: "石壁",
                  leftHand: "持剑",
                  rightHand: "持剑",
                  contact: null,
                },
              ],
              propStates: [],
            },
            endState: {
              body: "林澈收剑",
              hands: "持剑",
              gaze: "看向石壁",
              screenDirection: "面向画面右侧",
              props: "无",
              characterStates: [
                {
                  name: "林澈",
                  position: "石壁左侧",
                  posture: "收剑",
                  facing: "面向石壁",
                  gazeTarget: "石壁",
                  leftHand: "持剑",
                  rightHand: "持剑",
                  contact: null,
                },
              ],
              propStates: [],
            },
            vfxCues: [
              {
                atSecond: 1,
                phase: "impact",
                category: "explosion_debris",
                description: "石壁爆裂",
                evidence: ["模型改写的视觉证据"],
              },
            ],
            sfxCues: [
              {
                startSecond: 1,
                endSecond: 2,
                type: "destruction",
                description: "石壁碎裂声",
                evidence: ["批准的石壁碎裂音效", "模型改写的声音证据"],
              },
            ],
            speakingCharacter: "旁白",
            lipSyncText: "天地震动。",
            voiceoverText: null,
            description: "剑光劈开石壁，天地震动",
            locationName: "书房",
            characters: ["林澈"],
            props: [],
            imagePrompt: null,
            videoPrompt: "剑光劈开石壁",
            sourceEvidence: ["模型改写的面板证据"],
          },
        ],
      },
      {
        sourceText,
        screenplay,
        productionContextText: "批准的石壁碎裂音效",
      },
    );

    expect(normalized.panels[0]).toMatchObject({
      speakingCharacter: null,
      lipSyncText: null,
      voiceoverText: "天地震动。",
      sourceEvidence: ["剑光劈开石壁。"],
      vfxCues: [],
      sfxCues: [{ evidence: ["批准的石壁碎裂音效"] }],
    });
    expect(
      validateStoryboardPlanning(normalized, {
        sourceText,
        canonical: {
          characters: ["林澈"],
          locations: ["书房"],
          props: [],
        },
        screenplay,
        productionContextText: "批准的石壁碎裂音效",
      }),
    ).toEqual([]);
  });

  it("inherits adjacent continuity fields within the same scene", () => {
    const screenplay = {
      clipId: "clip-1",
      originalText: "林澈挥剑。",
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "书房", time: "夜" },
          description: "",
          characters: ["林澈"],
          content: [{ type: "action" as const, text: "林澈挥剑。" }],
        },
      ],
    };
    const sourceText = JSON.stringify(screenplay, null, 2);
    const basePanel = {
      panelIndex: 0,
      sceneNumber: 0,
      shotType: "中景",
      cameraMove: "稳定",
      durationSeconds: 2,
      motionTimeline: [
        {
          startSecond: 0,
          endSecond: 2,
          action: "林澈挥剑",
          camera: "稳定",
        },
      ],
      startState: {
        body: "林澈起势",
        hands: "右手持剑",
        gaze: "看向前方",
        screenDirection: "面向画面右侧",
        props: "长剑完整",
      },
      endState: {
        body: "林澈挥剑结束",
        hands: "双手持剑",
        gaze: "看向前方",
        screenDirection: "面向画面左侧",
        props: "长剑沾尘",
      },
      vfxCues: [],
      sfxCues: [],
      speakingCharacter: null,
      lipSyncText: null,
      voiceoverText: null,
      description: "林澈挥剑",
      locationName: "书房",
      characters: ["林澈"],
      props: [],
      imagePrompt: null,
      videoPrompt: "林澈挥剑",
      sourceEvidence: ["林澈挥剑。"],
    };
    const normalized = normalizeStoryboardPlanningContract(
      {
        panels: [
          basePanel,
          {
            ...basePanel,
            panelIndex: 1,
            startState: {
              ...basePanel.startState,
              hands: "右手持剑",
              screenDirection: "面向画面右侧",
              props: "长剑完整",
            },
          },
        ],
      },
      { sourceText, screenplay },
    );

    expect(normalized.panels[1].startState).toMatchObject({
      hands: "双手持剑",
      screenDirection: "面向画面左侧",
      props: "长剑沾尘",
    });
    expect(
      validateStoryboardPlanning(normalized, {
        sourceText,
        canonical: {
          characters: ["林澈"],
          locations: ["书房"],
          props: [],
        },
        screenplay,
      }),
    ).toEqual([]);
  });

  it("does not inherit continuity state when the cast changes in one scene", () => {
    const screenplay = {
      clipId: "clip-1",
      originalText: "林澈收剑。顾言抬头。",
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "书房", time: "夜" },
          description: "",
          characters: ["林澈", "顾言"],
          content: [
            { type: "action" as const, text: "林澈收剑。" },
            { type: "action" as const, text: "顾言抬头。" },
          ],
        },
      ],
    };
    const sourceText = JSON.stringify(screenplay, null, 2);
    const panel = (panelIndex: number, character: string) => ({
      panelIndex,
      sceneNumber: 0,
      shotType: "中景",
      cameraMove: "稳定",
      durationSeconds: 2,
      motionTimeline: [
        {
          startSecond: 0,
          endSecond: 2,
          action: panelIndex ? "顾言抬头" : "林澈收剑",
          camera: "稳定",
        },
      ],
      startState: {
        body: `${character}处于起始姿态`,
        hands: panelIndex ? "双手背后" : "右手持剑",
        gaze: "看向前方",
        screenDirection: panelIndex ? "面向画面左侧" : "面向画面右侧",
        props: panelIndex ? "无" : "长剑完整",
      },
      endState: {
        body: `${character}完成动作`,
        hands: panelIndex ? "双手背后" : "双手持剑",
        gaze: "看向前方",
        screenDirection: panelIndex ? "面向画面左侧" : "面向画面右侧",
        props: panelIndex ? "无" : "长剑归鞘",
      },
      vfxCues: [],
      sfxCues: [],
      speakingCharacter: null,
      lipSyncText: null,
      voiceoverText: null,
      description: panelIndex ? "顾言抬头" : "林澈收剑",
      locationName: "书房",
      characters: [character],
      props: [],
      imagePrompt: null,
      videoPrompt: panelIndex ? "顾言抬头" : "林澈收剑",
      sourceEvidence: [panelIndex ? "顾言抬头。" : "林澈收剑。"],
    });

    const changedCastPanel = panel(1, "顾言");
    changedCastPanel.startState.body = "虚空中的老者立于原位";
    changedCastPanel.endState.body = "虚空中的老者抬手";
    const normalized = normalizeStoryboardPlanningContract(
      { panels: [panel(0, "林澈"), changedCastPanel] },
      { sourceText, screenplay },
    );

    expect(normalized.panels[1].startState).toMatchObject({
      body: "顾言处于本镜起始姿态",
      hands: "双手背后",
      screenDirection: "面向画面左侧",
      props: "无",
    });
    expect(
      validateStoryboardPlanning(normalized, {
        sourceText,
        canonical: {
          characters: ["林澈", "顾言"],
          locations: ["书房"],
          props: [],
        },
        screenplay,
      }),
    ).toEqual([]);
  });

  it("recognizes only anchored, non-spoken visual bridge actions", () => {
    const source = "韩子枫从暗格中取出一个精致铁盒。";
    expect(
      isImplicitVisualBridgeAction(
        "韩子枫走到暗格前，伸手靠近暗格。",
        source,
      ),
    ).toBe(true);
    expect(
      isImplicitVisualBridgeAction("韩子枫走到密室前，拔出宝剑。", source),
    ).toBe(false);
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
              cameraStart: {
                position: "角色正前方两米",
                height: "平视",
                angle: "正面",
                shotSize: "中景",
                composition: "角色居中",
                focus: "林澈",
              },
              cameraPath: {
                primaryMovement: "locked",
                direction: "保持机位",
                speed: "静止",
                distance: "零",
                stabilization: "三脚架",
                focusChange: null,
              },
              cameraEnd: {
                shotSize: "中景",
                composition: "角色居中",
                focus: "林澈",
                nextCutPoint: "动作完成",
              },
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

  it("rejects acting direction that cannot quote the current panel", () => {
    const issues = validateActingCoverage(
      {
        directions: [
          {
            panelIndex: 0,
            characters: [
              {
                name: "林澈",
                emotion: "警觉",
                action: "拔剑迎敌",
                expression: "目光收紧",
                evidence: ["突然拔剑迎敌"],
              },
            ],
          },
        ],
      },
      [
        {
          panelIndex: 0,
          characters: ["林澈"],
          description: "林澈低头查看怀表",
          sourceEvidence: ["林澈看向怀表。"],
          motionTimeline: [{ action: "林澈抬起怀表" }],
        },
      ],
    );

    expect(issues.map((item) => item.code)).toContain(
      "ACTING_DIRECTION_NOT_GROUNDED",
    );
  });

  it("requires actionDesign for combat actions", () => {
    const source = "林澈挥剑攻击顾言。";
    const issues = validateScreenplayConversion(
      {
        clipId: "clip-1",
        originalText: source,
        scenes: [
          {
            sceneNumber: 0,
            heading: { intExt: "INT", location: "书房", time: "夜" },
            description: "",
            characters: ["林澈", "顾言"],
            content: [{ type: "action", text: source, origin: "source" }],
          },
        ],
      },
      {
        clipId: "clip-1",
        clipText: source,
        canonical: {
          characters: ["林澈", "顾言"],
          locations: ["书房"],
          props: [],
        },
      },
    );

    expect(issues.map((item) => item.code)).toContain("ACTION_DESIGN_REQUIRED");
  });

  it("blocks incomplete interaction beats and unstructured entity state", () => {
    const source = "林澈挥剑攻击顾言。";
    const issues = validateStoryboardPlanning(
      {
        panels: [
          {
            panelIndex: 0,
            sceneNumber: 0,
            shotType: "全景",
            cameraMove: "稳定跟随",
            durationSeconds: 2,
            motionTimeline: [
              {
                startSecond: 0,
                endSecond: 2,
                action: source,
                camera: "稳定跟随",
              },
            ],
            startState: {
              body: "林澈与顾言相对站立",
              hands: "林澈持剑，顾言空手",
              gaze: "互相注视",
              screenDirection: "林澈向右，顾言向左",
              props: "长剑在林澈手中",
            },
            endState: {
              body: "林澈与顾言完成交锋",
              hands: "林澈持剑，顾言空手",
              gaze: "互相注视",
              screenDirection: "林澈向右，顾言向左",
              props: "长剑在林澈手中",
            },
            vfxCues: [],
            sfxCues: [],
            description: source,
            locationName: "书房",
            characters: ["林澈", "顾言"],
            props: ["长剑"],
            imagePrompt: source,
            videoPrompt: source,
            sourceEvidence: [source],
          },
        ],
      },
      {
        sourceText: source,
        canonical: {
          characters: ["林澈", "顾言"],
          locations: ["书房"],
          props: ["长剑"],
        },
      },
    );

    expect(issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "INTERACTION_BEAT_CONTRACT_REQUIRED",
        "CHARACTER_STATE_COVERAGE_MISMATCH",
        "PROP_STATE_COVERAGE_MISMATCH",
      ]),
    );
  });

  it("requires choreography, target reaction, impact, and environment response in storyboard content", () => {
    const source = "林澈挥剑攻击顾言。";
    const screenplay = {
      clipId: "clip-1",
      originalText: source,
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "书房", time: "夜" },
          description: "",
          characters: ["林澈", "顾言"],
          content: [
            {
              type: "action" as const,
              text: source,
              origin: "source" as const,
              actionDesign: {
                kind: "fight" as const,
                performer: "林澈",
                target: "顾言",
                realm: null,
                technique: null,
                visualMotif: null,
                visualMotifSource: null,
                visualMotifRationale: null,
                choreography: ["林澈挥剑", "顾言侧身闪避"],
                impact: "顾言肩部受击后退",
                environmentResponse: "书架被撞得震动",
                vfxPlan: [],
                sfxPlan: [],
                evidence: [source],
              },
            },
          ],
        },
      ],
    };
    const state = {
      body: "林澈与顾言相对站立",
      hands: "林澈持剑，顾言空手",
      gaze: "互相注视",
      screenDirection: "林澈向右，顾言向左",
      props: "无关键道具",
      characterStates: [
        {
          name: "林澈",
          position: "画面左侧",
          posture: "挥剑",
          facing: "向右",
          gazeTarget: "顾言",
          leftHand: "扶剑柄",
          rightHand: "握剑",
          contact: null,
        },
        {
          name: "顾言",
          position: "画面右侧",
          posture: "站立",
          facing: "向左",
          gazeTarget: "林澈",
          leftHand: "空闲",
          rightHand: "空闲",
          contact: null,
        },
      ],
      propStates: [],
    };
    const issues = validateStoryboardPlanning(
      {
        panels: [
          {
            panelIndex: 0,
            sceneNumber: 0,
            shotType: "全景",
            cameraMove: "稳定跟随",
            durationSeconds: 2,
            motionTimeline: [
              {
                startSecond: 0,
                endSecond: 2,
                action: source,
                camera: "稳定跟随",
                beatId: "B1",
                actor: "林澈",
                target: "顾言",
                bodyPart: "右手",
                prop: "长剑",
                trajectory: "由左向右横挥",
                contact: "none",
                contactPoint: null,
                reaction: null,
                result: "林澈完成挥剑",
                causedBy: null,
                choreographyStep: "林澈挥剑",
              },
            ],
            startState: state,
            endState: state,
            vfxCues: [],
            sfxCues: [],
            description: source,
            locationName: "书房",
            characters: ["林澈", "顾言"],
            props: [],
            imagePrompt: source,
            videoPrompt: source,
            sourceEvidence: [source],
          },
        ],
      },
      {
        sourceText: JSON.stringify(screenplay),
        canonical: {
          characters: ["林澈", "顾言"],
          locations: ["书房"],
          props: [],
        },
        screenplay,
      },
    );

    expect(issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "ACTION_CHOREOGRAPHY_STEP_MISSING",
        "ACTION_TARGET_REACTION_MISSING",
        "ACTION_RESULT_NOT_MATERIALIZED",
      ]),
    );
  });

  it("requires timed acting context and a reaction beat for interaction targets", () => {
    const panels = [
      {
        panelIndex: 0,
        durationSeconds: 2,
        characters: ["林澈", "顾言"],
        description: "林澈抓住顾言手腕。",
        sourceEvidence: ["林澈抓住顾言手腕。"],
        motionTimeline: [
          {
            startSecond: 0,
            endSecond: 2,
            action: "林澈抓住顾言手腕。",
            actor: "林澈",
            target: "顾言",
            contact: "grab",
            beatId: "B1",
          },
        ],
      },
    ];
    const missing = validateActingCoverage(
      {
        directions: [
          {
            panelIndex: 0,
            characters: ["林澈", "顾言"].map((name) => ({
              name,
              emotion: "警觉",
              action: "完成互动",
              expression: "目光收紧",
              evidence: ["林澈抓住顾言手腕。"],
            })),
          },
        ],
      },
      panels,
    );
    expect(missing.map((item) => item.code)).toEqual(
      expect.arrayContaining(["ACTING_BEATS_REQUIRED", "TARGET_REACTION_BEAT_REQUIRED"]),
    );

    const complete = validateActingCoverage(
      {
        directions: [
          {
            panelIndex: 0,
            characters: ["林澈", "顾言"].map((name) => ({
              name,
              emotion: "警觉",
              action: "完成互动",
              expression: "目光收紧",
              evidence: ["林澈抓住顾言手腕。"],
              beats: [
                {
                  startSecond: 0,
                  endSecond: 2,
                  objective: name === "林澈" ? "阻止顾言" : "挣脱控制",
                  subtext: name === "林澈" ? "不能让他离开" : "必须脱身",
                  action: name === "林澈" ? "抓紧手腕" : "手臂回抽",
                  expression: "目光收紧",
                  gazeTarget: name === "林澈" ? "顾言手腕" : "林澈",
                  reactionTo: name === "顾言" ? "B1" : null,
                  evidence: ["林澈抓住顾言手腕。"],
                },
              ],
            })),
          },
        ],
      },
      panels,
    );
    expect(complete).toEqual([]);
  });

  it("rejects shots that exceed the interaction complexity budget", () => {
    const source = "林澈与顾言连续交战。";
    const characters = ["林澈", "顾言"];
    const characterStates = characters.map((name, index) => ({
      name,
      position: index ? "画面右侧" : "画面左侧",
      posture: "交战姿态",
      facing: index ? "向左" : "向右",
      gazeTarget: characters[1 - index],
      leftHand: "参与攻防",
      rightHand: "参与攻防",
      contact: null,
    }));
    const issues = validateStoryboardPlanning(
      {
        panels: [
          {
            panelIndex: 0,
            shotType: "全景",
            cameraMove: "跟随",
            durationSeconds: 8,
            motionTimeline: Array.from({ length: 8 }, (_, index) => ({
              startSecond: index,
              endSecond: index + 1,
              action: `${source}第${index + 1}拍`,
              camera: "跟随",
              beatId: `B${index + 1}`,
              actor: characters[index % 2],
              target: characters[(index + 1) % 2],
              bodyPart: "双手",
              prop: null,
              trajectory: "沿交战轴线推进",
              contact: "none" as const,
              contactPoint: null,
              reaction: null,
              result: `完成第${index + 1}拍`,
              causedBy: index ? `B${index}` : null,
              choreographyStep: `第${index + 1}拍`,
            })),
            startState: {
              body: source,
              hands: "双方双手参与攻防",
              gaze: "互相锁定",
              screenDirection: "林澈向右，顾言向左",
              props: "无",
              characterStates,
              propStates: [],
            },
            endState: {
              body: source,
              hands: "双方双手参与攻防",
              gaze: "互相锁定",
              screenDirection: "林澈向右，顾言向左",
              props: "无",
              characterStates,
              propStates: [],
            },
            vfxCues: [],
            sfxCues: [
              {
                startSecond: 0,
                endSecond: 1,
                type: "impact",
                description: "交锋声",
                evidence: [source],
              },
            ],
            description: source,
            locationName: "书房",
            characters,
            props: [],
            imagePrompt: source,
            videoPrompt: source,
            sourceEvidence: [source],
          },
        ],
      },
      {
        sourceText: source,
        canonical: { characters, locations: ["书房"], props: [] },
      },
    );

    expect(issues.map((item) => item.code)).toContain(
      "SHOT_INTERACTION_COMPLEXITY_EXCEEDED",
    );
  });

  it("rejects storyboards that drop ordinary actions, scenes, or source events", () => {
    const screenplay = {
      clipId: "clip-1",
      originalText: "林澈进门。顾言递出怀表。",
      coverage: [
        {
          eventId: "E001",
          evidence: "林澈进门。",
          modes: ["visual" as const],
          reason: null,
        },
        {
          eventId: "E002",
          evidence: "顾言递出怀表。",
          modes: ["visual" as const],
          reason: null,
        },
      ],
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "门厅", time: "夜" },
          description: "门厅夜间",
          characters: ["林澈"],
          content: [{ type: "action" as const, text: "林澈进门。" }],
        },
        {
          sceneNumber: 1,
          heading: { intExt: "INT" as const, location: "书房", time: "夜" },
          description: "书房夜间",
          characters: ["顾言"],
          content: [{ type: "action" as const, text: "顾言递出怀表。" }],
        },
      ],
    };
    const panel = {
      panelIndex: 0,
      sceneNumber: 0,
      shotType: "中景",
      cameraMove: "稳定",
      durationSeconds: 2,
      startState: {
        body: "林澈站在门外",
        hands: "双手自然垂下",
        gaze: "看向门内",
        screenDirection: "面向画面右侧",
        props: "无",
      },
      endState: {
        body: "林澈进入门厅",
        hands: "双手自然垂下",
        gaze: "看向室内",
        screenDirection: "面向画面右侧",
        props: "无",
      },
      motionTimeline: [
        {
          startSecond: 0,
          endSecond: 2,
          action: "林澈进门",
          camera: "稳定跟随",
        },
      ],
      vfxCues: [],
      sfxCues: [],
      speakingCharacter: null,
      lipSyncText: null,
      voiceoverText: null,
      description: "林澈进门",
      locationName: "门厅",
      characters: ["林澈"],
      props: [],
      imagePrompt: "林澈进门",
      videoPrompt: "林澈进门",
      sourceEvidence: ["林澈进门。"],
    };

    const issues = validateStoryboardPlanning(
      { panels: [panel] },
      {
        sourceText: JSON.stringify(screenplay),
        canonical: {
          characters: ["林澈", "顾言"],
          locations: ["门厅", "书房"],
          props: ["怀表"],
        },
        screenplay,
      },
    );
    expect(issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "SCREENPLAY_SCENE_MISSING",
        "SCREENPLAY_ACTION_MISSING",
        "STORYBOARD_SOURCE_EVENT_MISSING",
      ]),
    );
  });

  it("rejects a storyboard that keeps an event only as evidence metadata", () => {
    const source = "顾言递出怀表。";
    const screenplay = {
      clipId: "clip-1",
      originalText: source,
      coverage: [
        {
          eventId: "E001",
          evidence: source,
          modes: ["visual" as const],
          reason: null,
        },
      ],
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "书房", time: "夜" },
          description: "书房夜间",
          characters: ["顾言"],
          content: [{ type: "action" as const, text: source }],
        },
      ],
    };
    const issues = validateStoryboardPlanning(
      {
        panels: [
          {
            panelIndex: 0,
            sceneNumber: 0,
            shotType: "中景",
            cameraMove: "稳定",
            durationSeconds: 2,
            startState: {
              body: "顾言站在书桌旁",
              hands: "双手自然垂下",
              gaze: "看向前方",
              screenDirection: "面向画面左侧",
              props: "怀表在桌上",
            },
            endState: {
              body: "顾言仍站在书桌旁",
              hands: "双手自然垂下",
              gaze: "看向前方",
              screenDirection: "面向画面左侧",
              props: "怀表在桌上",
            },
            motionTimeline: [
              {
                startSecond: 0,
                endSecond: 2,
                action: "顾言静静站立",
                camera: "固定中景",
              },
            ],
            vfxCues: [],
            sfxCues: [],
            speakingCharacter: null,
            lipSyncText: null,
            voiceoverText: null,
            description: "顾言静静站在书桌旁",
            locationName: "书房",
            characters: ["顾言"],
            props: ["怀表"],
            imagePrompt: "顾言站在书桌旁",
            videoPrompt: "顾言保持站立",
            sourceEvidence: [source],
          },
        ],
      },
      {
        sourceText: JSON.stringify(screenplay),
        canonical: {
          characters: ["顾言"],
          locations: ["书房"],
          props: ["怀表"],
        },
        screenplay,
      },
    );

    expect(issues.map((item) => item.code)).toContain(
      "SCREENPLAY_ACTION_NOT_MATERIALIZED",
    );
  });

  it("does not let one depicted action satisfy two repeated screenplay beats", () => {
    const repeated = "钟声响起。";
    const screenplay = {
      clipId: "clip-1",
      originalText: repeated.repeat(2),
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "书房", time: "夜" },
          description: "夜间书房",
          characters: [],
          content: [
            { type: "action" as const, text: repeated },
            { type: "action" as const, text: repeated },
          ],
        },
      ],
    };
    const issues = validateStoryboardPlanning(
      {
        panels: [
          {
            panelIndex: 0,
            sceneNumber: 0,
            shotType: "空镜",
            cameraMove: "稳定",
            durationSeconds: 2,
            startState: {
              body: "环境空镜",
              hands: "无",
              gaze: "无",
              screenDirection: "固定轴线",
              props: "无",
            },
            endState: {
              body: "环境空镜",
              hands: "无",
              gaze: "无",
              screenDirection: "固定轴线",
              props: "无",
            },
            motionTimeline: [
              {
                startSecond: 0,
                endSecond: 2,
                action: repeated,
                camera: "固定空镜",
              },
            ],
            vfxCues: [],
            sfxCues: [],
            speakingCharacter: null,
            lipSyncText: null,
            voiceoverText: null,
            description: repeated,
            locationName: "书房",
            characters: [],
            props: [],
            imagePrompt: repeated,
            videoPrompt: repeated,
            sourceEvidence: [repeated],
          },
        ],
      },
      {
        sourceText: JSON.stringify(screenplay),
        canonical: { characters: [], locations: ["书房"], props: [] },
        screenplay,
      },
    );

    expect(issues.map((item) => item.code)).toContain(
      "SCREENPLAY_ACTION_NOT_MATERIALIZED",
    );
  });

  it("rejects refinement changes to entities and source evidence", () => {
    const panel = {
      panelIndex: 0,
      shotType: "中景",
      cameraMove: "缓慢推近",
      durationSeconds: 2,
      vfxCues: [],
      sfxCues: [],
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

    const normalized = normalizeStoryboardRefinementContract(
      {
        panels: [
          {
            ...panel,
            cameraMove: "快速摇镜",
            durationSeconds: 3,
            characters: ["林澈", "海宏赡"],
            props: [],
            sourceEvidence: ["改写证据"],
          },
        ],
      },
      [panel],
    );
    expect(normalized.panels[0]).toMatchObject({
      cameraMove: "缓慢推近",
      durationSeconds: 2,
      characters: ["林澈"],
      props: ["怀表"],
      sourceEvidence: ["林澈看怀表"],
    });
    expect(validateStoryboardRefinement(normalized, [panel])).toEqual([]);
  });

  it("rejects invented dialogue and unknown panel mappings", () => {
    const issues = validateVoiceAnalysis(
      {
        lines: [
          {
            speaker: "林澈",
            content: "模型补写的台词",
            delivery: "dialogue",
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

  it("rejects voice analysis that drops a storyboard spoken segment", () => {
    const issues = validateVoiceAnalysis(
      {
        lines: [
          {
            speaker: "林澈",
            content: "你好。",
            delivery: "dialogue",
            emotionPrompt: null,
            emotionStrength: 0.5,
            matchedPanelIndex: 0,
          },
        ],
      },
      {
        sourceText: "林澈说：你好。顾言回答：请进。",
        characters: ["林澈", "顾言"],
        panelIndices: [0, 1],
        panelSpokenText: [
          { panelIndex: 0, text: "你好。" },
          { panelIndex: 1, text: "请进。" },
        ],
      },
    );

    expect(issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "VOICE_PANEL_COVERAGE_MISMATCH",
        "VOICE_PANEL_MAPPING_MISMATCH",
      ]),
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
