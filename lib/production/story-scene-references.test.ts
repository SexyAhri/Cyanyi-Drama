import { describe, expect, it } from "vitest";
import { buildSceneReferenceSlots, canonicalStoryAssetName, compileSceneDesignReferences, validateSceneReferenceAnnotations } from "./story-scene-references";

const slots = buildSceneReferenceSlots({ characters: ["陆野"], props: ["旧棉袄", "旧木桌", "登记本与铅笔", "布包"], location: "亲戚家屋与门前" });
const body = "15 秒，年代写实，9:16。0-3 秒：陆野拢紧旧棉袄，站在旧木桌前。3-6 秒：把登记本与铅笔推到桌子中央，铅笔停在桌沿。6-9 秒：他将布包搭在肩上，抬眼看向门口。9-12 秒：镜头向门前平移，雪花落在鞋面，他回头看了一眼。12-15 秒：脚迈过门槛，布包贴住后背，屋里的人没有追来。";

describe("server-owned story scene references", () => {
  it("derives every reported missing prop and location without model-authored slots", () => {
    expect(slots).toEqual([
      { number: 1, kind: "character", name: "陆野" },
      ...["旧棉袄", "旧木桌", "登记本与铅笔", "布包"].map((name, index) => ({ number: index + 2, kind: "prop", name })),
      { number: 6, kind: "location", name: "亲戚家屋与门前" },
    ]);
    const value = compileSceneDesignReferences({ videoPrompt: body }, slots, "zh") as { videoPrompt: string };
    for (const slot of slots) expect(value.videoPrompt).toContain(`图片 ${slot.number}（`);
    expect(value.videoPrompt.endsWith(body)).toBe(true);
    expect(validateSceneReferenceAnnotations(value.videoPrompt, slots)).toEqual([]);
    expect(compileSceneDesignReferences(value, slots, "zh")).toEqual(value);
  });

  it("deduplicates by kind and name, handles empty props and does not mutate the scene", () => {
    const scene = { characters: ["小院", "小院"], props: [], location: "小院" };
    expect(buildSceneReferenceSlots(scene)).toEqual([
      { number: 1, kind: "character", name: "小院" }, { number: 2, kind: "location", name: "小院" },
    ]);
    expect(scene.characters).toHaveLength(2);
  });

  it("renumbers only unambiguously named known references in either locale", () => {
    for (const locale of ["zh", "en"] as const) {
      const value = compileSceneDesignReferences({ videoPrompt: `图片 77（道具参考：旧棉袄）；Image 88 (character reference: 陆野)。${body}` }, slots, locale) as { videoPrompt: string };
      expect(value.videoPrompt).not.toMatch(/77|88/);
      expect(validateSceneReferenceAnnotations(value.videoPrompt, slots)).toEqual([]);
      expect(compileSceneDesignReferences(value, slots, locale)).toEqual(value);
    }
  });

  it.each([
    ["图片 2（角色参考：旧棉袄）", "video_reference_annotation_mismatch"],
    ["图片 2（道具参考：陌生棉袄）", "video_reference_annotation_mismatch"],
    ["Image 2 (prop: unknown coat)", "video_reference_annotation_mismatch"],
    ["图片 99", "video_reference_number_unknown"],
    ["Image 99", "video_reference_number_unknown"],
  ])("does not hide invalid body annotation %s behind a valid header", (annotation, code) => {
    const value = compileSceneDesignReferences({ videoPrompt: `${annotation}。${body}` }, slots, "zh") as { videoPrompt: string };
    expect(validateSceneReferenceAnnotations(value.videoPrompt, slots).map(issue => issue.code)).toContain(code);
  });

  it("does not pad missing or too-short prompts into passing the schema", () => {
    for (const value of [null, [], "text", {}, { videoPrompt: 15 }, { videoPrompt: "0-3 秒：站着。" }]) {
      expect(compileSceneDesignReferences(value, slots, "zh")).toEqual(value);
    }
  });

  it("normalizes only unique exact spelling variants, never fuzzy aliases or ambiguous names", () => {
    expect(canonicalStoryAssetName(" ‘旧 棉袄’ ", ["旧棉袄"])).toBe("旧棉袄");
    expect(canonicalStoryAssetName("ＡＢＣ", ["ABC"])).toBe("ABC");
    expect(canonicalStoryAssetName("棉衣", ["旧棉袄"])).toBe("棉衣");
    expect(canonicalStoryAssetName("a b", ["ab", "AB"])).toBe("a b");
    expect(canonicalStoryAssetName("AB", ["ab", "AB"])).toBe("AB");
  });
});
