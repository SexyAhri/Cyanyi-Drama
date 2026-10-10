import { z } from "zod";
import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import { resolveEpisodeTextProvider } from "@/lib/episodes/provider";
import { PROMPT_IDS, renderPrompt } from "@/lib/prompts";
import {
  productionScriptOrganizationSchema as organizationSchema,
  screenplayConversionSchema,
} from "@/lib/prompts/schemas";
import {
  listProductionProps,
  saveProductionClips,
  upsertProductionProps,
} from "@/lib/production/domain-store";
import { prisma } from "@/lib/server/prisma";

import {
  listNovelCharacters,
  listNovelLocations,
  upsertNovelCharacters,
  upsertNovelLocations,
} from "./domain-store";
import { parseApprovedScreenplay } from "./approved-screenplay-parser";
import {
  buildSourceUnits,
  restoreSourceBackedClips,
} from "./story-to-script-runtime";

export type ProductionScriptCatalog = {
  characters: string[];
  locations: string[];
  props: string[];
  declared: {
    characters: string[];
    locations: string[];
    props: string[];
  };
  dialogueSpeakers: string[];
};

type OrganizerHooks = {
  assertActive: () => Promise<void>;
  persistArtifact: (
    artifactType: string,
    refId: string,
    payload: unknown,
  ) => Promise<void>;
  loadRunArtifact?: (
    artifactType: string,
    refId: string,
  ) => Promise<unknown | null>;
};

function normalizeOrganizationPayload(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.scenes)) return value;
  return {
    ...payload,
    scenes: payload.scenes.map((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const entry = item as Record<string, unknown>;
      if (
        !entry.scene ||
        typeof entry.scene !== "object" ||
        Array.isArray(entry.scene)
      )
        return item;
      const scene = entry.scene as Record<string, unknown>;
      if (!Array.isArray(scene.content)) return item;
      return {
        ...entry,
        scene: {
          ...scene,
          content: scene.content.flatMap((item: unknown) => {
            if (!item || typeof item !== "object" || Array.isArray(item))
              return [item];
            const line = item as Record<string, unknown>;
            if (
              line.type !== "dialogue" ||
              !Array.isArray(line.lines) ||
              !line.lines.length ||
              !line.lines.every((text) => typeof text === "string")
            )
              return [item];
            return line.lines.map((text) => ({ ...line, lines: text }));
          }),
        },
      };
    }),
  };
}

export function extractProductionScriptCatalog(
  sourceText: string,
): ProductionScriptCatalog {
  const scenes = parseApprovedScreenplay(sourceText);
  const declared = readDeclaredAssets(sourceText);
  const dialogueSpeakers = unique(
    scenes.flatMap((scene) =>
      scene.lines.flatMap((line) => (line.character ? [line.character] : [])),
    ),
  );
  const sceneLocations = scenes.flatMap((scene) =>
    scene.location && scene.location !== "未指定场景" ? [scene.location] : [],
  );
  return {
    characters: unique([...declared.characters, ...dialogueSpeakers]),
    locations: unique([...declared.locations, ...sceneLocations]),
    props: declared.props,
    declared,
    dialogueSpeakers,
  };
}

