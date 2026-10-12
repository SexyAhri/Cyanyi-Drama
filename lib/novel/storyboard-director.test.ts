import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/llm/openai-structured", () => ({ requestOpenAiStructured: request }));
vi.mock("@/lib/media/storyboard-prompt-design", () => ({
  resolvePromptDesignProvider: vi.fn(async () => ({
    baseUrl: "https://example.invalid", apiKeys: ["test"], model: "test",
  })),
}));

import { directStoryboard } from "./storyboard-director";
import {
  directorShotsGenerationSchema, directorShotsSchema, directorSpeechTiming,
  materializeDirectorShots, validateDirectorShots, type DirectorScene,
} from "./storyboard-scene-contract";
import { generateStructuredOutput } from "@/lib/llm/structured-output";
import { estimateSpeechDurationSeconds } from "@/lib/prompts/validators";

const spoken = "天".repeat(40);
const scene: DirectorScene = {
  id: "scene-1", clipId: "clip-1", sceneNumber: 0,
  heading: { intExt: "EXT", location: "庭院", time: "日" },
  description: "甲站在庭院说话", characters: ["甲"], props: [],
  units: [{
    id: "speech-1", contentIndex: 0, type: "dialogue", text: spoken,
    speaker: "甲", parenthetical: null, actionDesign: null,
  }],
};

function shot(duration = 12) {
  return {
    title: "甲说话", shot_type: "中景", duration_seconds: duration,
    source_unit_ids: ["speech-1"], characters: ["甲"], asset_names: ["甲", "庭院"],
    scene_description: "甲站在庭院", action_description: "甲保持站姿说话",
    camera_move: "固定机位", end_state: "甲站立并闭口",
    speech: { source_id: "speech-1", text: spoken },
    image_prompt: "甲站在庭院，双手垂下", video_prompt: `甲保持站姿，固定镜头持续 ${duration} 秒`,
    productionDesign: {
      photography: {
        camera: "固定", cameraPosition: "平视", focalLength: "50mm", lighting: "日光",
        composition: "中景", depthOfField: "浅景深", colorTone: "自然",
      },
      acting: [{ name: "甲", emotion: "平静", action: "站立说话", expression: "自然" }],
      startState: { body: "甲站立", hands: "垂下", gaze: "前方", screenDirection: "朝右", props: "无" },
      motionBeats: [{ startSecond: 0, endSecond: duration, action: "甲站立说话", camera: "固定" }],
      worldContext: {
        realm: "不适用", technique: "不适用", powerRule: "不适用", environmentScale: "普通庭院", evidence: ["甲站在庭院说话"],
      },
      vfxCues: [], sfxCues: [],
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("director production contract regressions", () => {
  it("generates one production design and derives matching stored compatibility fields", () => {
    const properties = directorShotsGenerationSchema.shape.shots.element.shape;
    expect(properties).not.toHaveProperty("start_state");
    expect(properties).not.toHaveProperty("motion_beats");
    // Older response examples may still include conflicting copies. They are not authoritative.
    const data = directorShotsGenerationSchema.parse({ shots: [{
      ...shot(), start_state: "另一种措辞", motion_beats: [],
    }] });
    const shots = materializeDirectorShots(data.shots);
    expect(validateDirectorShots(scene, shots)).toEqual([]);
    expect(directorShotsSchema.parse({ shots }).shots[0].start_state).toBe("甲站立");
  });

  it("continues rejecting speech that does not fit instead of accepting an invalid plan", () => {
    const shots = materializeDirectorShots([shot(5)]);
    const errors = validateDirectorShots(scene, shots);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("needs at least 10s, declared 5s");
    expect(shots[0].duration_seconds).toBe(5);
  });

  it("provides exact long-line fragments and platform timing without changing whitespace", () => {
    const text = `  ${"天".repeat(140)}，别走！\nKeep this text.  `;
    const timing = directorSpeechTiming({ ...scene, units: [{ ...scene.units[0], text }] });
    expect(timing[0].minimum_seconds).toBeGreaterThan(15);
    expect(timing[0].suggested_fragments.map(fragment => fragment.text).join("")).toBe(text);
    for (const fragment of timing[0].suggested_fragments) {
      expect(fragment.minimum_seconds).toBe(estimateSpeechDurationSeconds(fragment.text));
      expect(fragment.minimum_seconds).toBeLessThanOrEqual(15);
    }
  });

  it("repairs a short speech shot with specific timing feedback and persists a consistent design", async () => {
    request.mockImplementation(async input => {
      const isReview = input.prompt.agentId === "production_storyboard-review";
      const isRepair = input.prompt.agentId === "production_storyboard-repair";
      const output = isReview
        ? { approved: true, summary: "通过", findings: [] }
        : { shots: [shot(isRepair ? 12 : 5)] };
      const parsed = await generateStructuredOutput({
        schema: input.schema, validate: input.validate,
        request: async () => JSON.stringify(output), prompt: input.prompt.text,
        maxCorrectionAttempts: 0,
      });
      return { ...parsed, trace: { agentId: input.prompt.agentId } };
    });
    const persistArtifact = vi.fn<(type: string, refId: string, payload: unknown) => Promise<void>>(async () => {});
    const result = await directStoryboard({
      userId: "user-1", channelId: "channel-1", model: "test", scenes: [scene],
      style: "写实", locale: "zh", productionSpec: "15秒内", visualRules: "自然光",
      assets: { characters: [], locations: [], props: [] },
      assertActive: async () => {}, persistArtifact,
    });
    expect(result.approved).toBe(true);
    expect(request).toHaveBeenCalledTimes(3);
    const generation = request.mock.calls[0][0];
    expect(generation.prompt.text).toContain('"speech_timing"');
    expect(generation.prompt.text).toContain('"minimum_seconds":10');
    expect(request.mock.calls[1][0].prompt.text).toContain("needs at least 10s, declared 5s");
    expect(result.panels[0]).toMatchObject({
      durationSeconds: 12, lipSyncText: spoken, startState: { body: "甲站立" },
      motionBeats: [{ startSecond: 0, endSecond: 12, action: "甲站立说话", camera: "固定" }],
    });
    const plan = persistArtifact.mock.calls.find(call => call[0] === "storyboard.director.plan");
    expect(plan).toBeDefined();
  });
});
