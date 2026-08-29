import { z } from "zod";

import { supportsStoredStructuredOutputs } from "@/lib/agent/provider-types";
import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import {
  StructuredOutputError,
  type StructuredValidationIssue,
} from "@/lib/llm/structured-output";
import { PROMPT_IDS, renderPrompt, type PromptLocale } from "@/lib/prompts";
import { assetVisualDesignSchema } from "@/lib/prompts/schemas";
import { decryptSecret } from "@/lib/server/crypto";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { prisma } from "@/lib/server/prisma";
import { structuredRequestOptions } from "@/lib/settings/runtime-contract";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import { getProjectArtStyleDirective } from "@/lib/projects/art-style";
import { ProjectAssetError } from "./project-store";
import type {
  AssetVisualProfile,
  AssetVisualProfileSpec,
} from "./visual-profile";
import {
  findVisualProfileStoryWorldConflicts,
  findVisualProfileStoryWorldConflictDetails,
  getStoryWorldDirective,
  loadProjectAssetStoryWorldContext,
  storyWorldContextForPrompt,
  type AssetStoryWorldContext,
} from "./story-world";

export type VisualDesignTargetType = "character" | "location" | "prop";

type VisualDesignResult = z.infer<typeof assetVisualDesignSchema>;

export async function generateProjectAssetVisualProfile(input: {
  userId: string;
  projectId: string;
  targetType: VisualDesignTargetType;
  targetId: string;
  channelId: string;
  model: string;
  locale?: PromptLocale;
}) {
  const context = await loadVisualDesignContext(input);
  const storyWorld = await loadProjectAssetStoryWorldContext({
    userId: input.userId,
    projectId: input.projectId,
    assetName: context.name,
    assetFacts: context.facts,
  });
  const provider = await resolveDesignProvider(input);
  const prompt = renderPrompt({
    id: PROMPT_IDS.ASSET_VISUAL_DESIGN,
    locale: input.locale,
    variables: {
      asset_kind: localizedKind(input.targetType, input.locale),
      asset_name: context.name,
      asset_requirements: localizedAssetRequirements(
        input.targetType,
        input.locale,
      ),
      story_facts_json: JSON.stringify(context.facts, null, 2),
      source_evidence_json: JSON.stringify(
        storyWorld.relatedSourceEvidence,
        null,
        2,
      ),
      story_world_context_json: JSON.stringify(
        storyWorldContextForPrompt(storyWorld),
        null,
        2,
      ),
      story_world_directive: getStoryWorldDirective(
        storyWorld.lock,
        input.locale === "en" ? "en" : "zh",
      ),
      project_style: getProjectArtStyleDirective(
        context.artStyle,
        input.locale === "en" ? "en" : "zh",
      ),
    },
  });
  let result: Awaited<
    ReturnType<typeof requestOpenAiStructured<VisualDesignResult>>
  >;
  try {
    result = await requestOpenAiStructured({
      ...provider,
      prompt,
      schema: assetVisualDesignSchema,
      temperature: 0.35,
      validate: (spec) =>
        storyWorldValidationIssues(
          spec,
          storyWorld,
          input.locale === "en" ? "en" : "zh",
        ),
    });
  } catch (error) {
    if (
      error instanceof StructuredOutputError &&
      error.code === "STRUCTURED_SEMANTIC_INVALID"
    )
      throw new ProjectAssetError(
        input.locale === "en"
          ? `The generated visual profile still conflicts with the project story world after targeted correction: ${error.details.join("; ")}`
          : `模型定向修正后，视觉设定仍与项目故事时代冲突：${error.details.join("；")}`,
        422,
      );
    throw error;
  }
  assertStoryWorldCompatibility(result.data, storyWorld);
  const profile = await persistVisualProfile({
    ...input,
    source: "model",
    spec: result.data,
    projectArtStyle: context.artStyle,
    storyWorld: storyWorld.lock,
    promptTrace: result.trace,
  });
  return {
    target: {
      id: input.targetId,
      type: input.targetType,
      name: context.name,
    },
    profile,
  };
}

