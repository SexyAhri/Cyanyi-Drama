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
} from "@/lib/prompts/schemas";
import {
  validateCharacterAnalysis,
  validateLocationPropAnalysis,
} from "@/lib/prompts/validators";
import {
  listNovelCharacters,
  listNovelLocations,
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
  promptTraces: PromptExecutionTrace[];
};

export type NovelParseRuntimeHooks = {
  assertActive: () => Promise<void>;
  persistArtifact: (
    artifactType: string,
    refId: string,
    payload: unknown,
  ) => Promise<void>;
};

export async function parseNovelAndPersist(
  userId: string,
  input: NovelParseInput,
  hooks?: NovelParseRuntimeHooks,
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
  const sourceText = input.sourceText ?? episode.novelText;
  if (!sourceText?.trim()) throw new Error("NOVEL_SOURCE_TEXT_REQUIRED");

  let characters: Awaited<ReturnType<typeof upsertNovelCharacters>> = null;
  let locations: Awaited<ReturnType<typeof upsertNovelLocations>> = null;
  let props: Awaited<ReturnType<typeof upsertProductionProps>> = null;
  const parsed = await requestNovelParse(userId, input, sourceText, {
    onCharacters: async (data, trace) => {
      characters = await persistAnalysisPart({
        hooks,
        artifactType: "analysis.characters",
        refId: "characters",
        data,
        trace,
        persist: () => upsertNovelCharacters(userId, input.projectId, data),
      });
    },
    onAssets: async (data, trace) => {
      const persisted = await Promise.allSettled([
        persistAnalysisPart({
          hooks,
          artifactType: "analysis.locations",
          refId: "locations",
          data: data.locations,
          trace,
          persist: () =>
            upsertNovelLocations(userId, input.projectId, data.locations),
        }),
        persistAnalysisPart({
          hooks,
          artifactType: "analysis.props",
          refId: "props",
          data: data.props,
          trace,
          persistTrace: false,
          persist: () =>
            upsertProductionProps(userId, input.projectId, data.props),
        }),
      ]);
      if (persisted[0].status === "fulfilled") locations = persisted[0].value;
      if (persisted[1].status === "fulfilled") props = persisted[1].value;
      const failed = persisted.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failed) throw failed.reason;
    },
  });
  if (!characters || !locations || !props)
    throw new Error("NOVEL_PARSE_PERSIST_FAILED");
  return {
    characters,
    locations,
    props,
    analysis: {
      characters: parsed.characters,
      locations: parsed.locations,
      props: parsed.props,
    },
    promptTraces: parsed.promptTraces,
    sourceLength: sourceText.length,
  };
}

async function persistAnalysisPart<T>(input: {
  hooks?: NovelParseRuntimeHooks;
  artifactType: string;
  refId: string;
  data: unknown;
  trace: PromptExecutionTrace;
  persistTrace?: boolean;
  persist: () => Promise<T>;
}) {
  await input.hooks?.assertActive();
  const persisted = await input.persist();
  await input.hooks?.persistArtifact(input.artifactType, input.refId, {
    data: input.data,
    trace: input.trace,
  });
  if (input.persistTrace !== false)
    await input.hooks?.persistArtifact(
      "prompt.trace",
      input.trace.promptId,
      input.trace,
    );
  return persisted;
}

async function requestNovelParse(
  userId: string,
  input: NovelParseInput,
  sourceText: string,
  callbacks?: {
    onCharacters: (
      data: NovelParseOutput["characters"],
      trace: PromptExecutionTrace,
    ) => Promise<void>;
    onAssets: (
      data: {
        locations: NovelParseOutput["locations"];
        props: NovelParseOutput["props"];
      },
      trace: PromptExecutionTrace,
    ) => Promise<void>;
  },
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
  const analysis = await Promise.allSettled([
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
    }).then(async (result) => {
      await callbacks?.onCharacters(result.data.characters, result.trace);
      return result;
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
    }).then(async (result) => {
      await callbacks?.onAssets(result.data, result.trace);
      return result;
    }),
  ]);
  const failed = analysis.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed) throw failed.reason;
  if (
    analysis[0].status !== "fulfilled" ||
    analysis[1].status !== "fulfilled"
  )
    throw new Error("NOVEL_ANALYSIS_INCOMPLETE");
  const characterResult = analysis[0].value;
  const assetResult = analysis[1].value;
  return {
    characters: characterResult.data.characters,
    locations: assetResult.data.locations,
    props: assetResult.data.props,
    promptTraces: [characterResult.trace, assetResult.trace],
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
