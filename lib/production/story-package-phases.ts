import { z } from "zod";
import type { StructuredValidationIssue } from "@/lib/llm/structured-output";
import {
  StoryPackageAssetsGenerationSchema,
  StoryPackageFirstEpisodeGenerationSchema,
  StoryPackageSchema,
  type StoryPackage,
} from "./story-package-contract";
import { renderStoryPackageAssets } from "./story-package-document";
import { buildSceneReferenceSlots, canonicalStoryAssetName, compileSceneDesignReferences, validateSceneReferenceAnnotations } from "./story-scene-references";

export type StoryPhase<T> = {
  title: string;
  status: string;
  task: string;
  schema: z.ZodType<T>;
  validate?: (value: T) => StructuredValidationIssue[];
  normalizeRaw?: (value: unknown) => unknown;
  context?: unknown;
  preview: (value: T) => string;
};
export type StoryPhaseRunner = <T>(phase: StoryPhase<T>) => Promise<T>;

const namedEntity = z.object({
  name: z.string().trim().min(1),
  storyFunction: z.string().trim().min(1),
});
const manifestSchema = z.object({
  characters: z.array(namedEntity).min(1),
  props: z.array(namedEntity),
  locations: z.array(namedEntity).min(1),
});
type Assets = Pick<StoryPackage, "characters" | "props" | "locations">;

/** Separate the small cast registry from expensive reference-image dossiers. */
export async function generateStoryPackageAssets(input: {
  request: StoryPhaseRunner;
  locale: "zh" | "en";
  context: unknown;
  task: string;
}) {
  const en = input.locale === "en";
  const manifest = await input.request({
    title: en ? "Story asset registry" : "故事资产名册",
    status: en
      ? "Listing recurring and episode-one assets…"
      : "正在整理主要角色、场景、道具名册…",
    context: input.context,
    schema: manifestSchema,
    task: en
      ? "Return characters, props and locations as a compact registry with only name and storyFunction. Cover recurring story-critical assets and every asset needed in episode one. Reuse locations and avoid listing background extras and disposable objects. Keep established names exact. No image prompts, visual profiles or scripts in this phase."
      : "只返回 characters、props、locations 三类精简名册，每项只有 name 和 storyFunction。覆盖全剧反复使用的关键资产和第一集必需资产；合并可复用场景，不为背景路人和一次性杂物建档，名称沿用大纲。每项功能说明用一句话。此阶段不要写 imagePrompt、visualProfile、正文或逐集大纲。",
    validate: (value) => {
      const names = [
        ...value.characters,
        ...value.props,
        ...value.locations,
      ].map((item) => item.name);
      return new Set(names).size === names.length
        ? []
        : [
            {
              code: "asset_name_duplicate",
              path: "root",
              message: "Asset names must be unique across the registry.",
            },
          ];
    },
    preview: (value) =>
      Object.entries(value)
        .map(
          ([kind, entities]) =>
            `${kind}: ${entities.map((entity) => entity.name).join("、")}`,
        )
        .join("\n"),
  });
  const assets: Assets = { characters: [], props: [], locations: [] };
  for (const kind of ["characters", "props", "locations"] as const) {
    for (let start = 0; start < manifest[kind].length; start += 2) {
      const entities = manifest[kind].slice(start, start + 2);
      const names = entities.map((entity) => entity.name);
      const phase = {
        title: `${en ? "Asset dossiers" : "资产档案"} · ${names.join("、")}`,
        status: `${en ? "Designing" : "正在设计"} ${names.join("、")}…`,
        context: {
          story: input.context,
          registry: manifest,
          currentEntities: entities,
        },
        task: `${input.task}\n\n${en ? "THIS REQUEST ONLY" : "本次仅生成"}: ${kind} = ${JSON.stringify(names)}. ${en ? "Return only this field and these exact entities, in this order. No other asset groups or episodes." : "只输出这一类字段及以上指定对象，顺序和名称一致；不得输出其他类型或其他对象。不要重复全剧梗概。"}`,
        preview: (value: Partial<Assets>) =>
          renderStoryPackageAssets(
            { ...{ characters: [], props: [], locations: [] }, ...value },
            input.locale,
          ),
      };
      // Preserve the concrete discriminated array schemas at the provider boundary.
      if (kind === "characters") {
        const value = await input.request({
          ...phase,
          schema: z.object({
            characters:
              StoryPackageAssetsGenerationSchema.shape.characters.length(
                entities.length,
              ),
          }),
          validate: (value) => validateNames(value.characters, names),
        });
        assets.characters.push(...value.characters);
      } else if (kind === "props") {
        const value = await input.request({
          ...phase,
          schema: z.object({
            props: StoryPackageAssetsGenerationSchema.shape.props.length(
              entities.length,
            ),
          }),
          validate: (value) => validateNames(value.props, names),
        });
        assets.props.push(...value.props);
      } else {
        const value = await input.request({
          ...phase,
          schema: z.object({
            locations:
              StoryPackageAssetsGenerationSchema.shape.locations.length(
                entities.length,
              ),
          }),
          validate: (value) => validateNames(value.locations, names),
        });
        assets.locations.push(...value.locations);
      }
    }
  }
  return assets;
}