export async function saveProjectAssetVisualProfile(input: {
  userId: string;
  projectId: string;
  targetType: VisualDesignTargetType;
  targetId: string;
  spec: AssetVisualProfileSpec;
}) {
  const context = await loadVisualDesignContext(input);
  const storyWorld = await loadProjectAssetStoryWorldContext({
    userId: input.userId,
    projectId: input.projectId,
    assetName: context.name,
    assetFacts: context.facts,
  });
  const parsed = assetVisualDesignSchema.safeParse(input.spec);
  if (!parsed.success)
    throw new ProjectAssetError("视觉设定字段不完整", 400);
  assertStoryWorldCompatibility(parsed.data, storyWorld);
  return persistVisualProfile({
    ...input,
    source: "manual",
    spec: parsed.data,
    projectArtStyle: context.artStyle,
    storyWorld: storyWorld.lock,
  });
}

async function loadVisualDesignContext(input: {
  userId: string;
  projectId: string;
  targetType: VisualDesignTargetType;
  targetId: string;
}) {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, userId: input.userId },
    select: { config: { select: { artStyle: true } } },
  });
  if (!project) throw new ProjectAssetError("项目不存在", 404);
  if (input.targetType === "character") {
    const entity = await prisma.novelCharacter.findFirst({
      where: { id: input.targetId, projectId: input.projectId },
      select: {
        name: true,
        aliases: true,
        introduction: true,
        profileJson: true,
      },
    });
    if (!entity) throw new ProjectAssetError("角色不存在", 404);
    return {
      name: entity.name,
      artStyle: project.config?.artStyle,
      facts: {
        introduction: entity.introduction,
        aliases: parseValue(entity.aliases),
        profile: parseValue(entity.profileJson),
      },
    };
  }
  if (input.targetType === "location") {
    const entity = await prisma.novelLocation.findFirst({
      where: { id: input.targetId, projectId: input.projectId },
      select: { name: true, summary: true },
    });
    if (!entity) throw new ProjectAssetError("场景不存在", 404);
    return {
      name: entity.name,
      artStyle: project.config?.artStyle,
      facts: { summary: entity.summary },
    };
  }
  const entity = await prisma.novelProp.findFirst({
    where: { id: input.targetId, projectId: input.projectId },
    select: { name: true, summary: true, metadataJson: true },
  });
  if (!entity) throw new ProjectAssetError("道具不存在", 404);
  return {
    name: entity.name,
    artStyle: project.config?.artStyle,
    facts: {
      summary: entity.summary,
      metadata: parseValue(entity.metadataJson),
    },
  };
}

async function persistVisualProfile(input: {
  projectId: string;
  targetType: VisualDesignTargetType;
  targetId: string;
  source: "model" | "manual";
  spec: VisualDesignResult;
  projectArtStyle?: string;
  storyWorld?: AssetVisualProfile["storyWorld"];
  model?: string;
  promptTrace?: Record<string, unknown>;
}) {
  const profile: AssetVisualProfile = {
    version: 1,
    source: input.source,
    ...(input.model ? { model: input.model } : {}),
    updatedAt: new Date().toISOString(),
    spec: input.spec,
    ...(input.projectArtStyle
      ? { projectArtStyle: input.projectArtStyle }
      : {}),
    ...(input.storyWorld ? { storyWorld: input.storyWorld } : {}),
    ...(input.promptTrace ? { promptTrace: input.promptTrace } : {}),
  };
  const data = { visualProfileJson: JSON.stringify(profile) };
  if (input.targetType === "character")
    await prisma.novelCharacter.updateMany({
      where: { id: input.targetId, projectId: input.projectId },
      data,
    });
  else if (input.targetType === "location")
    await prisma.novelLocation.updateMany({
      where: { id: input.targetId, projectId: input.projectId },
      data,
    });
  else
    await prisma.novelProp.updateMany({
      where: { id: input.targetId, projectId: input.projectId },
      data,
    });
  return profile;
}

function assertStoryWorldCompatibility(
  spec: AssetVisualProfileSpec,
  storyWorld: AssetStoryWorldContext,
) {
  const conflicts = findVisualProfileStoryWorldConflicts(spec, storyWorld);
  if (!conflicts.length) return;
  throw new ProjectAssetError(
    `视觉设定与故事时代冲突：检测到${conflicts.join("、")}。请按项目故事世界重新设计，不能用画风替代时代设定。`,
    422,
  );
}

