import { z } from "zod";

import { supportsStoredStructuredOutputs } from "@/lib/agent/provider-types";
import { decryptSecret } from "@/lib/server/crypto";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import { PROMPT_IDS, renderPrompt, type PromptLocale } from "@/lib/prompts";
import { prisma } from "@/lib/server/prisma";
import { structuredRequestOptions } from "@/lib/settings/runtime-contract";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import { upsertNovelCharacters, upsertNovelLocations } from "@/lib/novel/domain-store";
import { upsertProductionProps } from "@/lib/production/domain-store";
import { extractVideoFrameDataUrls } from "@/lib/providers/local/video-frames";
import {
  characterReferenceDescriptionSchema,
  visualAssetExtractionSchema,
} from "@/lib/prompts/schemas";
import {
  linkSourceAssets,
  listOwnedProjectMediaAssets,
  ProjectAssetError,
} from "./project-store";

type VisualExtraction = z.infer<typeof visualAssetExtractionSchema>;

type VisualExtractionDependencies = {
  extractFrames: typeof extractVideoFrameDataUrls;
};

const defaultDependencies: VisualExtractionDependencies = {
  extractFrames: extractVideoFrameDataUrls,
};

export async function extractProjectVisualAssets(
  input: {
    userId: string;
    projectId: string;
    assetIds: string[];
    channelId: string;
    model: string;
    kindHint?: string;
    locale?: PromptLocale;
    persist?: boolean;
  },
  dependencies: VisualExtractionDependencies = defaultDependencies,
) {
  const assets = await listOwnedProjectMediaAssets(
    input.userId,
    input.projectId,
    input.assetIds,
  );
  if (!assets.length) throw new ProjectAssetError("至少需要一个项目资产", 400);
  const references: string[] = [];
  for (const asset of assets) {
    if (asset.kind === "image") references.push(asset.url);
    else references.push(...(await dependencies.extractFrames(asset.url, 3)));
  }
  if (!references.length)
    throw new ProjectAssetError("资产中没有可分析的视觉内容", 400);

  const provider = await resolveVisionProvider(input);
  const prompt = renderPrompt({
    id: PROMPT_IDS.ASSET_VISUAL_EXTRACTION,
    locale: input.locale,
    variables: { asset_kind_hint: input.kindHint?.trim() || "auto" },
  });
  const result = await requestOpenAiStructured({
    ...provider,
    prompt,
    schema: visualAssetExtractionSchema,
    imageUrls: references.slice(0, 12),
    validate: validateUniqueVisualEntities,
    temperature: 0.2,
  });

  const persisted = input.persist
    ? await persistVisualExtraction(input, result.data)
    : null;
  return {
    assets: result.data,
    sourceAssetIds: assets.map((asset) => asset.id),
    sampledReferenceCount: Math.min(references.length, 12),
    persisted,
    trace: result.trace,
  };
}

