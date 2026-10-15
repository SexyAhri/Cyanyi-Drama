import { normalizeOriginalEpisodeOutput } from "./original-episode-contract";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { resolveEpisodeTextProvider } from "@/lib/episodes/provider";
import { currentProductionConfiguration } from "@/lib/production-configuration/context";
import { workflowCacheFingerprint } from "@/lib/workflow/cache-fingerprint";
import { recordWorkflowArtifactReuse } from "@/lib/workflow/request-events";
import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import { PROMPT_IDS, renderPrompt } from "@/lib/prompts";
import {
  sourceFingerprint,
  type SourceTaskHooks,
} from "@/lib/episodes/long-source";
import { serializeBudgetedContext } from "@/lib/studio/context-budget";
import {
  AssetVisualProfileSpecSchema,
  parseAssetVisualProfile,
  isAssetVisualProfileComplete as isCompleteVisualProfile,
} from "@/lib/assets/visual-profile";
import {
  StoryPackageSchema,
  StoryPackageFirstEpisodeGenerationSchema,
  type StoryPackage,
} from "./story-package-contract";
import { PANEL_PRODUCTION_DESIGN_INSTRUCTIONS } from "./panel-production-design";
import { validateFirstEpisode } from "./story-package-generation";
import { resolveStoryProductionConstraints, validateStoryProductionConstraints, type StoryProductionConstraints } from "./story-quality-contract";
import {
  renderPackageScene,
  seedPackageProduction,
} from "./story-package-production";

const EpisodeSchema = z.object({
  episode: StoryPackageFirstEpisodeGenerationSchema.shape.firstEpisode,
});

const AssetVisualProfileSchema = z.object({
  kind: z.enum(["character", "location", "prop"]),
  name: z.string().trim().min(1),
  spec: AssetVisualProfileSpecSchema,
});

const AssetVisualProfilesSchema = z.object({
  assetVisualProfiles: z.array(AssetVisualProfileSchema),
});