function validateNames(
  entities: Array<{ name: string }>,
  names: string[],
): StructuredValidationIssue[] {
  return entities.every((entity, index) => entity.name === names[index])
    ? []
    : [
        {
          path: "root",
          code: "asset_registry_mismatch",
          message: `Return exactly these names in order: ${names.join(", ")}`,
        },
      ];
}

const sceneSchema =
  StoryPackageFirstEpisodeGenerationSchema.shape.firstEpisode.shape.scenes
    .element;
const draftSceneSchema = sceneSchema.omit({
  imageReferenceSlots: true,
  imagePrompt: true,
  videoPrompt: true,
  productionDesign: true,
});
const sceneDesignSchema = sceneSchema.pick({
  imagePrompt: true,
  videoPrompt: true,
  productionDesign: true,
});

/** Freeze dramatic action/dialogue first, then design one 15-second scene per request. */
export async function generateStoryPackageFirstEpisode(input: {
  request: StoryPhaseRunner;
  locale: "zh" | "en";
  context: unknown;
  assets: Assets;
  targetSeconds: number;
  designTask: string;
  validate: (
    episode: StoryPackage["firstEpisode"],
  ) => StructuredValidationIssue[];
}) {
  const en = input.locale === "en";
  const count = Math.max(4, Math.round(input.targetSeconds / 15));
  const characters = input.assets.characters.map(asset => asset.name);
  const props = input.assets.props.map(asset => asset.name);
  const locations = input.assets.locations.map(asset => asset.name);
  const assetBoundSceneSchema = draftSceneSchema.extend({
    characters: z.array(z.enum(characters)),
    props: props.length ? z.array(z.enum(props)) : z.array(z.string()).length(0),
    location: z.enum(locations),
    dialogue: z.array(sceneSchema.shape.dialogue.element.extend({ speaker: z.enum(characters) })),
  });
  const draft = await input.request({
    title: en ? "Episode one dramatic draft" : "第一集故事正文",
    status: en
      ? "Writing actions, dialogue and emotional payoffs…"
      : "正在写第一集的行动、对白与情绪兑现…",
    context: input.context,
    schema: z.object({
      firstEpisode: StoryPackageSchema.shape.firstEpisode.extend({
        targetDurationSeconds: z.literal(input.targetSeconds),
        scenes: z.array(assetBoundSceneSchema).length(count),
      }),
    }),
    normalizeRaw: (value) => normalizeDraftNames(value, { characters, props, locations }),
    task: (en
      ? `Write only firstEpisode: title, synopsis, endingHook, targetDurationSeconds=${input.targetSeconds} and exactly ${count} scenes of 15 seconds each. Use only the supplied named assets. Deliver a concrete opening, causal action, speaker-specific dialogue, a local payoff and a consequence-driven hook, following episode one's outline. Keep dialogue performable in each scene's time. Do not write image/video prompts, reference slots or productionDesign yet.`
      : `只写 firstEpisode：title、synopsis、endingHook、targetDurationSeconds=${input.targetSeconds}，以及恰好 ${count} 场各15秒的完整正文。只使用提供的资产名称，场次从1连续编号。依第一集大纲写出具体开场、因果行动、有辨识度的对白、小事兑现与由后果引出的钩子。对白量能在本场时间内演完；不得把第二集情节提前用掉。本次不要写图片/视频提示词、imageReferenceSlots 或 productionDesign。`)
      + (en ? "\nExact asset-name whitelist: " : "\n出场资产名称白名单（字段只允许选取，不能自创或缩写）：")
      + JSON.stringify({ characters, props, locations })
      + (en ? "\nOrdinary clothing, furniture and background objects are part of the character/location unless registered as a separate prop; do not list them as unregistered props." : "\n普通衣物、家具和背景杂物属于人物外观/场景陈设，只有已单独建档的关键道具才列入 props；不能把未建档物品加入资产字段。"),
    validate: (value) =>
      value.firstEpisode.scenes.flatMap(
        (scene, index): StructuredValidationIssue[] => {
          const issues: StructuredValidationIssue[] = [];
          if (scene.sceneNumber !== index + 1) issues.push({ code: "draft_scene_number_invalid",
            path: `firstEpisode.scenes.${index}.sceneNumber`, message: `Use scene number ${index + 1}.` });
          for (const [lineIndex, line] of scene.dialogue.entries()) if (!scene.characters.includes(line.speaker)) issues.push({
            code: "draft_speaker_not_present", path: `firstEpisode.scenes.${index}.dialogue.${lineIndex}.speaker`,
            message: `${line.speaker} must be present in this scene's characters.`,
          });
          return issues;
        },
      ),
    preview: (value) =>
      value.firstEpisode.scenes
        .map(
          (scene) =>
            `${scene.heading}\n${scene.action}\n${scene.dialogue.map((line) => `${line.speaker}：${line.line}`).join("\n")}`,
        )
        .join("\n\n"),
  });
  const scenes: StoryPackage["firstEpisode"]["scenes"] = [];
  for (const scene of draft.firstEpisode.scenes) {
    const imageReferenceSlots = buildSceneReferenceSlots(scene);
    const design = await input.request({
      title: `${en ? "Scene design" : "场次视听设计"} ${scene.sceneNumber}`,
      status: `${en ? "Designing scene" : "正在设计第"} ${scene.sceneNumber}/${count}…`,
      context: {
        scene,
        imageReferenceSlots,
        previousEndState: scenes.at(-1)?.endState ?? null,
        characters: input.assets.characters.filter((asset) =>
          scene.characters.includes(asset.name),
        ),
        props: input.assets.props.filter((asset) =>
          scene.props.includes(asset.name),
        ),
        locations: input.assets.locations.filter(
          (asset) => asset.name === scene.location,
        ),
        story: input.context,
      },
      schema: sceneDesignSchema,
      normalizeRaw: (value) => compileSceneDesignReferences(value, imageReferenceSlots, input.locale),
      task: input.designTask,
      validate: (value) =>
        [...input.validate({
          ...draft.firstEpisode,
          scenes: [{ ...scene, ...value, imageReferenceSlots }],
        }), ...validateSceneReferenceAnnotations(value.videoPrompt, imageReferenceSlots)],
      preview: (value) => value.videoPrompt,
    });
    scenes.push({ ...scene, ...design, imageReferenceSlots });
  }
  return { ...draft.firstEpisode, scenes };
}

function normalizeDraftNames(value: unknown, names: { characters: string[]; props: string[]; locations: string[] }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  if (!raw.firstEpisode || typeof raw.firstEpisode !== "object" || Array.isArray(raw.firstEpisode)) return value;
  const episode = raw.firstEpisode as Record<string, unknown>;
  if (!Array.isArray(episode.scenes)) return value;
  const canonical = (value: unknown, list: string[]) => typeof value === "string" ? canonicalStoryAssetName(value, list) : value;
  return { ...raw, firstEpisode: { ...episode, scenes: episode.scenes.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const scene = value as Record<string, unknown>;
    return { ...scene,
      characters: Array.isArray(scene.characters) ? scene.characters.map(name => canonical(name, names.characters)) : scene.characters,
      props: Array.isArray(scene.props) ? scene.props.map(name => canonical(name, names.props)) : scene.props,
      location: canonical(scene.location, names.locations),
      dialogue: Array.isArray(scene.dialogue) ? scene.dialogue.map(value => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return value;
        const line = value as Record<string, unknown>;
        return { ...line, speaker: canonical(line.speaker, names.characters) };
      }) : scene.dialogue,
    };
  }) } };
}