export async function organizeEpisodeProductionScript(
  userId: string,
  input: {
    projectId: string;
    episodeId: string;
    sourceText?: string;
    channelId: string;
    model: string;
    locale?: "zh" | "en";
  },
  hooks: OrganizerHooks,
) {
  await hooks.assertActive();
  const episode = await prisma.episode.findFirst({
    where: {
      id: input.episodeId,
      projectId: input.projectId,
      project: { userId },
    },
    select: { novelText: true },
  });
  if (!episode) throw new Error("STORY_EPISODE_NOT_FOUND");
  const sourceText = input.sourceText ?? episode.novelText;
  if (!sourceText?.trim()) throw new Error("STORY_SOURCE_TEXT_REQUIRED");

  if (!input.channelId || !input.model)
    throw new Error("请先选择用于 AI 整理的分析模型与渠道");
  const [characters, locations, props, provider] = await Promise.all([
    listNovelCharacters(userId, input.projectId),
    listNovelLocations(userId, input.projectId),
    listProductionProps(userId, input.projectId),
    resolveEpisodeTextProvider({
      userId,
      channelId: input.channelId,
      model: input.model,
    }),
  ]);
  if (!characters || !locations || !props)
    throw new Error("STORY_PROJECT_NOT_FOUND");
  const units = buildSourceUnits(sourceText);
  const modelClips = (data: z.infer<typeof organizationSchema>) =>
    data.scenes.map((item) => ({
      endUnitId: item.endUnitId,
      summary: item.summary,
      location: item.scene.heading.location,
      characters: item.scene.characters,
      props: item.props,
    }));
  const result = await requestOpenAiStructured({
    ...provider,
    temperature: 0.1,
    prompt: renderPrompt({
      id: PROMPT_IDS.PRODUCTION_SCRIPT_ORGANIZATION,
      locale: input.locale ?? "zh",
      variables: {
        source_units_json: JSON.stringify(units),
        asset_library_json: JSON.stringify({
          characters: characters.map((item) => item.name),
          locations: locations.map((item) => item.name),
          props: props.map((item) => item.name),
        }),
      },
    }),
    schema: organizationSchema,
    normalizeRaw: normalizeOrganizationPayload,
    validate: (data) => {
      try {
        const restored = restoreSourceBackedClips(modelClips(data), units);
        return data.scenes.flatMap((item, index) =>
          item.scene.content.flatMap((line, lineIndex) => {
            if (line.type === "action") return [];
            const text = line.type === "dialogue" ? line.lines : line.text;
            return restored[index].text
              .replace(/\s/gu, "")
              .includes(text.replace(/\s/gu, ""))
              ? []
              : [
                  {
                    code: "SPOKEN_TEXT_NOT_IN_SOURCE",
                    path: `scenes.${index}.scene.content.${lineIndex}`,
                    message: "对白或旁白必须保留本场原文，不得改写或新增",
                  },
                ];
          }),
        );
      } catch {
        return [
          {
            code: "SOURCE_COVERAGE_INVALID",
            path: "scenes",
            message: "场次必须按顺序完整覆盖原文单元",
          },
        ];
      }
    },
  });
  await hooks.assertActive();
  const currentEpisode = await prisma.episode.findFirst({
    where: {
      id: input.episodeId,
      projectId: input.projectId,
      project: { userId },
    },
    select: { novelText: true },
  });
  if (!currentEpisode || currentEpisode.novelText !== episode.novelText)
    throw new Error("整理期间剧本已修改，请重新运行 AI 整理");
  for (const item of result.data.scenes) {
    item.scene.characters = unique([
      ...item.scene.characters,
      ...item.scene.content.flatMap((line) =>
        line.type === "dialogue" ? [line.character] : [],
      ),
    ]);
  }
  await hooks.persistArtifact(
    "production-script.organization",
    input.episodeId,
    result.data,
  );
  await hooks.persistArtifact("prompt.trace", input.episodeId, result.trace);
  await hooks.persistArtifact(
    "production-script.organization.raw",
    input.episodeId,
    { rawOutput: result.outputText },
  );
  const dialogueSpeakers = unique(
    result.data.scenes.flatMap((item) =>
      item.scene.content.flatMap((line) =>
        line.type !== "action" && line.character ? [line.character] : [],
      ),
    ),
  );
  const catalog: ProductionScriptCatalog = {
    characters: unique([
      ...result.data.assets.characters,
      ...dialogueSpeakers,
      ...result.data.scenes.flatMap((item) => item.scene.characters),
    ]),
    locations: unique(
      [
        ...result.data.assets.locations,
        ...result.data.scenes.map((item) => item.scene.heading.location),
      ].filter(
        (name) => !["未指定场景", "unspecified location"].includes(name),
      ),
    ),
    props: unique([
      ...result.data.assets.props,
      ...result.data.scenes.flatMap((item) => item.props),
    ]),
    declared: result.data.assets,
    dialogueSpeakers,
  };
  const persistedCatalog = await ensureCatalogEntries(
    userId,
    input.projectId,
    catalog,
  );
  await hooks.persistArtifact("production-script.catalog", input.episodeId, {
    ...catalog,
    persisted: persistedCatalog,
    source: "ai-production-script",
  });

  const restored = restoreSourceBackedClips(modelClips(result.data), units);
  await hooks.assertActive();
  const clips = await saveProductionClips(
    userId,
    input.projectId,
    input.episodeId,
    restored.map((clip, clipIndex) => ({
      clipIndex,
      summary: clip.summary,
      content: clip.text,
      startText: clip.start,
      endText: clip.end,
      characters: clip.characters,
      locations: clip.location ? [clip.location] : [],
      props: clip.props,
    })),
  );
  if (!clips?.length) throw new Error("STORY_CLIPS_REQUIRED");

  const split = {
    clipCount: clips.length,
    clips,
    promptTraces: [result.trace],
  };
  await hooks.persistArtifact("clips.split", input.episodeId, split);

  const results = [];
  for (const clip of clips) {
    await hooks.assertActive();
    const scenes = [result.data.scenes[clip.clipIndex].scene];
    const screenplay = screenplayConversionSchema.parse({
      clipId: clip.id,
      originalText: clip.content,
      scenes: scenes.map((scene, sceneNumber) => ({ sceneNumber, ...scene })),
    });
    await prisma.storyClip.update({
      where: { id: clip.id },
      data: {
        screenplay: JSON.stringify(screenplay),
        status: "screenplay_ready",
      },
    });
    const clipResult = {
      clipId: clip.id,
      clipIndex: clip.clipIndex,
      sceneCount: screenplay.scenes.length,
      screenplay,
    };
    await hooks.persistArtifact("screenplay.clip", clip.id, clipResult);
    results.push(clipResult);
  }
  await hooks.persistArtifact("production-script.scenes", input.episodeId, {
    clipCount: results.length,
    sceneCount: results.reduce((count, item) => count + item.sceneCount, 0),
    clips: results.map((item) => ({
      clipId: item.clipId,
      clipIndex: item.clipIndex,
      sceneCount: item.sceneCount,
    })),
  });
  return {
    catalog,
    clipCount: results.length,
    sceneCount: results.reduce((count, item) => count + item.sceneCount, 0),
    split,
    results,
    promptTraces: [result.trace],
  };
}

