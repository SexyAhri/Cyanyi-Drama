import { describe, expect, it } from "vitest";
import type { DirectorScene, DirectorShot } from "./storyboard-scene-contract";
import { allocateStoryboardDuration, validateStoryboardDuration } from "./storyboard-duration-budget";

const scene = (id: string, text = ""): DirectorScene => ({
  id, clipId: id, sceneNumber: 0, heading: { intExt: "EXT", location: "庭院", time: "日" },
  description: "站立", characters: ["甲"], props: [],
  units: [{ id: `${id}:0`, contentIndex: 0, type: text ? "dialogue" : "action", text: text || "站立",
    speaker: text ? "甲" : null, parenthetical: null, actionDesign: null }],
});

describe("storyboard episode duration budget", () => {
  it("allocates exactly the target including rounding and silent scenes", () => {
    const budget = allocateStoryboardDuration([scene("a", "你好"), scene("b"), scene("c", "再见")], 120)!;
    expect(budget.scenes.reduce((sum, item) => sum + item.maximumSeconds, 0)).toBe(120);
    expect(budget.scenes.every(item => item.maximumSeconds >= item.minimumSpeechSeconds)).toBe(true);
  });
  it("rejects an impossible speech budget before making model requests", () => {
    expect(() => allocateStoryboardDuration([scene("a", "天".repeat(100))], 5)).toThrow("不能通过加速或删除原文对白");
  });
  it("keeps source text intact and reserves split long speech", () => {
    const source = scene("a", "天".repeat(100));
    const before = JSON.stringify(source);
    const budget = allocateStoryboardDuration([source], 60)!;
    expect(budget.minimumSeconds).toBeGreaterThan(15);
    expect(JSON.stringify(source)).toBe(before);
  });
  it("rejects excessive scene duration without imposing a shot count", () => {
    const shots = [10, 11].map(duration_seconds => ({ duration_seconds }) as DirectorShot);
    expect(validateStoryboardDuration(shots, 20)).toHaveLength(1);
    expect(validateStoryboardDuration(shots, 21)).toEqual([]);
  });
  it("preserves compatibility when no target is available", () => {
    expect(allocateStoryboardDuration([scene("a")])).toBeNull();
    expect(validateStoryboardDuration([{ duration_seconds: 15 } as DirectorShot])).toEqual([]);
  });
});
