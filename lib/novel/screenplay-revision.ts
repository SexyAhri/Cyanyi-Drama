import { createHash, randomUUID } from "node:crypto";

import { supportsStoredStructuredOutputs } from "@/lib/agent/provider-types";
import {
  getStoryWorldDirective,
  loadProjectAssetStoryWorldContext,
} from "@/lib/assets/story-world";
import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import { PROMPT_IDS, renderPrompt, type PromptLocale } from "@/lib/prompts";
import {
  screenplayConversionSchema,
  type ScreenplayConversion,
} from "@/lib/prompts/schemas";
import {
  buildSourceEvents,
  normalizeScreenplaySourceContract,
  validateScreenplayConversion,
} from "@/lib/prompts/validators";
import { listProductionProps } from "@/lib/production/domain-store";
import { extractProjectEffectLibrary } from "@/lib/production/effect-library";
import { loadApprovedWorldBible } from "@/lib/production/world-bible";
import { getProjectArtStyleDirective } from "@/lib/projects/art-style";
import { decryptSecret } from "@/lib/server/crypto";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { prisma } from "@/lib/server/prisma";
import { structuredRequestOptions } from "@/lib/settings/runtime-contract";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";

import { listNovelCharacters, listNovelLocations } from "./domain-store";
import { normalizeScreenplayDialogue } from "./screenplay-dialogue";
import { normalizeScreenplayProviderPayload } from "./screenplay-provider-normalization";

