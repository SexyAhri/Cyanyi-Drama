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
import { canonicalSceneDialogue, validateStoryProductionConstraints, type StoryProductionConstraints } from "./story-quality-contract";

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
type Assets = Pick<StoryPackage, "characters" | "props" | "locations" | "inlineProps">;

/** Separate the small cast registry from expensive reference-image dossiers. */
export async function generateStoryPackageAssets(input: {
  request: StoryPhaseRunner;
  locale: "zh" | "en";
  context: unknown;
  task: string;
  constraints?: StoryProductionConstraints;
}) {
  const en = input.locale === "en";
  const constraints = input.constraints ?? {};
  const registrySchema = constraints.propPolicy === "minimal"
    ? manifestSchema.extend({ props: z.array(namedEntity.extend({ management: z.enum(["independent", "inline"]), reason: z.string().trim().min(1) })) })
    : constraints.propPolicy === "inline" ? manifestSchema.extend({ props: z.array(namedEntity).length(0) }) : manifestSchema;
  const manifest = await input.request({
    title: en ? "Story asset registry" : "故事资产名册",
    status: en
      ? "Listing recurring and episode-one assets…"
      : "正在整理主要角色、场景、道具名册…",
    context: input.context,
    schema: registrySchema,
    task: (en
      ? "Return characters, props and locations as a compact registry with only name and storyFunction. Cover recurring story-critical assets and every asset needed in episode one. Reuse locations and avoid listing background extras and disposable objects. Keep established names exact. No image prompts, visual profiles or scripts in this phase."
      : "只返回 characters、props、locations 三类精简名册，每项填写 name 和 storyFunction。覆盖全剧反复使用的关键资产和第一集必需资产；合并可复用场景，不为背景路人和一次性杂物建档，名称沿用大纲。每项功能说明用一句话。此阶段不要写 imagePrompt、visualProfile、正文或逐集大纲。")
      + `\nFrozen user constraints: ${JSON.stringify(constraints)}\n`
      + (constraints.propPolicy === "minimal" ? (en
        ? "For every prop include management (independent or inline) and reason. Only recurring plot-critical objects needing stable identity use independent; ordinary tools, bags and furniture stay inline in scene descriptions, without a dossier or generation task."
        : "每件道具增加 management（independent 或 inline）及 reason。只有反复出现且须保持外观身份的关键叙事物件才独立建档；普通工具、袋子、家具用 inline 留在场景描述，不建立独立美术/生成任务。") : constraints.propPolicy === "inline" ? "All ordinary props stay in scene action/location descriptions. Return props: []." : ""),
    validate: (value) => {
      const names = [
        ...value.characters,
        ...value.props,
        ...value.locations,
      ].map((item) => item.name);
      return new Set(names).size === names.length
        ? validateStoryProductionConstraints(value, constraints)
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
  const inlineProps = manifest.props.filter(entity => "management" in entity && entity.management === "inline");
  const independent = { ...manifest, props: manifest.props.filter(entity => !("management" in entity) || entity.management !== "inline") };
  const assets: Assets = { characters: [], props: [], locations: [], ...(inlineProps.length ? { inlineProps: inlineProps.map(({ name, storyFunction }) => ({ name, storyFunction })) } : {}) };
  for (const kind of ["characters", "props", "locations"] as const) {
    for (let start = 0; start < independent[kind].length; start += 2) {
      const entities = independent[kind].slice(start, start + 2);
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

/** Freeze dramatic scenes first; shot duration and shot count are a later directing choice. */
export async function generateStoryPackageFirstEpisode(input: {
  request: StoryPhaseRunner;
  locale: "zh" | "en";
  context: unknown;
  assets: Assets;
  targetSeconds: number;
  designTask: string;
  constraints?: StoryProductionConstraints;
  validate: (
    episode: StoryPackage["firstEpisode"],
  ) => StructuredValidationIssue[];
}) {
  const en = input.locale === "en";
  const count = input.constraints?.sceneCount;
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
        scenes: count ? z.array(assetBoundSceneSchema).length(count) : z.array(assetBoundSceneSchema).min(1).max(100),
      }),
    }),
    normalizeRaw: (value) => normalizeDraftNames(value, { characters, props, locations }),
    task: (en
      ? `Write only firstEpisode: title, synopsis, endingHook, targetDurationSeconds=${input.targetSeconds}, ${count ? `exactly ${count} dramatic scenes` : "a story-appropriate number of dramatic scenes"}, with durations totaling the target. A scene is a continuous dramatic unit, not a fixed 15-second shot. Later directing may split a scene into several shots. Use only the supplied named assets. Deliver a concrete opening, causal action, speaker-specific dialogue and a local payoff following episode one's outline. Include continuity.startState/endState (body, hands, gaze, screenDirection, props) and transitions (subject, before, action, after). Verify physical causality: packing fills a bag and clears a table. Do not write image/video prompts or productionDesign yet.`
      : `只写 firstEpisode：title、synopsis、endingHook、targetDurationSeconds=${input.targetSeconds}，以及${count ? `恰好 ${count} 个连续戏剧场次` : "按剧情需要划分的连续场次"}，各场时长相加接近目标时长。场次不是固定15秒的镜头；后续导演可在一场内拆多个镜头，不能靠改标签伪造场次。只使用提供的资产名称，从1连续编号。写出具体开场、因果行动、有辨识度的对白与小事兑现。每场 continuity 写清 startState/endState（body、hands、gaze、screenDirection、props）及 transitions（subject、before、action、after）；核对物理因果，例如装袋时袋内增加而桌上减少。对白量能在本场时间内演完。本次不要写图片/视频提示词、imageReferenceSlots 或 productionDesign。`)
      + (en ? "\nExact asset-name whitelist: " : "\n出场资产名称白名单（字段只允许选取，不能自创或缩写）：")
      + JSON.stringify({ characters, props, locations })
      + (en ? "\nOrdinary clothing, furniture and background objects are part of the character/location unless registered as a separate prop; do not list them as unregistered props." : "\n普通衣物、家具和背景杂物属于人物外观/场景陈设，只有已单独建档的关键道具才列入 props；不能把未建档物品加入资产字段。"),
    validate: (value) =>
      [...validateStoryProductionConstraints({ ...input.assets, firstEpisode: value.firstEpisode }, input.constraints ?? {}), ...value.firstEpisode.scenes.flatMap(
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
      )],
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
      status: `${en ? "Designing scene" : "正在设计第"} ${scene.sceneNumber}/${draft.firstEpisode.scenes.length}…`,
      context: {
        scene,
        dialogueLedger: canonicalSceneDialogue(scene),
        keyframeMoment: "start",
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
      task: `${input.designTask}\n${en ? "Use the frozen dialogueLedger in exact order with explicit speakers. The image depicts only continuity.startState, a single starting moment; endState and transitions belong to motion/video, never the starting image." : "dialogueLedger 是唯一台词合同，逐字、按顺序、注明说话人写入视频正文。图片只描写 continuity.startState 的单一开始瞬间；endState 和 transitions 只用于动作及视频，不得提前出现在首帧。"}`,
      validate: (value) =>
        [...input.validate({
          ...draft.firstEpisode,
          scenes: [{ ...scene, ...value, imageReferenceSlots }],
        }), ...validateSceneReferenceAnnotations(value.videoPrompt, imageReferenceSlots),
        ...Object.entries(scene.continuity.startState).flatMap(([key, fact]) => value.productionDesign.startState[key as keyof typeof value.productionDesign.startState] === fact ? [] : [{
          code: "frozen_start_state_changed", path: `productionDesign.startState.${key}`, message: `Preserve the approved starting fact exactly: ${fact}. The image and motion must start here.`,
        }])],
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