function storyWorldValidationIssues(
  spec: AssetVisualProfileSpec,
  storyWorld: AssetStoryWorldContext,
  locale: "zh" | "en",
): StructuredValidationIssue[] {
  return findVisualProfileStoryWorldConflictDetails(spec, storyWorld).map(
    ({ path, conflicts }) => ({
      code: "STORY_WORLD_CONFLICT",
      path,
      message:
        locale === "en"
          ? `This field contains ${conflicts.join(", ")}, which conflicts with the project story world. Correct only the conflicting visual details using the supplied source evidence and story-world directive; preserve all valid source facts and compliant fields.`
          : `该字段包含${conflicts.join("、")}，与项目故事时代冲突。只修正冲突的视觉细节，严格依据已提供的原文证据和故事世界约束，保留原作事实及其他合规字段。`,
    }),
  );
}

async function resolveDesignProvider(input: {
  userId: string;
  channelId: string;
  model: string;
}) {
  const channel = await prisma.channel.findFirst({
    where: accessibleChannelWhere(input.userId, input.channelId),
  });
  if (!channel) throw new ProjectAssetError("分析渠道不存在", 404);
  if (
    channel.protocol !== "openai-compatible" &&
    channel.protocol !== "volcengine-ark"
  )
    throw new ProjectAssetError("视觉设计需要 OpenAI 兼容渠道", 400);
  const configuredModel = await prisma.providerModel.findFirst({
    where: { channelId: input.channelId, modelId: input.model, selected: true },
  });
  if (!configuredModel) throw new ProjectAssetError("分析模型未配置", 400);
  const apiKeys = parseApiKeys(channel.encryptedApiKeys);
  if (!apiKeys.length) throw new ProjectAssetError("分析渠道缺少 API Key", 400);
  const runtimeSettings = await loadUserRuntimeSettings(input.userId);
  return {
    baseUrl: channel.baseUrl,
    apiKeys,
    model: input.model,
    ...structuredRequestOptions(runtimeSettings),
    structuredOutputMode: supportsStoredStructuredOutputs(
      configuredModel.capabilitiesJson,
    )
      ? ("json_schema" as const)
      : ("json_object" as const),
  };
}

function localizedKind(kind: VisualDesignTargetType, locale?: PromptLocale) {
  if (locale === "en") return kind;
  if (kind === "character") return "角色";
  if (kind === "location") return "场景";
  return "道具";
}

function localizedAssetRequirements(
  targetType: VisualDesignTargetType,
  locale?: PromptLocale,
) {
  const english = locale === "en";
  if (targetType === "character")
    return english
      ? "Character profile: lock facial structure, hair, body proportions, era-compatible layered wardrobe, footwear, accessories, and stable identifiers. Separate permanent identity from episode-specific injury, emotion, action, or costume state."
      : "角色设定：锁定脸型五官、发式、体型比例、符合时代的服装层次、鞋履配饰和稳定识别点；永久身份与本集伤势、情绪、动作或临时换装必须分开。";
  if (targetType === "location")
    return english
      ? "Location profile: define reusable spatial topology and scale, parent/sub-area relationships, entrances, foreground/midground/background, fixed architecture or terrain, era-compatible materials and craft, primary practical light sources, and repeatable landmarks. Do not turn weather, time of day, damage, temporary dressing, or an episode event into permanent identity."
      : "场景设定：明确可复用的空间拓扑与尺度、父级/子区域关系、出入口、前中后景、固定建筑或地貌、符合时代的材料与工艺、主要实际光源和可重复地标；不得把天气、昼夜、战损、临时陈设或本集事件当成永久身份。";
  return english
    ? "Prop profile: lock silhouette, real-world scale, operable parts, era-compatible construction, material and craft, surface wear, colors, ornament, ownership or ability rules, and stable identifiers. Separate permanent design from current holder, open/closed state, damage, activation, or other episode state."
    : "道具设定：锁定轮廓、实际比例、可动部件、符合时代的结构、材质与工艺、表面磨损、配色装饰、归属或能力规则和稳定识别点；永久设计与当前持有者、开合、破损、激活等本集状态必须分开。";
}

function parseValue(value: string | null) {
  try {
    return value ? (JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
}

function parseApiKeys(value: string) {
  try {
    const parsed: unknown = JSON.parse(decryptSecret(value));
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is string =>
            typeof item === "string" && Boolean(item.trim()),
        )
      : [];
  } catch {
    return [];
  }
}