export async function extractCharacterReferenceDescription(input: {
  userId: string;
  projectId: string;
  assetIds: string[];
  channelId: string;
  model: string;
  characterId: string;
  appearanceId?: string;
  locale?: PromptLocale;
}) {
  const character = await prisma.novelCharacter.findFirst({
    where: {
      id: input.characterId,
      projectId: input.projectId,
      project: { userId: input.userId },
    },
    select: { id: true, name: true },
  });
  if (!character) throw new ProjectAssetError("角色不存在", 404);
  if (input.appearanceId) {
    const appearance = await prisma.characterAppearance.count({
      where: { id: input.appearanceId, characterId: character.id },
    });
    if (!appearance) throw new ProjectAssetError("角色外观不存在", 404);
  }
  const assets = await listOwnedProjectMediaAssets(
    input.userId,
    input.projectId,
    input.assetIds,
    ["image"],
  );
  if (!assets.length) throw new ProjectAssetError("至少需要一张参考图", 400);
  const provider = await resolveVisionProvider(input);
  const prompt = renderPrompt({
    id: PROMPT_IDS.CHARACTER_REFERENCE_DESCRIPTION,
    locale: input.locale,
    variables: { character_name: character.name },
  });
  const result = await requestOpenAiStructured({
    ...provider,
    prompt,
    schema: characterReferenceDescriptionSchema,
    imageUrls: assets.map((asset) => asset.url).slice(0, 5),
    temperature: 0.2,
  });
  const entityType = input.appearanceId
    ? "character_appearance"
    : "character";
  const entityId = input.appearanceId ?? character.id;
  if (input.appearanceId)
    await prisma.characterAppearance.update({
      where: { id: input.appearanceId },
      data: {
        description: result.data.description,
        metadataJson: JSON.stringify({
          uncertainties: result.data.uncertainties,
          sourceAssetIds: assets.map((asset) => asset.id),
          promptTrace: result.trace,
        }),
      },
    });
  await linkSourceAssets({
    userId: input.userId,
    projectId: input.projectId,
    assetIds: assets.map((asset) => asset.id),
    entityType,
    entityId,
    role: "description_source",
    metadata: { promptTrace: result.trace },
  });
  return {
    ...result.data,
    characterId: character.id,
    appearanceId: input.appearanceId ?? null,
    sourceAssetIds: assets.map((asset) => asset.id),
    trace: result.trace,
  };
}

async function resolveVisionProvider(input: {
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
    throw new ProjectAssetError("视觉提取需要 OpenAI 兼容渠道", 400);
  const configuredModel = await prisma.providerModel.findFirst({
    where: {
      channelId: input.channelId,
      modelId: input.model,
      selected: true,
    },
  });
  if (!configuredModel) throw new ProjectAssetError("分析模型未配置", 400);
  const capabilities = parseObject(configuredModel.capabilitiesJson);
  if (capabilities.supportsReferenceImages !== true)
    throw new ProjectAssetError("分析模型未声明支持图片输入", 400);
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

async function persistVisualExtraction(
  input: { userId: string; projectId: string; assetIds: string[] },
  extracted: VisualExtraction,
) {
  const [characters, locations, props] = await Promise.all([
    upsertNovelCharacters(
      input.userId,
      input.projectId,
      extracted.characters.map((item) => ({
        name: item.name,
        introduction: item.description,
        profile: {
          visualDescription: item.description,
          visualEvidence: item.evidence,
          sourceAssetIds: input.assetIds,
        },
      })),
    ),
    upsertNovelLocations(
      input.userId,
      input.projectId,
      extracted.locations.map((item) => ({
        name: item.name,
        summary: item.description,
      })),
    ),
    upsertProductionProps(
      input.userId,
      input.projectId,
      extracted.props.map((item) => ({
        name: item.name,
        summary: item.description,
        metadata: {
          visualEvidence: item.evidence,
          sourceAssetIds: input.assetIds,
        },
      })),
    ),
  ]);
  if (!characters || !locations || !props)
    throw new ProjectAssetError("项目不存在", 404);
  await Promise.all(
    [
      ...characters.map((entity) => ({ type: "character", id: entity.id })),
      ...locations.map((entity) => ({ type: "location", id: entity.id })),
      ...props.map((entity) => ({ type: "prop", id: entity.id })),
    ].map((entity) =>
      linkSourceAssets({
        userId: input.userId,
        projectId: input.projectId,
        assetIds: input.assetIds,
        entityType: entity.type,
        entityId: entity.id,
        role: "extracted_source",
      }),
    ),
  );
  return { characters, locations, props };
}

function validateUniqueVisualEntities(data: VisualExtraction) {
  const issues: Array<{ code: string; path: string; message: string }> = [];
  for (const [kind, values] of Object.entries(data)) {
    const seen = new Set<string>();
    values.forEach((item, index) => {
      const name = item.name.toLocaleLowerCase();
      if (seen.has(name))
        issues.push({
          code: "VISUAL_ENTITY_DUPLICATE",
          path: `${kind}.${index}.name`,
          message: `Duplicate visual entity: ${item.name}`,
        });
      seen.add(name);
    });
  }
  return issues;
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

function parseObject(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
