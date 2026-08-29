import { z } from "zod";

import { supportsStoredStructuredOutputs } from "@/lib/agent/provider-types";
import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
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
  const provider = await resolveDesignProvider(input);
  const prompt = renderPrompt({
    id: PROMPT_IDS.ASSET_VISUAL_DESIGN,
    locale: input.locale,
    variables: {
      asset_kind: localizedKind(input.targetType, input.locale),
      asset_name: context.name,
      story_facts_json: JSON.stringify(context.facts, null, 2),
      project_style: getProjectArtStyleDirective(
        context.artStyle,
        input.locale === "en" ? "en" : "zh",
      ),
    },
  });
  const result = await requestOpenAiStructured({
    ...provider,
    prompt,
    schema: assetVisualDesignSchema,
    temperature: 0.35,
  });
  const profile = await persistVisualProfile({
    ...input,
    source: "model",
    spec: result.data,
    projectArtStyle: context.artStyle,
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
  const parsed = assetVisualDesignSchema.safeParse(input.spec);
  if (!parsed.success)
    throw new ProjectAssetError("视觉设定字段不完整", 400);
  return persistVisualProfile({
    ...input,
    source: "manual",
    spec: parsed.data,
    projectArtStyle: context.artStyle,
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
