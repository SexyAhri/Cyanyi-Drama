import { describe, expect, it } from "vitest";
import { canonicalSceneDialogue, resolveStoryProductionConstraints, validateSceneDialoguePrompt, validateSingleFramePrompt, validateStoryProductionConstraints } from "./story-quality-contract";

describe("frozen story quality contract", () => {
  it("captures explicit Chinese and English counts without inferring shot counts", () => {
    expect(resolveStoryProductionConstraints("仅设2个连续场次，只用两名成年角色，只有一个地点，总时长60秒。分四个镜头。"))
      .toEqual({ sceneCount: 2, characterCount: 2, locationCount: 1, targetDurationSeconds: 60 });
    expect(resolveStoryProductionConstraints("exactly 2 scenes, only 2 adult characters, exactly 1 location; duration: 60 seconds"))
      .toEqual({ sceneCount: 2, characterCount: 2, locationCount: 1, targetDurationSeconds: 60 });
    expect(resolveStoryProductionConstraints("最多2场，至少两个人。第3场从街边开始。"))
      .toEqual({});
    expect(resolveStoryProductionConstraints("仅设一个场景，只设2个连续场次。全剧限两名成年角色。"))
      .toEqual({ sceneCount: 2, characterCount: 2, locationCount: 1 });
  });
  it("uses the latest exact request and preserves structured explicit choices", () => {
    expect(resolveStoryProductionConstraints("仅设4场。改为只设2场。", { characterCount: 3 }))
      .toEqual({ sceneCount: 2, characterCount: 3 });
    expect(resolveStoryProductionConstraints("道具尽量少，只保留关键道具独立建档。").propPolicy).toBe("minimal");
    expect(resolveStoryProductionConstraints("道具均作为普通场景道具。").propPolicy).toBe("inline");
  });
  it.each([
    "not exactly 2 scenes, not only 2 characters, not exactly 1 location",
    "预计时长60秒。大概总时长70秒。",
    "总时长60秒左右。片长90秒以内。",
    "estimated duration: 60 seconds; runtime 90 seconds or so",
    "不是全剧只在同一个地点。",
  ])("leaves uncertain and negated quantities in prose: %s", text => {
    expect(resolveStoryProductionConstraints(text)).toEqual({});
  });
  it("honors exact corrections and the full supported runtime range", () => {
    expect(resolveStoryProductionConstraints("不是只设4场而是只设2场。总时长3600秒。"))
      .toEqual({ sceneCount: 2, targetDurationSeconds: 3600 });
    expect(resolveStoryProductionConstraints("全剧只在同一个地点。之后改为只有两个地点。"))
      .toEqual({ locationCount: 2 });
  });
  it.each([
    "不要为普通道具独立建档，旧伞和钥匙仍独立建档。",
    "旧伞作为普通场景道具，钥匙单独建档。",
    "不必为所有道具独立建档。",
    "道具均作为普通场景道具。改为只保留关键道具独立建档。",
    "道具均作为普通场景道具，钥匙单独建档。",
  ])("keeps selective prop instructions from banning every dossier: %s", text => {
    expect(resolveStoryProductionConstraints(text).propPolicy).toBe("minimal");
  });
  it("applies the latest blanket prop policy and allows explicit overrides", () => {
    expect(resolveStoryProductionConstraints("道具尽量少。道具均作为普通场景道具。").propPolicy).toBe("inline");
    expect(resolveStoryProductionConstraints("不要为道具独立建档。").propPolicy).toBe("inline");
    expect(resolveStoryProductionConstraints("道具均作为普通场景道具。", { propPolicy: "standard" }).propPolicy).toBe("standard");
  });
  it("validates separate scene, cast, location and runtime constraints", () => {
    const story = { characters: [{ name: "甲" }, { name: "乙" }], locations: [{ name: "铺子" }], props: [], firstEpisode: { scenes: [{ durationSeconds: 30 }, { durationSeconds: 30 }] } };
    const constraints = { sceneCount: 2, characterCount: 2, locationCount: 1, targetDurationSeconds: 60, propPolicy: "inline" as const };
    expect(validateStoryProductionConstraints(story, constraints)).toEqual([]);
    expect(validateStoryProductionConstraints({ ...story, firstEpisode: { scenes: Array.from({ length: 4 }, () => ({ durationSeconds: 15 })) } }, constraints)).toEqual([expect.objectContaining({ path: "firstEpisode.scenes" })]);
    expect(validateStoryProductionConstraints({ ...story, props: [{ name: "普通工具" }] }, constraints)[0].code).toBe("story_prop_scope_mismatch");
  });
  it("rejects missing, reversed or wrongly attributed dialogue", () => {
    const lines = canonicalSceneDialogue({ sceneNumber: 2, dialogue: [{ speaker: "阿宁", line: "这是我妈那把伞。" }, { speaker: "老周", line: "我给它理好了。" }] });
    expect(lines.map(line => line.id)).toEqual(["scene-2-line-1", "scene-2-line-2"]);
    expect(validateSceneDialoguePrompt("阿宁说：“这是我妈那把伞。” 老周回答：“我给它理好了。”", lines)).toEqual([]);
    expect(validateSceneDialoguePrompt("老周说：“我给它理好了。” 阿宁说：“这是我妈那把伞。”", lines).length).toBeGreaterThan(0);
    expect(validateSceneDialoguePrompt("阿宁说：“这是我妈那把伞。”", lines)[0].code).toBe("dialogue_prompt_missing_or_reordered");
    expect(validateSceneDialoguePrompt("乙说：“这是我妈那把伞。” 老周说：“我给它理好了。”", lines)[0].code).toBe("dialogue_prompt_speaker_missing");
  });
  it("attributes speech to its explicit subject rather than nearby spectators or recipients", () => {
    const lines = [{ speaker: "阿宁", content: "这是我妈那把伞。" }, { speaker: "老周", content: "我给它理好了。" }];
    expect(validateSceneDialoguePrompt("阿宁看着老周。老周说：“这是我妈那把伞。”老周说：“我给它理好了。”", lines)[0].code)
      .toBe("dialogue_prompt_speaker_missing");
    expect(validateSceneDialoguePrompt("阿宁对老周说：“这是我妈那把伞。”老周向阿宁回答：“我给它理好了。”", lines))
      .toEqual([]);
    expect(validateSceneDialoguePrompt("0-3 秒：阿宁说：“这是我妈那把伞。”3-6 秒：老周回答：“我给它理好了。”", lines))
      .toEqual([]);
    expect(validateSceneDialoguePrompt("阿宁看着乙。乙说：“这是我妈那把伞。”老周说：“我给它理好了。”", lines)[0].code)
      .toBe("dialogue_prompt_speaker_missing");
  });
  it("preserves the speaker through long performance notes and consecutive sentences", () => {
    const lines = [{ speaker: "阿宁", content: "这是我妈那把伞。" }, { speaker: "阿宁", content: "我一直留着它。" }];
    const action = "手指贴着磨损的伞柄，肩膀绷紧又松开，视线仍落在伞面上。".repeat(6);
    expect(validateSceneDialoguePrompt(`阿宁（${action}）说：“这是我妈那把伞。我一直留着它。”`, lines)).toEqual([]);
    expect(validateSceneDialoguePrompt(`阿宁${"缓缓摩挲着伞柄".repeat(20)}说：“这是我妈那把伞。” “我一直留着它。”`, lines)).toEqual([]);
    expect(validateSceneDialoguePrompt("阿宁：“这是我妈那把伞。”乙：“我一直留着它。”", lines)[0].code)
      .toBe("dialogue_prompt_speaker_missing");
    expect(validateSceneDialoguePrompt("阿宁：“这是我妈那把伞。”一个陌生人说道：“我一直留着它。”", lines)[0].code)
      .toBe("dialogue_prompt_speaker_missing");
    expect(validateSceneDialoguePrompt("阿宁：“这是我妈那把伞。”并继续说道：“我一直留着它。”", lines)).toEqual([]);
  });
  it("rejects multiple moments in an image prompt", () => {
    expect(validateSingleFramePrompt("阿宁提着工具袋，然后将它放在脚边。")[0].code).toBe("image_prompt_multiple_moments");
    expect(validateSingleFramePrompt("阿宁站在右侧，工具袋在右手中。" )).toEqual([]);
    expect(validateSingleFramePrompt("背景从近到远逐渐虚化，人物保持静止。" )).toEqual([]);
    expect(validateSingleFramePrompt("A static background with gradually softer detail toward the horizon." )).toEqual([]);
  });
});