async function ensureCatalogEntries(
  userId: string,
  projectId: string,
  catalog: ProductionScriptCatalog,
) {
  const [characters, locations, props] = await Promise.all([
    listNovelCharacters(userId, projectId),
    listNovelLocations(userId, projectId),
    listProductionProps(userId, projectId),
  ]);
  if (!characters || !locations || !props)
    throw new Error("STORY_PROJECT_NOT_FOUND");

  const missingCharacters = missingNames(
    catalog.characters,
    characters.map((item) => item.name),
  );
  const missingLocations = missingNames(
    catalog.locations,
    locations.map((item) => item.name),
  );
  const missingProps = missingNames(
    catalog.props,
    props.map((item) => item.name),
  );
  await Promise.all([
    upsertNovelCharacters(
      userId,
      projectId,
      missingCharacters.map((name) => ({ name })),
    ),
    upsertNovelLocations(
      userId,
      projectId,
      missingLocations.map((name) => ({ name })),
    ),
    upsertProductionProps(
      userId,
      projectId,
      missingProps.map((name) => ({ name })),
    ),
  ]);
  return {
    charactersAdded: missingCharacters,
    locationsAdded: missingLocations,
    propsAdded: missingProps,
  };
}

function readDeclaredAssets(sourceText: string) {
  const result = {
    characters: [] as string[],
    locations: [] as string[],
    props: [] as string[],
  };
  for (const rawLine of sourceText.split(/\r?\n/u)) {
    const line = rawLine
      .trim()
      .replace(/^[-*]\s+/u, "")
      .replace(/\*{1,2}|_{1,2}/gu, "")
      .trim();
    const match = line.match(
      /^(角色|人物|characters?|cast|场景|地点|locations?|settings?|道具|props?)(?:资产|清单)?\s*[：:]\s*(.+)$/iu,
    );
    if (!match) continue;
    const key = /^(角色|人物|characters?|cast)$/iu.test(match[1])
      ? "characters"
      : /^(场景|地点|locations?|settings?)$/iu.test(match[1])
        ? "locations"
        : "props";
    result[key].push(...splitAssetNames(match[2]));
  }
  return {
    characters: unique(result.characters),
    locations: unique(result.locations),
    props: unique(result.props),
  };
}

function splitAssetNames(value: string) {
  if (/^(?:无|没有|none|n\/a)\s*[。.!]?$/iu.test(value.trim())) return [];
  return value
    .replace(/^[\[【（(]|[\]】）)]$/gu, "")
    .split(/[、，,；;｜|/]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function missingNames(candidates: string[], existing: string[]) {
  const existingNames = new Set(existing.map(normalizeName));
  return candidates.filter((name) => !existingNames.has(normalizeName(name)));
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const trimmed = value.trim();
    const normalized = normalizeName(trimmed);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, "");
}
