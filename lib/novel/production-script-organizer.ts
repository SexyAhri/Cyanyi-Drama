import { screenplayConversionSchema } from "@/lib/prompts/schemas";
import {
  listProductionClips,
  listProductionProps,
  upsertProductionProps,
} from "@/lib/production/domain-store";
import { prisma } from "@/lib/server/prisma";

import {
  listNovelCharacters,
  listNovelLocations,
  upsertNovelCharacters,
  upsertNovelLocations,
} from "./domain-store";
import {
  organizeApprovedScreenplayClip,
  parseApprovedScreenplay,
} from "./approved-screenplay-parser";
import { splitEpisodeIntoClips } from "./story-to-script-runtime";
import { assembleSceneLocally } from "./staged-screenplay-runtime";

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

  const catalog = extractProductionScriptCatalog(sourceText);
  const persistedCatalog = await ensureCatalogEntries(
    userId,
    input.projectId,
    catalog,
  );
  await hooks.persistArtifact("production-script.catalog", input.episodeId, {
    ...catalog,
    persisted: persistedCatalog,
    source: "local-production-script",
  });

  const split = await splitEpisodeIntoClips(
    userId,
    {
      ...input,
      channelId: "local",
      model: "local-production-script",
    },
    hooks,
  );
  const clips = await listProductionClips(
    userId,
    input.projectId,
    input.episodeId,
  );
  if (!clips?.length) throw new Error("STORY_CLIPS_REQUIRED");

  const [characters, locations] = await Promise.all([
    listNovelCharacters(userId, input.projectId),
    listNovelLocations(userId, input.projectId),
  ]);
  const props = await listProductionProps(userId, input.projectId);
  if (!characters || !locations || !props)
    throw new Error("STORY_PROJECT_NOT_FOUND");
  const canonical = {
    characters: characters.map((item) => item.name),
    locations: locations.map((item) => item.name),
    props: props.map((item) => item.name),
  };

  const results = [];
  for (const clip of clips) {
    await hooks.assertActive();
    const organized = organizeApprovedScreenplayClip(
      clip.id,
      clip.content,
      canonical,
    );
    const scenes = organized.beats.scenes.map((scene, sceneIndex) =>
      assembleSceneLocally({
        scene,
        dialogue: organized.dialogue.lines.filter(
          (line) => line.sceneIndex === sceneIndex,
        ),
        narration: organized.narration.lines.filter(
          (line) => line.sceneIndex === sceneIndex,
        ),
        effects: organized.effects.designs.filter(
          (design) => design.sceneIndex === sceneIndex,
        ),
      }).scene,
    );
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
    const result = {
      clipId: clip.id,
      clipIndex: clip.clipIndex,
      sceneCount: screenplay.scenes.length,
      screenplay,
    };
    await hooks.persistArtifact("screenplay.clip", clip.id, result);
    results.push(result);
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
    promptTraces: [],
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
