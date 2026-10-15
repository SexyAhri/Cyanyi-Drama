import { describe, expect, it, vi } from "vitest";
import { generateStoryPackageAssets, generateStoryPackageFirstEpisode, type StoryPhaseRunner } from "./story-package-phases";
import { makePackage, phaseResponses } from "./story-package-test-fixture";
import { validateFirstEpisode } from "./story-package-generation";

function phaseRunner(responses: unknown[]) {
  const calls = vi.fn();
  const request: StoryPhaseRunner = async phase => {
    calls(phase);
    const raw = structuredClone(responses.shift());
    const data = phase.schema.parse(phase.normalizeRaw ? phase.normalizeRaw(raw) : raw);
    const issues = phase.validate?.(data) ?? [];
    if (issues.length) throw new Error(issues.map(issue => issue.code).join(","));
    return data;
  };
  return { calls, request };
}

function registry(props: unknown[]) {
  const story = makePackage();
  return {
    characters: story.characters.map(({ name, storyFunction }) => ({ name, storyFunction })),
    props,
    locations: story.locations.map(({ name, storyFunction }) => ({ name, storyFunction })),
  };
}

describe("prop policy in generation phases", () => {
  it("keeps ordinary props in the story context and requests dossiers only for independent props", async () => {
    const story = makePackage();
    const inlineProp = { name: "工具袋", storyFunction: "收起日常工具" };
    const { calls, request } = phaseRunner([
      registry([
        { name: story.props[0].name, storyFunction: story.props[0].storyFunction, management: "independent", reason: "跨集反复出现，铜纹是身份线索" },
        { ...inlineProp, management: "inline", reason: "普通工具袋，无独立外观身份要求" },
      ]),
      { characters: story.characters }, { props: story.props }, { locations: story.locations },
    ]);
    const assets = await generateStoryPackageAssets({ request, locale: "zh", context: {}, task: "Design", constraints: { propPolicy: "minimal" } });
    expect(assets.props.map(prop => prop.name)).toEqual(["旧零件"]);
    expect(assets.inlineProps).toEqual([inlineProp]);
    expect(calls).toHaveBeenCalledTimes(4);
    const dossierEntities = calls.mock.calls.slice(1).flatMap(([phase]) => phase.context.currentEntities.map((entity: { name: string }) => entity.name));
    expect(dossierEntities).toEqual(["阿青", "旧零件", "修理铺"]);
    expect(calls.mock.calls[0][0].task).toContain("management（independent 或 inline）及 reason");
  });

  it("requires a management choice and reason before requesting any minimal-policy dossiers", async () => {
    const { calls, request } = phaseRunner([registry([{ name: "工具袋", storyFunction: "收起工具" }])]);
    await expect(generateStoryPackageAssets({ request, locale: "zh", context: {}, task: "Design", constraints: { propPolicy: "minimal" } })).rejects.toThrow();
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("does not request any independent prop dossiers under an inline policy", async () => {
    const story = makePackage();
    const { calls, request } = phaseRunner([registry([]), { characters: story.characters }, { locations: story.locations }]);
    const assets = await generateStoryPackageAssets({ request, locale: "zh", context: {}, task: "Design", constraints: { propPolicy: "inline" } });
    expect(assets.props).toEqual([]);
    expect(calls).toHaveBeenCalledTimes(3);
    expect(calls.mock.calls[0][0].task).toContain("Return props: []");
    const invalid = phaseRunner([registry([{ name: "工具袋", storyFunction: "收起工具" }])]);
    await expect(generateStoryPackageAssets({ request: invalid.request, locale: "zh", context: {}, task: "Design", constraints: { propPolicy: "inline" } })).rejects.toThrow();
    expect(invalid.calls).toHaveBeenCalledTimes(1);
  });

  it("allows ordinary objects in dramatic action without adding prop reference slots", async () => {
    const story = makePackage();
    story.props = [];
    story.firstEpisode.targetDurationSeconds = 15;
    story.firstEpisode.scenes = story.firstEpisode.scenes.slice(0, 1).map(scene => ({
      ...scene, props: [], action: "阿青把桌上的普通工具装入工具袋。",
      videoPrompt: scene.videoPrompt.replace(/图片\s*\d+（[^）]+）[。，]?/g, ""),
    }));
    const { calls, request } = phaseRunner(phaseResponses(story).slice(-2));
    const episode = await generateStoryPackageFirstEpisode({
      request, locale: "zh", context: {}, assets: story, targetSeconds: 15,
      constraints: { propPolicy: "inline", sceneCount: 1, targetDurationSeconds: 15 }, designTask: "Design",
      validate: value => validateFirstEpisode(value, "zh", story),
    });
    expect(episode.scenes[0].action).toContain("普通工具装入工具袋");
    expect(episode.scenes[0].props).toEqual([]);
    expect(episode.scenes[0].imageReferenceSlots.map(slot => slot.kind)).toEqual(["character", "location"]);
    expect(calls.mock.calls[0][0].task).toContain("只有已单独建档的关键道具才列入 props");
  });
});
