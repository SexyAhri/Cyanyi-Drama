import { describe, expect, it } from "vitest";

import {
  sanitizeMediaPrompt,
  sanitizeMediaProviderRequest,
} from "./provider-prompt-safety";

describe("media provider prompt safety", () => {
  it("rewrites combined blood and incapacitation phrases for provider output", () => {
    const result = sanitizeMediaPrompt(
      "海丹麟嘴角喷血，眼皮翻转失去知觉坠落地面，身体无力，呼吸微弱",
    );

    expect(result.prompt).toContain("嘴角留有少量红色水迹");
    expect(result.prompt).toContain("神情恍惚");
    expect(result.prompt).toContain("动作迟缓");
    expect(result.prompt).toContain(
      "非写实奇幻表现，无可见伤口、无液体喷溅、无痛苦特写。",
    );
    expect(result.prompt).not.toMatch(/喷血|失去知觉|呼吸微弱/u);
    expect(result.changes.map((change) => change.category)).toEqual([
      "visible_blood",
      "severe_incapacitation",
      "severe_incapacitation",
    ]);
  });

  it("classifies anatomical and graphic violence separately", () => {
    const result = sanitizeMediaPrompt(
      "护甲崩裂，骨骼经脉寸断，随后爆头并倒在血泊中",
    );

    expect(result.prompt).toContain("身体受到强烈冲击");
    expect(result.prompt).toContain("头部受到强烈冲击");
    expect(result.prompt).toContain("大片红色水迹");
    expect(new Set(result.changes.map((change) => change.category))).toEqual(
      new Set(["anatomical_injury", "graphic_violence", "visible_blood"]),
    );
  });

  it("changes only outbound image and video prompt copies", () => {
    const source = { prompt: "角色嘴角喷血", ratio: "16:9" };
    const image = sanitizeMediaProviderRequest(source, "image");
    const audio = sanitizeMediaProviderRequest(source, "audio");

    expect(source.prompt).toBe("角色嘴角喷血");
    expect(image.request.prompt).toContain("红色水迹");
    expect(audio.request).toBe(source);
    expect(audio.changes).toEqual([]);
  });

  it("leaves ordinary color and action language unchanged", () => {
    const prompt = "血色夕阳下，角色挥剑后退，红色披风飘动";
    expect(sanitizeMediaPrompt(prompt)).toEqual({ prompt, changes: [] });
  });
});
