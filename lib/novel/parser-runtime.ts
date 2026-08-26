import { decryptSecret } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";
import { supportsStoredStructuredOutputs } from "@/lib/agent/provider-types";
import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import type { PromptExecutionTrace } from "@/lib/llm/openai-structured";
import {
  PROMPT_IDS,
  renderPrompt,
  type PromptLocale,
} from "@/lib/prompts";
import {
  characterAnalysisSchema,
  locationPropAnalysisSchema,
  storyboardPlanningSchema,
} from "@/lib/prompts/schemas";
import {
  validateCharacterAnalysis,
  validateLocationPropAnalysis,
  validateStoryboardPlanning,
} from "@/lib/prompts/validators";
import {
  listNovelCharacters,
  listNovelLocations,
  saveStoryboard,
  upsertNovelCharacters,
  upsertNovelLocations,
} from "./domain-store";
import {
  listProductionProps,
  upsertProductionProps,
} from "@/lib/production/domain-store";

export type NovelParseInput = {
  projectId: string;
  episodeId: string;
  channelId: string;
  model: string;
  sourceText?: string;
  locale?: PromptLocale;
};

export type NovelParseOutput = {
  characters: Array<{
    name: string;
    aliases?: string[];
    profile?: Record<string, unknown>;
    introduction?: string | null;
    evidence: string[];
  }>;
  locations: Array<{
    name: string;
    summary?: string | null;
    evidence: string[];
  }>;
  props: Array<{
    name: string;
    summary?: string | null;
    evidence: string[];
  }>;
  panels: Array<{
    panelIndex: number;
    shotType?: string | null;
    cameraMove?: string | null;
    description?: string | null;
    locationName?: string | null;
    characters?: string[];
    props?: string[];
    imagePrompt?: string | null;
    videoPrompt?: string | null;
    sourceEvidence: string[];
  }>;
  promptTraces: PromptExecutionTrace[];
};

export async function parseNovelAndPersist(
  userId: string,
  input: NovelParseInput,
) {
  const episode = await prisma.episode.findFirst({
    where: {
      id: input.episodeId,
      projectId: input.projectId,
      project: { userId },
    },
    select: { novelText: true },
  });
  if (!episode) throw new Error("NOVEL_EPISODE_NOT_FOUND");
  const sourceText = input.sourceText?.trim() || episode.novelText?.trim();
  if (!sourceText) throw new Error("NOVEL_SOURCE_TEXT_REQUIRED");

  const parsed = await requestNovelParse(userId, input, sourceText);
  const characters = await upsertNovelCharacters(
    userId,
    input.projectId,
    parsed.characters,
  );
  const locations = await upsertNovelLocations(
    userId,
    input.projectId,
    parsed.locations,
  );
  const props = await upsertProductionProps(userId, input.projectId, parsed.props);
  const storyboard = await saveStoryboard(
    userId,
    input.projectId,
    input.episodeId,
    {
      status: "draft",
      sourceHash: createSourceHash(sourceText),
      panels: parsed.panels,
    },
  );
  if (!characters || !locations || !props || !storyboard)
    throw new Error("NOVEL_PARSE_PERSIST_FAILED");
  return {
    characters,
    locations,
    props,
    storyboard,
    analysis: {
      characters: parsed.characters,
      locations: parsed.locations,
      props: parsed.props,
      panels: parsed.panels,
    },
    promptTraces: parsed.promptTraces,
    sourceLength: sourceText.length,
  };
}

async function requestNovelParse(
  userId: string,
  input: NovelParseInput,
  sourceText: string,
) {
  const channel = await prisma.channel.findFirst({
    where: { id: input.channelId, userId },
  });
  if (!channel) throw new Error("NOVEL_CHANNEL_NOT_FOUND");
  const configuredModel = await prisma.providerModel.findFirst({
    where: { channelId: input.channelId, modelId: input.model, selected: true },
  });
  if (!configuredModel) throw new Error("NOVEL_MODEL_NOT_CONFIGURED");
  if (
    channel.protocol !== "openai-compatible" &&
    channel.protocol !== "volcengine-ark"
  ) {
    throw new Error(`NOVEL_PROTOCOL_NOT_SUPPORTED:${channel.protocol}`);
  }
  const apiKeys = parseApiKeys(channel.encryptedApiKeys);
  if (!apiKeys.length) throw new Error("NOVEL_CHANNEL_API_KEY_MISSING");
  const [characterLibrary, locationLibrary, propLibrary] = await Promise.all([
    listNovelCharacters(userId, input.projectId),
    listNovelLocations(userId, input.projectId),
    listProductionProps(userId, input.projectId),
  ]);
  if (!characterLibrary || !locationLibrary || !propLibrary)
    throw new Error("NOVEL_PROJECT_NOT_FOUND");

  const locale = input.locale ?? "zh";
  const provider = {
    baseUrl: channel.baseUrl,
    apiKeys,
    model: input.model,
    temperature: 0.2,
    structuredOutputMode: supportsStoredStructuredOutputs(
      configuredModel.capabilitiesJson,
    )
      ? ("json_schema" as const)
      : ("json_object" as const),
  };
  const [characterResult, assetResult] = await Promise.all([
    requestOpenAiStructured({
      ...provider,
      prompt: renderPrompt({
        id: PROMPT_IDS.STORY_CHARACTER_ANALYSIS,
        locale,
        variables: {
          source_text: sourceText,
          character_library: JSON.stringify(characterLibrary),
        },
      }),
      schema: characterAnalysisSchema,
      validate: (data) => validateCharacterAnalysis(data, sourceText),
    }),
    requestOpenAiStructured({
      ...provider,
      prompt: renderPrompt({
        id: PROMPT_IDS.STORY_LOCATION_PROP_ANALYSIS,
        locale,
        variables: {
          source_text: sourceText,
          location_library: JSON.stringify(locationLibrary),
          prop_library: JSON.stringify(propLibrary),
        },
      }),
      schema: locationPropAnalysisSchema,
      validate: (data) => validateLocationPropAnalysis(data, sourceText),
    }),
  ]);
  const storyboardResult = await requestOpenAiStructured({
    ...provider,
    prompt: renderPrompt({
      id: PROMPT_IDS.STORY_STORYBOARD_PLANNING,
      locale,
      variables: {
        source_text: sourceText,
        characters_json: JSON.stringify(characterResult.data.characters),
        locations_json: JSON.stringify(assetResult.data.locations),
        props_json: JSON.stringify(assetResult.data.props),
      },
    }),
    schema: storyboardPlanningSchema,
    validate: (data) =>
      validateStoryboardPlanning(data, {
        sourceText,
        canonical: {
          characters: characterResult.data.characters.map((item) => item.name),
          locations: assetResult.data.locations.map((item) => item.name),
          props: assetResult.data.props.map((item) => item.name),
        },
      }),
  });

  return {
    characters: characterResult.data.characters,
    locations: assetResult.data.locations,
    props: assetResult.data.props,
    panels: storyboardResult.data.panels,
    promptTraces: [
      characterResult.trace,
      assetResult.trace,
      storyboardResult.trace,
    ],
  } satisfies NovelParseOutput;
}

function parseApiKeys(value: string) {
  try {
    const keys = JSON.parse(decryptSecret(value)) as unknown;
    return Array.isArray(keys)
      ? keys
          .filter(
            (key): key is string =>
              typeof key === "string" && Boolean(key.trim()),
          )
          .map((key) => key.trim())
      : [];
  } catch {
    return [];
  }
}
function createSourceHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