export async function generateOriginalEpisode(
  input: {
    userId: string;
    projectId: string;
    episodeId: string;
    channelId: string;
    model: string;
    locale: "zh" | "en";
    workflowId: string;
    instructions?: string;
  },
  hooks: SourceTaskHooks,
) {
  const episode = await prisma.episode.findFirst({
    where: {
      id: input.episodeId,
      projectId: input.projectId,
      project: { userId: input.userId },
    },
    include: { project: { include: { config: true } } },
  });
  if (!episode || episode.episodeNumber < 2)
    throw new Error("请选择原创策划中的后续剧集");
  const rows = await prisma.productionDeliverable.findMany({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      deliverableType: "story_bible",
      status: { in: ["approved", "locked"] },
      supersededAt: null,
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });
  const parent = rows.find((row) => {
    const payload = row.payload as {
      packageFormat?: string;
      adoption?: { episodeIds?: string[] };
    } | null;
    return (
      payload?.packageFormat === "cyanyi-story-package-v1" &&
      payload.adoption?.episodeIds?.includes(episode.id)
    );
  });
  if (!parent) throw new Error("本集没有已采用的原创策划；请先采用策划包");
  const story = StoryPackageSchema.parse(
    (parent.payload as Record<string, unknown>).storyPackage,
  );
  const registryConstraints = story.productionConstraints ?? {};
  const requestedEpisodeConstraints = resolveStoryProductionConstraints(input.instructions ?? "");
  // Series asset counts describe the adopted registry, not every episode's cast or locations.
  const constraints: StoryProductionConstraints = {
    ...(registryConstraints.sceneCount !== undefined ? { sceneCount: registryConstraints.sceneCount } : {}),
    ...(registryConstraints.targetDurationSeconds !== undefined ? { targetDurationSeconds: registryConstraints.targetDurationSeconds } : {}),
    ...(registryConstraints.propPolicy !== undefined ? { propPolicy: registryConstraints.propPolicy } : {}),
    ...requestedEpisodeConstraints,
  };
  const frozenConstraints = { registry: registryConstraints, episode: constraints };
  const targetDurationSeconds = constraints.targetDurationSeconds
    ?? episode.project.config?.episodeTargetDurationSeconds
    ?? story.format.episodeDurationSeconds;
  const validateConstraints = (candidate: StoryPackage["firstEpisode"]) => [
    ...validateStoryProductionConstraints({ characters: story.characters, locations: story.locations, props: story.props }, registryConstraints),
    ...validateStoryProductionConstraints({
      characters: [...new Set(candidate.scenes.flatMap(scene => scene.characters))].map(name => ({ name })),
      locations: [...new Set(candidate.scenes.map(scene => scene.location))].map(name => ({ name })),
      props: [...new Set(candidate.scenes.flatMap(scene => scene.props))].map(name => ({ name })),
      firstEpisode: candidate,
    }, constraints),
  ];
  const outline = story.episodeOutlines.find(
    (item) => item.episodeNumber === episode.episodeNumber,
  );
  if (!outline) throw new Error("策划包缺少本集大纲");
  const previous = await prisma.episode.findUnique({
    where: {
      projectId_episodeNumber: {
        projectId: input.projectId,
        episodeNumber: episode.episodeNumber - 1,
      },
    },
    select: { id: true, name: true, novelText: true },
  });
  if (!previous?.novelText?.trim())
    throw new Error("请先完成并采用上一集正文，以便续写保持衔接");
  const previousHash = sourceFingerprint(previous.novelText);
  const key = workflowCacheFingerprint({
    source: {
      episodeId: episode.id,
      episodeNumber: episode.episodeNumber,
      previousHash,
      packageId: parent.id,
      packageVersion: parent.version,
      packageSourceHash: sourceFingerprint(story),
      outline,
      instructions: input.instructions ?? "",
      productionConstraints: frozenConstraints,
    },
    prompt: `${PROMPT_IDS.STORY_PACKAGE_GENERATION}:original-episode-format-v4`,
    promptVersion: "original-episode-v4",
    channelId: input.channelId,
    model: input.model,
    agentConfiguration: currentProductionConfiguration()?.snapshot ?? null,
    parameters: {
      locale: input.locale,
      temperature: 0.45,
      timeoutMs: 270_000,
      stream: true,
      schema: z.toJSONSchema(EpisodeSchema),
      projectSettings: {
        artStyle: episode.project.config?.artStyle,
        ratio: episode.project.config?.videoRatio,
        targetSeconds: targetDurationSeconds,
      },
    },
  });
  const frozenInput = {
    episodeId: episode.id,
    episodeNumber: episode.episodeNumber,
    packageId: parent.id,
    packageVersion: parent.version,
    packageSourceHash: sourceFingerprint(story),
    previousEpisodeId: previous.id,
    previousEpisodeHash: previousHash,
    outline,
    instructions: input.instructions ?? "",
    productionConstraints: frozenConstraints,
    targetDurationSeconds,
  };
  const completed = await hooks.loadArtifact("original.completed", key) as { sourceId?: unknown } | null;
  if (typeof completed?.sourceId === "string") {
    const savedSource = await prisma.episodeSourceVersion.findFirst({
      where: {
        id: completed.sourceId,
        episodeId: episode.id,
        kind: "adapted",
        sourceHash: { not: "" },
        content: { not: "" },
        instructions: { startsWith: `策划包 ${parent.id} v${parent.version}；原创续写 ` },
      },
      select: { id: true },
    });
    if (savedSource) {
      await recordWorkflowArtifactReuse({
        recordRequest: hooks.recordRequest,
        request: {
          requestId: randomUUID(),
          requestType: "original_episode_completion",
          targetType: "episode",
          targetId: episode.id,
          provider: input.channelId,
          model: input.model,
          inputHash: key,
          input: frozenInput,
          cacheVersion: "workflow-cache-v2",
          promptVersion: "original-episode-v4",
          promptVersionHash: sourceFingerprint(`${PROMPT_IDS.STORY_PACKAGE_GENERATION}:original-episode-format-v4`),
        },
        artifactRefs: [`original.completed:${key}`, `episode.source_version:${savedSource.id}`],
        reuseReason: "cache_fingerprint_match",
      });
      return completed;
    }
  }
  const cachedCandidate = EpisodeSchema.safeParse(
    normalizeOriginalEpisodeOutput(await hooks.loadArtifact("original.episode", key), story, input.locale),
  );
  const cached =
    cachedCandidate.success &&
    validateConstraints(cachedCandidate.data.episode).length === 0 &&
    validateFirstEpisode(cachedCandidate.data.episode, input.locale, story, targetDurationSeconds)
      .length === 0 &&
    cachedCandidate.data.episode.scenes.every(
      (scene) =>
        scene.characters.every((name) =>
          story.characters.some((item) => item.name === name),
        ) &&
        story.locations.some((item) => item.name === scene.location) &&
        scene.props.every((name) =>
          story.props.some((item) => item.name === name),
        ),
    )
      ? cachedCandidate
      : null;
  await hooks.assertActive();
  await hooks.reportProgress?.(
    `正在依据第 ${episode.episodeNumber} 集大纲续写正文与制作设计，并检查本集出场资产的视觉规范`,
  );
  const provider = await resolveEpisodeTextProvider(input);
  const result = cached
    ? { data: cached.data }
    : await requestOpenAiStructured({
        ...provider,
        schema: EpisodeSchema,
        normalizeRaw: (value) => normalizeOriginalEpisodeOutput(value, story, input.locale),
        maxCorrectionAttempts: 1,
        timeoutMs: 270_000,
        stream: true,
        temperature: 0.45,
        prompt: renderPrompt({
          id: PROMPT_IDS.STORY_PACKAGE_GENERATION,
          locale: input.locale,
          variables: {
            episode_count: "1",
            project_context: serializeBudgetedContext(
              {
                series: {
                  resolvedSetup: story.resolvedSetup,
                  title: story.title,
                  synopsis: story.synopsis,
                  worldRules: story.worldRules,
                  creativeProhibitions: story.creativeProhibitions,
                  format: story.format,
                },
                targetOutline: outline,
                previousEpisode: {
                  name: previous.name,
                  ending: previous.novelText.slice(-8000),
                },
                nextOutline: story.episodeOutlines.find(
                  (item) => item.episodeNumber === episode.episodeNumber + 1,
                ),
                characters: story.characters,
                locations: story.locations,
                props: story.props,
                inlineProps: story.inlineProps ?? [],
                productionConstraints: frozenConstraints,
                productionConstraintScope: "registry 是已采用全剧资产档案范围，episode 是本集制作约束；本集人物和地点按 scenes 实际使用的唯一名称计数，propPolicy=inline 仅要求本集 scene.props 为空，普通物件留在动作和提示词正文，不删除全剧关键物件档案。",
                project: {
                  artStyle: episode.project.config?.artStyle,
                  ratio: episode.project.config?.videoRatio,
                  targetSeconds: targetDurationSeconds,
                },
                userInstructions: input.instructions ?? "",
              },
              32_000,
            ),
            generation_task: `编写第 ${episode.episodeNumber} 集完整可拍正文，不是重新生成策划包。严格遵循本集大纲、已采用的人物和世界规则，并承接上一集实际结尾；不得重复上一集或提前消耗下一集剧情。只能使用已提供的角色、场景、道具名称。冻结的数量/资产约束：${JSON.stringify(constraints)}。场次按连续戏剧单元划分，不强制每场15秒；按真实剧情分配时长，场次数不能用镜头数代替。对白按说话人原文、顺序进入所有提示词。每场包含动作、声音、结束状态、continuity（startState/endState及transitions）、图片和视频提示词及 productionDesign。productionDesign.startState 必须逐项等于 continuity.startState。图片只描述这一个起始瞬间，动作结束状态放进视频。视频覆盖真实场次时长；15秒场次用0-3、3-6、6-9、9-12、12-15秒五段。遵守统一画风。本集可用资产名称白名单（完整，不可自创或缩写）：${JSON.stringify({ characters: story.characters.map(item => item.name), locations: story.locations.map(item => item.name), props: story.props.map(item => item.name) })}。每场的 imageReferenceSlots 必须逐项覆盖本场 characters、location 和 props，kind/name 必须与策划资产完全一致；视频里对应主体首次出现时写图片 N（角色参考：名称）等，槽位编号、类型和名称对应。\n${PANEL_PRODUCTION_DESIGN_INSTRUCTIONS}\n严格使用JSON Schema：${JSON.stringify(z.toJSONSchema(EpisodeSchema))}`,
          },
        }),
        validate: (value) => [
          ...validateConstraints(value.episode).map(issue => ({ ...issue, path: issue.path.replace(/^firstEpisode/, "episode") })),
          ...validateFirstEpisode(value.episode, input.locale, story, targetDurationSeconds).map(issue => ({ ...issue, path: issue.path.replace(/^firstEpisode/, "episode") })),
          ...value.episode.scenes.flatMap((scene, index) => {
            const errors: string[] = [];
            if (scene.sceneNumber !== index + 1)
              errors.push("场次编号必须从1开始连续递增");
            const unknownCharacters = scene.characters.filter(name => !story.characters.some(item => item.name === name));
            const unknownProps = scene.props.filter(name => !story.props.some(item => item.name === name));
            if (unknownCharacters.length) errors.push(`未采用的角色名称：${unknownCharacters.join("、")}。只能使用：${story.characters.map(item => item.name).join("、")}`);
            if (!story.locations.some(item => item.name === scene.location)) errors.push(`未采用的场景名称：${scene.location}。只能使用：${story.locations.map(item => item.name).join("、")}`);
            if (unknownProps.length) errors.push(`未采用的道具名称：${unknownProps.join("、")}。只能使用：${story.props.map(item => item.name).join("、")}`);
            return errors.map((message) => ({
              code: "original_episode_invalid",
              path: `episode.scenes.${index}`,
              message,
            }));
          }),
        ],
      });
  if (cached) {
    await recordWorkflowArtifactReuse({
      recordRequest: hooks.recordRequest,
      request: {
        requestId: randomUUID(),
        requestType: "original_episode_generation",
        targetType: "episode",
        targetId: episode.id,
        provider: input.channelId,
        model: input.model,
        inputHash: key,
        input: frozenInput,
        cacheVersion: "workflow-cache-v2",
        promptVersion: "original-episode-v4",
        promptVersionHash: sourceFingerprint(`${PROMPT_IDS.STORY_PACKAGE_GENERATION}:original-episode-format-v4`),
      },
      artifactRefs: [`original.episode:${key}`],
      reuseReason: "cache_fingerprint_match",
    });
  }
  if (!cached) {
    await hooks.persistArtifact("original.episode", key, result.data);
    if ("trace" in result)
      await hooks.persistArtifact("prompt.trace", key, result.trace);
  }
  const visualProfilesKey = sourceFingerprint({
    key,
    stage: "original-asset-visual-profiles-v3",
  });
  const visualCandidates = assetsUsedInEpisode(
    result.data.episode,
    await loadIncompleteAssets(input.projectId, story),
  );
  const storyboardReferences = assetStoryboardReferences(
    result.data.episode,
    visualCandidates,
  );
  const cachedVisualProfiles = AssetVisualProfilesSchema.safeParse(
    normalizeAssetVisualProfileNames(await hooks.loadArtifact("original.visual_profiles", visualProfilesKey), visualCandidates),
  );
  const cacheIsComplete =
    cachedVisualProfiles.success &&
    validateAssetVisualProfiles(
      cachedVisualProfiles.data,
      visualCandidates,
    ).length === 0;
  if (cacheIsComplete) {
    await recordWorkflowArtifactReuse({
      recordRequest: hooks.recordRequest,
      request: {
        requestId: randomUUID(),
        requestType: "original_asset_visual_profiles",
        targetType: "episode_assets",
        targetId: episode.id,
        provider: input.channelId,
        model: input.model,
        inputHash: visualProfilesKey,
        input: { episodeId: episode.id, sourceInputHash: key, assets: visualCandidates.map(({ kind, item }) => ({ kind, name: item.name })) },
        cacheVersion: "workflow-cache-v2",
        promptVersion: "original-asset-visual-profiles-v3",
        promptVersionHash: sourceFingerprint("original-asset-visual-profiles-v3"),
      },
      artifactRefs: [`original.visual_profiles:${visualProfilesKey}`],
      reuseReason: "cache_fingerprint_match",
    });
  }
  let visualProfiles = cacheIsComplete
    ? { data: cachedVisualProfiles.data }
    : { data: { assetVisualProfiles: [] as GeneratedAssetVisualProfile[] } };
  if (!cacheIsComplete && visualCandidates.length) {
    await hooks.assertActive();
    await hooks.reportProgress?.(
      `正文已生成，正在补全 ${visualCandidates.length} 项本集出场资产的视觉规范`,
    );
    visualProfiles = await requestOpenAiStructured({
      ...provider,
      schema: AssetVisualProfilesSchema,
      normalizeRaw: (value) => normalizeAssetVisualProfileNames(value, visualCandidates),
      maxCorrectionAttempts: 1,
      timeoutMs: 180_000,
      stream: true,
      temperature: 0.35,
      prompt: renderPrompt({
        id: PROMPT_IDS.STORY_PACKAGE_GENERATION,
        locale: input.locale,
        variables: {
          episode_count: "1",
          project_context: serializeBudgetedContext(
            {
              projectStyle: story.format.artStyle,
              worldRules: story.worldRules,
              creativeProhibitions: story.creativeProhibitions,
              assets: visualCandidates.map(({ kind, item }) => ({
                kind,
                name: item.name,
                packageDossier: item,
                storyboardReferences:
                  storyboardReferences.get(assetKey(kind, item.name)) ?? [],
              })),
            },
            12_000,
          ),
          generation_task: `依据资产档案和分镜引用，为列表中的每个已采用资产补齐完整视觉规范，只输出 assetVisualProfiles，不重写剧情。优先以 packageDossier 为长期设定依据，以 storyboardReferences 中实际引用该资产的场次、画面描述、图片提示词和视频提示词检查是否缺少可稳定复用的外观要点；分镜中的动作、姿势、伤势、天气、光线和临时状态不得写成永久外观。kind 和 name 必须与列表完全一致，每项恰好一次。规范要求：visualIdentity 写稳定识别特征；shapeAndStructure 写轮廓、比例和结构；surfaceAndStyling 写服饰/表面材料；colorPalette 给出固定主色与辅助色；lightingAndPresentation 说明资产参考图的背景、光线和构图；signatureDetails 列稳定记忆点；consistencyRules 区分永久外观与每集可变状态；negativePrompt 列出需避免的错误；inferenceNotes 说明依据与推断。遵循统一项目画风和故事时代。\n严格使用JSON Schema：${JSON.stringify(z.toJSONSchema(AssetVisualProfilesSchema))}`,
        },
      }),
      validate: (value) => validateAssetVisualProfiles(value, visualCandidates),
    });
  }
  if (!cacheIsComplete)
    await hooks.persistArtifact(
      "original.visual_profiles",
      visualProfilesKey,
      visualProfiles.data,
    );
  if ("trace" in visualProfiles)
    await hooks.persistArtifact("prompt.trace", visualProfilesKey, visualProfiles.trace);
  await hooks.assertActive();
  const content = result.data.episode.scenes
    .map(renderPackageScene)
    .join("\n\n");
  const output = await prisma.$transaction(
    async (tx) => {
      const current = await tx.episode.findUnique({
        where: { id: episode.id },
        include: {
          _count: {
            select: {
              clips: true,
              voiceLines: true,
              mediaTasks: true,
            },
          },
          storyboard: { select: { id: true } },
          editorProject: { select: { id: true } },
        },
      });
      const previousNow = await tx.episode.findUnique({
        where: { id: previous.id },
        select: { novelText: true },
      });
      const parentNow = await tx.productionDeliverable.findUnique({
        where: { id: parent.id },
        select: { status: true, supersededAt: true },
      });
      if (
        !current ||
        sourceFingerprint(previousNow?.novelText) !== previousHash ||
        parentNow?.supersededAt ||
        !["approved", "locked"].includes(parentNow?.status ?? "")
      )
        throw new Error("前集正文或策划版本已变化，请刷新后续写");
      await persistAssetVisualProfiles(tx, {
        projectId: input.projectId,
        episodeNumber: episode.episodeNumber,
        workflowId: input.workflowId,
        artStyle: story.format.artStyle,
        story,
        profiles: visualProfiles.data.assetVisualProfiles,
      });
      const existing = await tx.episodeSourceVersion.findFirst({
        where: {
          episodeId: episode.id,
          instructions: `策划包 ${parent.id} v${parent.version}；原创续写 ${input.workflowId}`,
        },
      });
      if (existing)
        return {
          sourceId: existing.id,
          episodeId: episode.id,
          adopted: current.activeSourceId === existing.id,
          visualProfileCount: visualProfiles.data.assetVisualProfiles.length,
        };
      const latest = await tx.episodeSourceVersion.findFirst({
        where: { episodeId: episode.id, kind: "adapted" },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const source = await tx.episodeSourceVersion.create({
        data: {
          id: randomUUID(),
          episodeId: episode.id,
          kind: "adapted",
          version: (latest?.version ?? 0) + 1,
          title: result.data.episode.title,
          summary: result.data.episode.synopsis,
          content,
          sourceHash: createHash("sha256").update(content).digest("hex"),
          channelId: input.channelId,
          model: input.model,
          instructions: `策划包 ${parent.id} v${parent.version}；原创续写 ${input.workflowId}`,
          promptTrace: {
            parentPackageId: parent.id,
            previousHash,
            episode: result.data.episode,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      const adopt =
        !current.novelText?.trim() &&
        !current.storyboard &&
        !current.editorProject &&
        !current._count.clips &&
        !current._count.voiceLines &&
        !current._count.mediaTasks;
      if (adopt) {
        await tx.episode.update({
          where: { id: episode.id },
          data: {
            novelText: content,
            activeSourceId: source.id,
            activeSourceKind: "adapted",
            name: result.data.episode.title,
          },
        });
        await seedPackageProduction(tx, {
          userId: input.userId,
          projectId: input.projectId,
          episodeId: episode.id,
          deliverableId: parent.id,
          story: { ...story, firstEpisode: result.data.episode },
          episodeNumber: episode.episodeNumber,
          allowWorkflowId: input.workflowId,
        });
      }
      return {
        sourceId: source.id,
        episodeId: episode.id,
        adopted: adopt,
        sceneCount: result.data.episode.scenes.length,
        visualProfileCount: visualProfiles.data.assetVisualProfiles.length,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30_000,
    },
  );
  await hooks.persistArtifact("original.completed", key, output);
  return output;
}

type AssetKind = "character" | "location" | "prop";
type AssetDossier =
  | { kind: "character"; item: StoryPackage["characters"][number] }
  | { kind: "location"; item: StoryPackage["locations"][number] }
  | { kind: "prop"; item: StoryPackage["props"][number] };
type GeneratedAssetVisualProfile = z.infer<
  typeof AssetVisualProfileSchema
>;

async function loadIncompleteAssets(projectId: string, story: StoryPackage) {
  const [characters, locations, props] = await Promise.all([
    prisma.novelCharacter.findMany({
      where: { projectId, name: { in: story.characters.map((item) => item.name) } },
      select: { name: true, visualProfileJson: true },
    }),
    prisma.novelLocation.findMany({
      where: { projectId, name: { in: story.locations.map((item) => item.name) } },
      select: { name: true, visualProfileJson: true },
    }),
    prisma.novelProp.findMany({
      where: { projectId, name: { in: story.props.map((item) => item.name) } },
      select: { name: true, visualProfileJson: true },
    }),
  ]);
  const profiles = new Map<
    string,
    ReturnType<typeof parseAssetVisualProfile>
  >();
  for (const asset of characters)
    profiles.set(assetKey("character", asset.name), parseAssetVisualProfile(parseJson(asset.visualProfileJson)));
  for (const asset of locations)
    profiles.set(assetKey("location", asset.name), parseAssetVisualProfile(parseJson(asset.visualProfileJson)));
  for (const asset of props)
    profiles.set(assetKey("prop", asset.name), parseAssetVisualProfile(parseJson(asset.visualProfileJson)));

  const dossiers: AssetDossier[] = [
    ...story.characters.map((item) => ({ kind: "character" as const, item })),
    ...story.locations.map((item) => ({ kind: "location" as const, item })),
    ...story.props.map((item) => ({ kind: "prop" as const, item })),
  ];
  return dossiers.filter(({ kind, item }) =>
    !isCompleteVisualProfile(profiles.get(assetKey(kind, item.name))),
  );
}

function assetsUsedInEpisode(
  episode: StoryPackage["firstEpisode"],
  candidates: AssetDossier[],
) {
  const usedKeys = new Set<string>();
  for (const scene of episode.scenes) {
    if (scene.imageReferenceSlots.length) {
      for (const reference of scene.imageReferenceSlots)
        usedKeys.add(assetKey(reference.kind, reference.name));
      continue;
    }
    for (const name of scene.characters)
      usedKeys.add(assetKey("character", name));
    if (scene.location)
      usedKeys.add(assetKey("location", scene.location));
    for (const name of scene.props) usedKeys.add(assetKey("prop", name));
  }
  return candidates.filter(({ kind, item }) =>
    usedKeys.has(assetKey(kind, item.name)),
  );
}

function assetStoryboardReferences(
  episode: StoryPackage["firstEpisode"],
  candidates: AssetDossier[],
) {
  const references = new Map<string, Array<Record<string, unknown>>>();
  for (const scene of episode.scenes) {
    for (const slot of scene.imageReferenceSlots) {
      const key = assetKey(slot.kind, slot.name);
      if (!candidates.some((candidate) =>
        assetKey(candidate.kind, candidate.item.name) === key,
      ))
        continue;
      const current = references.get(key) ?? [];
      current.push({
        sceneNumber: scene.sceneNumber,
        location: scene.location,
        characters: scene.characters,
        props: scene.props,
        action: scene.action,
        imagePrompt: scene.imagePrompt,
        videoPrompt: scene.videoPrompt,
        referenceSlot: slot,
      });
      references.set(key, current);
    }
  }
  return references;
}

function normalizeAssetVisualProfileNames(value: unknown, candidates: AssetDossier[]) {
  const parsed = AssetVisualProfilesSchema.safeParse(value);
  if (!parsed.success) return value;
  const canonical = new Map(candidates.map(({ kind, item }) => [assetKey(kind, item.name), item.name]));
  return { ...parsed.data, assetVisualProfiles: parsed.data.assetVisualProfiles.map(profile => ({
    ...profile,
    name: canonical.get(assetKey(profile.kind, profile.name)) ?? profile.name,
  })) };
}

function validateAssetVisualProfiles(
  value: z.infer<typeof AssetVisualProfilesSchema>,
  candidates: AssetDossier[],
) {
  const candidateNames = new Map(
    candidates.map(({ kind, item }) => [assetKey(kind, item.name), item.name]),
  );
  const required = new Set(candidateNames.keys());
  const seen = new Set<string>();
  const issues: Array<{ code: string; path: string; message: string }> = [];
  for (const [index, profile] of value.assetVisualProfiles.entries()) {
    const key = assetKey(profile.kind, profile.name);
    if (!required.has(key))
      issues.push({
        code: "original_asset_visual_profile_unexpected",
        path: `assetVisualProfiles.${index}`,
        message: "Only return profiles for the requested adopted assets.",
      });
    else if (candidateNames.get(key) !== profile.name)
      issues.push({
        code: "original_asset_visual_profile_name_mismatch",
        path: `assetVisualProfiles.${index}.name`,
        message: "Use the exact canonical asset name from the adopted package.",
      });
    if (seen.has(key))
      issues.push({
        code: "original_asset_visual_profile_duplicate",
        path: `assetVisualProfiles.${index}`,
        message: "Each asset visual profile may be returned only once.",
      });
    seen.add(key);
  }
  for (const key of required) {
    if (!seen.has(key))
      issues.push({
        code: "original_asset_visual_profile_missing",
        path: "assetVisualProfiles",
        message: `Return a complete visual specification for ${key}.`,
      });
  }
  return issues;
}

async function persistAssetVisualProfiles(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    episodeNumber: number;
    workflowId: string;
    artStyle: string;
    story: StoryPackage;
    profiles: GeneratedAssetVisualProfile[];
  },
) {
  const updatedAt = new Date().toISOString();
  for (const profile of input.profiles) {
    const where = {
      projectId_name: { projectId: input.projectId, name: profile.name },
    };
    let profileJson: string | null;
    if (profile.kind === "character")
      profileJson = (
        await tx.novelCharacter.upsert({
          where,
          create: {
            id: randomUUID(),
            projectId: input.projectId,
            name: profile.name,
            introduction: characterIntroduction(
              requirePackageAsset(input.story.characters, profile),
            ),
            profileJson: JSON.stringify(
              requirePackageAsset(input.story.characters, profile),
            ),
          },
          update: {},
          select: { visualProfileJson: true },
        })
      ).visualProfileJson;
    else if (profile.kind === "location") {
      const item = requirePackageAsset(input.story.locations, profile);
      profileJson = (
        await tx.novelLocation.upsert({
          where,
          create: {
            id: randomUUID(),
            projectId: input.projectId,
            name: profile.name,
            summary: [
              item.storyFunction,
              item.spatialRules,
              item.atmosphere,
              item.reusableActions,
            ].join("\n"),
          },
          update: {},
          select: { visualProfileJson: true },
        })
      ).visualProfileJson;
    } else {
      const item = requirePackageAsset(input.story.props, profile);
      profileJson = (
        await tx.novelProp.upsert({
          where,
          create: {
            id: randomUUID(),
            projectId: input.projectId,
            name: profile.name,
            summary: [
              item.storyFunction,
              item.appearance,
              item.capabilities,
              item.limits,
              item.costOrConsequence,
            ].join("\n"),
            metadataJson: JSON.stringify(item),
          },
          update: {},
          select: { visualProfileJson: true },
        })
      ).visualProfileJson;
    }
    const existing = parseAssetVisualProfile(parseJson(profileJson));
    const old = existing?.spec;
    const merged = {
      visualIdentity: old?.visualIdentity.trim() || profile.spec.visualIdentity,
      shapeAndStructure: old?.shapeAndStructure.trim() || profile.spec.shapeAndStructure,
      surfaceAndStyling: old?.surfaceAndStyling.trim() || profile.spec.surfaceAndStyling,
      colorPalette: old?.colorPalette.trim() || profile.spec.colorPalette,
      lightingAndPresentation:
        old?.lightingAndPresentation.trim() || profile.spec.lightingAndPresentation,
      signatureDetails: old?.signatureDetails.length
        ? old.signatureDetails
        : profile.spec.signatureDetails,
      consistencyRules: old?.consistencyRules.length
        ? old.consistencyRules
        : profile.spec.consistencyRules,
      negativePrompt: old?.negativePrompt.trim() || profile.spec.negativePrompt,
      inferenceNotes: old?.inferenceNotes.length
        ? old.inferenceNotes
        : profile.spec.inferenceNotes,
    };
    const value = {
      version: 1 as const,
      source: existing?.source ?? "model",
      ...(existing?.model ? { model: existing.model } : {}),
      updatedAt,
      spec: merged,
      projectArtStyle: existing?.projectArtStyle || input.artStyle,
      ...(existing?.storyWorld ? { storyWorld: existing.storyWorld } : {}),
      promptTrace: {
        ...existing?.promptTrace,
        originalEpisodeContinuation: {
          episodeNumber: input.episodeNumber,
          workflowId: input.workflowId,
          updatedAt,
        },
      },
    };
    const data = { visualProfileJson: JSON.stringify(value) };
    if (profile.kind === "character")
      await tx.novelCharacter.update({ where, data });
    else if (profile.kind === "location")
      await tx.novelLocation.update({ where, data });
    else await tx.novelProp.update({ where, data });
  }
}

function requirePackageAsset<
  T extends { name: string },
  P extends { kind: AssetKind; name: string },
>(items: T[], profile: P): T {
  const item = items.find((candidate) => candidate.name === profile.name);
  if (!item)
    throw new Error(
      `ORIGINAL_ASSET_NOT_IN_PACKAGE:${profile.kind}:${profile.name}`,
    );
  return item;
}

function characterIntroduction(item: StoryPackage["characters"][number]) {
  return [
    item.storyFunction,
    item.personality,
    item.motivation,
    item.arc,
    item.relationships,
    item.voiceStyle,
  ].join("\n");
}


function assetKey(kind: AssetKind, name: string) {
  return `${kind}:${name.normalize("NFKC").trim().replace(/\s+/gu, "").toLocaleLowerCase()}`;
}

function parseJson(value: string | null) {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