export async function reviseScreenplayClip(input: {
  userId: string;
  projectId: string;
  clipId: string;
  channelId: string;
  model: string;
  request: string;
  locale: PromptLocale;
  failureContext?: unknown;
}) {
  const [
    clip,
    channel,
    configuredModel,
    characters,
    locations,
    props,
    worldBible,
    project,
    effectRows,
    runtimeSettings,
  ] = await Promise.all([
    prisma.storyClip.findFirst({
      where: {
        id: input.clipId,
        projectId: input.projectId,
        project: { userId: input.userId },
      },
      select: {
        id: true,
        episodeId: true,
        clipIndex: true,
        content: true,
        screenplay: true,
      },
    }),
    prisma.channel.findFirst({
      where: accessibleChannelWhere(input.userId, input.channelId),
    }),
    prisma.providerModel.findFirst({
      where: {
        channelId: input.channelId,
        modelId: input.model,
        selected: true,
      },
    }),
    listNovelCharacters(input.userId, input.projectId),
    listNovelLocations(input.userId, input.projectId),
    listProductionProps(input.userId, input.projectId),
    loadApprovedWorldBible(input.userId, input.projectId),
    prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: {
        name: true,
        description: true,
        config: { select: { artStyle: true } },
      },
    }),
    prisma.storyClip.findMany({
      where: { projectId: input.projectId, screenplay: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: { screenplay: true },
    }),
    loadUserRuntimeSettings(input.userId),
  ]);
  if (!clip) throw new Error("SCREENPLAY_REVISION_CLIP_NOT_FOUND");
  if (!channel || !configuredModel)
    throw new Error("SCREENPLAY_REVISION_MODEL_NOT_CONFIGURED");
  if (
    channel.protocol !== "openai-compatible" &&
    channel.protocol !== "volcengine-ark"
  )
    throw new Error(
      `SCREENPLAY_REVISION_PROTOCOL_NOT_SUPPORTED:${channel.protocol}`,
    );
  const apiKeys = parseApiKeys(channel.encryptedApiKeys);
  if (!apiKeys.length) throw new Error("SCREENPLAY_REVISION_API_KEY_MISSING");
  const failureCategory = classifyScreenplayFailureContext(
    input.failureContext,
  );
  if (!clip.screenplay && failureCategory !== "semantic")
    throw new Error("SCREENPLAY_REVISION_SOURCE_REQUIRED");
  if (failureCategory === "transport")
    throw new Error("SCREENPLAY_REVISION_TRANSPORT_RETRY_REQUIRED");
  const current = clip.screenplay
    ? parseCurrentScreenplay(clip.screenplay)
    : null;
  const canonical = {
    characters: (characters ?? []).map((character) => character.name),
    locations: (locations ?? []).map((location) => location.name),
    props: (props ?? []).map((prop) => prop.name),
  };
  const worldBibleText = JSON.stringify(worldBible?.payload ?? {});
  const effectLibrary = extractProjectEffectLibrary(
    effectRows.map((row) => row.screenplay),
  );
  const storyWorld = await loadProjectAssetStoryWorldContext({
    userId: input.userId,
    projectId: input.projectId,
    assetName: "",
    assetFacts: {
      projectName: project?.name,
      projectDescription: project?.description,
      clipSource: clip.content,
      effectLibrary,
    },
  });
  const locale = input.locale === "en" ? "en" : "zh";
  const projectStyleDirective = getProjectArtStyleDirective(
    project?.config?.artStyle,
    locale,
  );
  const storyWorldDirective = getStoryWorldDirective(storyWorld.lock, locale);
  const productionKnowledgeText = [
    worldBibleText,
    JSON.stringify(effectLibrary),
    projectStyleDirective,
    storyWorldDirective,
  ].join("\n");
  const sourceEvents = buildSourceEvents(clip.content);
  const sourceContract = {
    clipId: clip.id,
    clipText: clip.content,
    sourceEvents,
    knowledgeText: productionKnowledgeText,
  };
  const prompt = renderPrompt({
    id: PROMPT_IDS.STORY_SCREENPLAY_REVISION,
    locale: input.locale,
    variables: {
      clip_id: clip.id,
      clip_text: clip.content,
      current_screenplay_json: JSON.stringify(current),
      revision_request: input.request.trim(),
      failure_context_json: JSON.stringify(input.failureContext ?? {}),
      character_library: JSON.stringify(characters ?? []),
      location_library: JSON.stringify(locations ?? []),
      prop_library: JSON.stringify(props ?? []),
      world_bible_json: worldBibleText,
      project_style: projectStyleDirective,
      story_world_directive: storyWorldDirective,
      effect_library_json: JSON.stringify(effectLibrary),
    },
  });
  const result = await requestOpenAiStructured({
    baseUrl: channel.baseUrl,
    apiKeys,
    model: input.model,
    prompt,
    schema: screenplayConversionSchema,
    normalizeRaw: (value) =>
      normalizeScreenplayProviderPayload(value, {
        clipText: clip.content,
        characters: canonical.characters,
        sourceEvents,
      }),
    validate: (data) =>
      validateScreenplayConversion(
        normalizeScreenplayDialogue(
          normalizeScreenplaySourceContract(data, sourceContract),
        ),
        {
          clipId: clip.id,
          clipText: clip.content,
          canonical,
          sourceEvents,
          knowledgeText: productionKnowledgeText,
        },
      ),
    structuredOutputMode: supportsStoredStructuredOutputs(
      configuredModel.capabilitiesJson,
    )
      ? "json_schema"
      : "json_object",
    temperature: 0.15,
    ...structuredRequestOptions(runtimeSettings),
  });
  const revised = normalizeScreenplayDialogue(
    normalizeScreenplaySourceContract(result.data, sourceContract),
  );
  const normalizationIssues = validateScreenplayConversion(revised, {
    clipId: clip.id,
    clipText: clip.content,
    canonical,
    sourceEvents,
    knowledgeText: productionKnowledgeText,
  });
  if (normalizationIssues.length)
    throw new Error(
      `SCREENPLAY_REVISION_NORMALIZATION_INVALID:${normalizationIssues
        .map((issue) => `${issue.path}:[${issue.code}]`)
        .join(";")}`,
    );
  const revisedText = JSON.stringify(revised);
  const revisionId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const latest = await tx.productionDeliverable.aggregate({
      where: {
        projectId: input.projectId,
        scopeType: "clip",
        scopeId: clip.id,
        deliverableType: "screenplay_revision",
      },
      _max: { version: true },
    });
    await tx.productionDeliverable.create({
      data: {
        id: revisionId,
        userId: input.userId,
        projectId: input.projectId,
        episodeId: clip.episodeId,
        scopeType: "clip",
        scopeId: clip.id,
        department: "writing",
        deliverableType: "screenplay_revision",
        title: `剧情分片 ${clip.clipIndex + 1} 剧本修订`,
        status: "approved",
        version: (latest._max.version ?? 0) + 1,
        payload: {
          request: input.request,
          failureContext: jsonValue(input.failureContext),
          previous: current,
          revised,
        },
        sourceRefs: [{ type: "story_clip", id: clip.id }],
        promptTrace: result.trace,
        dependencyHash: sha256(
          `${clip.screenplay ?? ""}\u0000${input.request}\u0000${revisedText}`,
        ),
        approvedByUserId: input.userId,
        submittedAt: new Date(),
        approvedAt: new Date(),
      },
    });
    await tx.storyClip.update({
      where: { id: clip.id },
      data: {
        screenplay: revisedText,
        shotCount: null,
        status: "screenplay_revised",
      },
    });
    await tx.storyboard.updateMany({
      where: { episodeId: clip.episodeId, projectId: input.projectId },
      data: { status: "stale" },
    });
    await tx.storyboardPanel.updateMany({
      where: {
        storyboard: {
          episodeId: clip.episodeId,
          projectId: input.projectId,
        },
      },
      data: { status: "stale" },
    });
    await tx.voiceLine.updateMany({
      where: { episodeId: clip.episodeId },
      data: { status: "stale" },
    });
    await tx.editorProject.updateMany({
      where: { episodeId: clip.episodeId },
      data: { renderStatus: "stale" },
    });
  });

  return {
    clipId: clip.id,
    revisionId,
    sceneCount: revised.scenes.length,
    promptTrace: result.trace,
    downstreamStatus: "stale",
  };
}

