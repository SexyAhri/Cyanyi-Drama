import { describe, expect, it } from "vitest";

import { estimateSpeechDurationSeconds } from "@/lib/prompts/validators";

import {
  normalizeStoryboardDialogueTiming,
  splitSpokenTextForShots,
} from "./storyboard-dialogue-timing";

describe("storyboard dialogue timing", () => {
  it("deterministically expands a short spoken shot to its minimum duration", () => {
    const result = normalizeStoryboardDialogueTiming({
      panels: [panel("这是一句需要更长口播时间的完整台词。", 2)],
    });

    expect(result.panels).toHaveLength(1);
    expect(result.panels[0].durationSeconds).toBe(
      estimateSpeechDurationSeconds(result.panels[0].lipSyncText!),
    );
    expect(result.panels[0].motionTimeline.at(-1)?.endSecond).toBe(
      result.panels[0].durationSeconds,
    );
  });

  it("splits long speech at natural punctuation and preserves it exactly", () => {
    const spoken =
      "你以为凭这点修为就能挡住镇妖印吗？今日我便让你看清奥义境与半步奥义之间不可逾越的差距！龙爷纵使肉身不在，也绝不会被你这雕虫小技镇压。";
    const result = normalizeStoryboardDialogueTiming({
      panels: [panel(spoken, 15)],
    });

    expect(result.panels.length).toBeGreaterThan(1);
    expect(result.panels.map((item) => item.lipSyncText).join("")).toBe(spoken);
    expect(result.panels.map((item) => item.panelIndex)).toEqual(
      result.panels.map((_, index) => index),
    );
    for (const item of result.panels) {
      expect(item.durationSeconds).toBe(
        estimateSpeechDurationSeconds(item.lipSyncText!),
      );
      expect(item.durationSeconds).toBeLessThanOrEqual(15);
      expect(item.motionTimeline[0].startSecond).toBe(0);
      expect(item.motionTimeline.at(-1)?.endSecond).toBe(item.durationSeconds);
    }
  });

  it("hard-splits an unpunctuated line without changing any character", () => {
    const spoken = "天".repeat(140);
    const chunks = splitSpokenTextForShots(spoken);

    expect(chunks.join("")).toBe(spoken);
    expect(chunks.every((chunk) => estimateSpeechDurationSeconds(chunk) <= 15)).toBe(
      true,
    );
  });
});

function panel(spoken: string, durationSeconds: number) {
  return {
    panelIndex: 4,
    sceneNumber: 0,
    shotType: "近景",
    cameraMove: "缓慢推近",
    durationSeconds,
    motionTimeline: [
      {
        startSecond: 0,
        endSecond: durationSeconds,
        action: "角色持续说话",
        camera: "缓慢推近",
      },
    ],
    startState: {
      body: "角色站立",
      hands: "双手垂下",
      gaze: "看向对手",
      screenDirection: "面向画面右侧",
      props: "无",
    },
    endState: {
      body: "角色站立",
      hands: "双手垂下",
      gaze: "看向对手",
      screenDirection: "面向画面右侧",
      props: "无",
    },
    vfxCues: [],
    sfxCues: [],
    speakingCharacter: "甲",
    lipSyncText: spoken,
    voiceoverText: null,
    description: "甲向对手说话",
    locationName: "演武场",
    characters: ["甲"],
    props: [],
    imagePrompt: "甲站在演武场",
    videoPrompt: `甲说：${spoken}`,
    sourceEvidence: [spoken],
  };
}