export type ScreenplayFailureCategory =
  | "none"
  | "semantic"
  | "transport"
  | "unknown";

export function classifyScreenplayFailureContext(
  value: unknown,
): ScreenplayFailureCategory {
  if (value === undefined || value === null) return "none";
  const text = collectFailureText(value).join("\n");
  if (!text.trim()) return "none";
  if (
    /STRUCTURED_(?:JSON|SCHEMA|SEMANTIC)_INVALID|SCREENPLAY_(?:DIALOGUE_)?NORMALIZATION_INVALID|CLIP_ID_CHANGED|ORIGINAL_TEXT_CHANGED|SOURCE_EVENT|COVERAGE|UNKNOWN_(?:CHARACTER|LOCATION|PROP)|DIALOGUE/i.test(
      text,
    )
  )
    return "semantic";
  if (
    /PROVIDER_(?:TIMEOUT|TRANSPORT_ERROR|RESPONSE_ERROR)|STRUCTURED_PROVIDER_(?:TIMEOUT|TRANSPORT|TRANSPORT_FAILED|FAILED)|ECONNRESET|ETIMEDOUT|UND_ERR_SOCKET|socket hang up|terminated|rate.?limit|HTTP\s*(?:408|409|425|429|5\d\d)|断流|超时|限流/i.test(
      text,
    )
  )
    return "transport";
  return "unknown";
}

export function canReviseScreenplayClip(input: {
  failureContext?: unknown;
  screenplay: string | null;
}) {
  return (
    Boolean(input.screenplay) ||
    classifyScreenplayFailureContext(input.failureContext) === "semantic"
  );
}

function parseCurrentScreenplay(value: string): ScreenplayConversion {
  try {
    return screenplayConversionSchema.parse(JSON.parse(value));
  } catch {
    throw new Error("SCREENPLAY_REVISION_CURRENT_INVALID");
  }
}

function collectFailureText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean")
    return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectFailureText);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => [
    key,
    ...collectFailureText(item),
  ]);
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

function jsonValue(value: unknown) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
