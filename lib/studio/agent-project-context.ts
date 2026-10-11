import {
  listNovelCharacters,
  listNovelLocations,
} from "@/lib/novel/domain-store";
import { listProductionProps } from "@/lib/production/domain-store";
import { parseAssetVisualProfile, isAssetVisualProfileComplete } from "@/lib/assets/visual-profile";
import { buildAssetGenerationPrompt } from "@/lib/assets/generation-prompt";
import { prisma } from "@/lib/server/prisma";
import { canvasDocumentSchema } from "./canvas-document";
import { Prisma } from "@prisma/client";

function readJson(value: string | null) {
  try {
    return value ? (JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
}

export async function loadAgentProjectContext(input: {
  userId: string;
  projectId: string;
  episodeId?: string;
  selectionId?: string;
  request: string;
  detailIds?: string[];
  artStyle?: string;
}) {
  const owned = {
    projectId: input.projectId,
    project: { userId: input.userId },
  };
  const episodeIndexRows = await prisma.episode.findMany({ where: owned,
    orderBy: { episodeNumber: "asc" }, take: 500, select: { id: true, name: true, episodeNumber: true,
      activeSourceKind: true, _count: { select: { clips: true, voiceLines: true } },
      clips: { where: { screenplay: null }, take: 1, select: { id: true } },
      storyboard: { select: { _count: { select: { panels: true } } } } } });
  const detailIds = input.detailIds ?? [];
  const matchingIds = episodeIndexRows.filter(item => item.id === input.episodeId || detailIds.includes(item.id) ||
    input.request.includes(item.name) || input.request.includes(`第${item.episodeNumber}集`)).map(item => item.id);
  const [
    episodes,
    characters,
    locations,
    props,
    presets,
    deliverables,
    media,
    manuscripts,
  ] = await Promise.all([
    prisma.episode.findMany({
      where: { ...owned, OR: [
        { id: { in: [...matchingIds, ...(input.episodeId ? [input.episodeId] : [])] } },
        { sourceVersions: { some: { id: { in: detailIds } } } },
        { storyboard: { panels: { some: { id: { in: detailIds } } } } },
        { voiceLines: { some: { id: { in: detailIds } } } },
      ] },
      take: 8,
      orderBy: { episodeNumber: "asc" },
      select: {
        id: true,
        name: true,
        episodeNumber: true,
        activeSourceKind: true,
        clips: { take: 200, select: { status: true } },
        sourceVersions: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            kind: true,
            version: true,
            title: true,
          },
        },
        storyboard: {
          select: {
            version: true,
            status: true,
            panels: {
              take: 100,
              orderBy: { panelIndex: "asc" },
              select: {
                id: true,
                panelIndex: true,
                description: true,
                locationName: true,
                charactersJson: true,
                propsJson: true,
                imagePrompt: true,
                videoPrompt: true,
                speakingCharacter: true,
                lipSyncText: true,
                voiceoverText: true,
                durationSeconds: true,
                cameraMove: true,
                shotType: true,
                startStateJson: true,
                endStateJson: true,
                imageAssetId: true,
                videoAssetId: true,
                status: true,
              },
            },
          },
        },
        voiceLines: {
          take: 100,
          orderBy: { lineIndex: "asc" },
          select: {
            id: true,
            lineIndex: true,
            speaker: true,
            content: true,
            voiceProfilePrompt: true,
            emotionPrompt: true,
            voicePresetId: true,
            audioAssetId: true,
            matchedPanelId: true,
            durationSeconds: true,
            status: true,
          },
        },
        editorProject: {
          select: {
            renderStatus: true,
            outputAssetId: true,
            timelineJson: true,
            subtitleJson: true,
          },
        },
        canvas: { select: { revision: true, document: true } },
      },
    }),
    listNovelCharacters(input.userId, input.projectId),
    listNovelLocations(input.userId, input.projectId),
    listProductionProps(input.userId, input.projectId),
    prisma.voicePreset.findMany({
      where: {
        userId: input.userId,
        OR: [{ projectId: input.projectId }, { projectId: null }],
      },
      select: {
        id: true,
        name: true,
        description: true,
        language: true,
        gender: true,
      },
    }),
    prisma.productionDeliverable.findMany({
      where: { projectId: input.projectId, userId: input.userId },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        episodeId: true,
        deliverableType: true,
        status: true,
        version: true,
      },
    }),
    prisma.mediaAsset.findMany({
      where: { task: { userId: input.userId, projectId: input.projectId } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        kind: true,
        mimeType: true,
        references: {
          where: { projectId: input.projectId },
          select: { entityType: true, entityId: true, role: true },
        },
        task: {
          select: {
            status: true,
            targetId: true,
            targetType: true,
            episodeId: true,
          },
        },
      },
    }),
    prisma.manuscript.findMany({
      where: owned,
      take: 50,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        author: true,
        synopsis: true,
        sourceFileName: true,
        charCount: true,
      },
    }),
  ]);
  const sourcePresence = episodeIndexRows.length ? await prisma.$queryRaw<Array<{ id: string; present: boolean }>>(Prisma.sql`
    SELECT id, COALESCE(length(trim(novel_text)) > 0, false) AS present FROM episodes
    WHERE id IN (${Prisma.join(episodeIndexRows.map(item => item.id))})`) : [];
  const originalPlans = await prisma.$queryRaw<Array<{ id: string; title: string; episodeIds: string[]; outlines: unknown }>>(Prisma.sql`
    SELECT id, title, payload->'adoption'->'episodeIds' AS "episodeIds", payload->'storyPackage'->'episodeOutlines' AS outlines
    FROM production_deliverables WHERE project_id = ${input.projectId} AND user_id = ${input.userId}
      AND status IN ('approved', 'locked') AND superseded_at IS NULL AND payload->>'packageFormat' = 'cyanyi-story-package-v1'
      AND payload->'adoption' IS NOT NULL ORDER BY updated_at DESC LIMIT 5`);
  const requestedDeliverables = deliverables.filter(item => detailIds.includes(item.id) || input.request.includes(item.title) ||
    /世界观|制作规范|world|bible/i.test(input.request)).slice(0, 8).map(item => item.id);
  const deliverablePayloads = requestedDeliverables.length ? await prisma.$queryRaw<Array<{ id: string; payload: unknown }>>(Prisma.sql`
    SELECT id, CASE WHEN payload->>'packageFormat' = 'cyanyi-manuscript-dossier-v1'
      THEN jsonb_build_object('packageFormat', payload->'packageFormat', 'summary', payload->'summary',
        'manuscriptId', payload->'manuscriptId', 'sourceHash', payload->'sourceHash') ELSE payload END AS payload
    FROM production_deliverables WHERE id IN (${Prisma.join(requestedDeliverables)})`) : [];
  const episodeTexts = episodes.length ? await prisma.$queryRaw<Array<{ id: string; text: string | null; length: number }>>(Prisma.sql`
    SELECT id, substring(novel_text from 1 for 12000) AS text, char_length(novel_text)::int AS length
    FROM episodes WHERE id IN (${Prisma.join(episodes.map(item => item.id))})`) : [];
  const requestedSourceIds = episodes.flatMap(item => item.sourceVersions.filter((source, index) =>
    detailIds.includes(source.id) || (index < 3 && /原文|稿件|版本|source|version/i.test(input.request))).map(source => source.id));
  const sourceTexts = requestedSourceIds.length ? await prisma.$queryRaw<Array<{ id: string; text: string; length: number }>>(Prisma.sql`
    SELECT id, substring(content from 1 for 12000) AS text, char_length(content)::int AS length
    FROM episode_source_versions WHERE id IN (${Prisma.join(requestedSourceIds)})`) : [];
  const requestedManuscripts = manuscripts.filter(item => detailIds.includes(item.id) || input.request.includes(item.title)).map(item => item.id);
  const manuscriptTexts = requestedManuscripts.length ? await prisma.$queryRaw<Array<{ id: string; text: string; length: number }>>(Prisma.sql`
    SELECT id, substring(source_text from 1 for 12000) AS text, char_length(source_text)::int AS length
    FROM manuscripts WHERE id IN (${Prisma.join(requestedManuscripts)})`) : [];
  const assets = [
    ...(characters ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      kind: "character" as const,
      description: item.introduction,
      visualProfile: item.visualProfile,
      details: item.profile,
      visualDescription:
        item.appearances.find(
          (entry) => entry.selected && entry.description?.trim(),
        )?.description ??
        item.appearances.find((entry) => entry.description?.trim())
          ?.description,
      candidateCount: item.appearances.length,
    })),
    ...(locations ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      kind: "location" as const,
      description: item.summary,
      visualProfile: item.visualProfile,
      details: undefined,
      visualDescription:
        item.images.find((entry) => entry.selected && entry.description?.trim())
          ?.description ??
        item.images.find((entry) => entry.description?.trim())?.description,
      candidateCount: item.images.length,
    })),
    ...(props ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      kind: "prop" as const,
      description: item.summary,
      visualProfile: item.visualProfile,
      details: item.metadata,
      visualDescription: undefined,
      candidateCount: media.filter((asset) =>
        asset.references.some(
          (ref) => ref.entityType === "prop" && ref.entityId === item.id,
        ),
      ).length,
    })),
  ];
  const detailedEpisodes = episodes.filter(
    (item) =>
      input.detailIds?.includes(item.id) ||
      item.sourceVersions.some((source) =>
        input.detailIds?.includes(source.id),
      ) ||
      item.storyboard?.panels.some((panel) =>
        input.detailIds?.includes(panel.id),
      ) ||
      item.voiceLines.some((line) => input.detailIds?.includes(line.id)) ||
      canvasDocumentSchema
        .safeParse(item.canvas?.document)
        .data?.nodes.some(
          (node) =>
            input.detailIds?.includes(node.id) ||
            input.request.includes(node.title),
        ) ||
      item.id === input.episodeId ||
      input.request.includes(item.name) ||
      input.request.includes(`第${item.episodeNumber}集`) ||
      input.request.includes(`episode ${item.episodeNumber}`),
  );
  return {
    coverage: {
      expandedObjectIds: input.detailIds ?? [],
      source: "saved_project_data",
      mediaLimit: 200,
      deliverableLimit: 100,
      detailTextLimit: 12000,
      episodeIndexLimit: 500,
      episodeDetailLimit: 8,
      otherAssetsHaveSummaries: true,
    },
    originalPlans,
    episodeIndex: episodeIndexRows.map((item) => ({
      id: item.id,
      name: item.name,
      number: item.episodeNumber,
      hasScript: sourcePresence.find(row => row.id === item.id)?.present ?? false,
      hasStructuredScript: item._count.clips > 0 && item.clips.length === 0,
      sourceKind: item.activeSourceKind,
      canContinueOriginal: item.episodeNumber > 1 && originalPlans.some(plan => plan.episodeIds?.includes(item.id)) &&
        Boolean(episodeIndexRows.some(previous => previous.episodeNumber === item.episodeNumber - 1 && sourcePresence.find(row => row.id === previous.id)?.present)),
      shotCount: item.storyboard?._count.panels ?? 0,
      voiceLineCount: item._count.voiceLines,
      canvasNodeCount: 0,
    })),
    manuscripts: manuscripts.map(item => ({
      ...item,
      ...(input.detailIds?.includes(item.id) ||
      input.request.includes(item.title)
        ? {
            text: manuscriptTexts.find(row => row.id === item.id)?.text ?? "",
            truncated: item.charCount > 12000,
          }
        : {}),
    })),
    assets: assets.map((item) => {
      const detailed =
        input.detailIds?.includes(item.id) ||
        item.id === input.selectionId ||
        input.request.includes(item.name) ||
        /全部资产|所有角色|所有场景|所有道具|all assets|all characters|all locations/i.test(
          input.request,
        );
      const profile = parseAssetVisualProfile(item.visualProfile);
      return {
        id: item.id,
        name: item.name,
        kind: item.kind,
        description: item.description,
        candidateCount: item.candidateCount,
        hasVisualProfile: Boolean(profile),
        ...(detailed
          ? {
              visualSpec: profile?.spec ?? null,
              visualProfileReady: isAssetVisualProfileComplete(profile),
              generationPrompt: buildAssetGenerationPrompt({
                ...item,
                visualProfile: profile,
                artStyle: input.artStyle,
              }),
            }
          : {}),
      };
    }),
    episodes: detailedEpisodes.map((item) => {
      const canvas = canvasDocumentSchema.safeParse(item.canvas?.document);
      return {
        id: item.id,
        name: item.name,
        number: item.episodeNumber,
        sourceKind: item.activeSourceKind,
        script: episodeTexts.find(row => row.id === item.id)?.text ?? null,
        scriptTruncated: (episodeTexts.find(row => row.id === item.id)?.length ?? 0) > 12000,
        sourceVersions: item.sourceVersions.map((source) => ({
          id: source.id,
          kind: source.kind,
          version: source.version,
          title: source.title,
          ...(input.detailIds?.includes(source.id) ||
          (item.sourceVersions.indexOf(source) < 3 &&
            ((source.title && input.request.includes(source.title)) ||
              /原文|稿件|版本|source|version/i.test(input.request)))
            ? {
                text: sourceTexts.find(row => row.id === source.id)?.text ?? "",
                truncated: (sourceTexts.find(row => row.id === source.id)?.length ?? 0) > 12000,
              }
            : {}),
        })),
        storyboard: item.storyboard,
        voiceLines: item.voiceLines,
        editor: item.editorProject
          ? {
              renderStatus: item.editorProject.renderStatus,
              outputAssetId: item.editorProject.outputAssetId,
              timeline: readJson(item.editorProject.timelineJson),
              subtitles: readJson(item.editorProject.subtitleJson),
            }
          : null,
        canvas: canvas.success
          ? {
              revision: item.canvas!.revision,
              nodes: canvas.data.nodes,
              edges: canvas.data.edges,
            }
          : null,
      };
    }),
    objectIndex: episodes.flatMap((item) => {
      const canvas = canvasDocumentSchema.safeParse(item.canvas?.document);
      return [
        ...item.sourceVersions.map((source) => ({
          id: source.id,
          name: `${item.name} · ${source.title} · ${source.kind} ${source.version}`,
          kind: "source_version",
          episodeId: item.id,
        })),
        ...(item.storyboard?.panels.map((panel) => ({
          id: panel.id,
          name: `${item.name} · 镜头 ${panel.panelIndex + 1}`,
          kind: "shot",
          episodeId: item.id,
        })) ?? []),
        ...item.voiceLines.map((line) => ({
          id: line.id,
          name: `${item.name} · ${line.speaker} · 台词 ${line.lineIndex + 1}`,
          kind: "voice_line",
          episodeId: item.id,
        })),
        ...(canvas.success
          ? canvas.data.nodes.map((node) => ({
              id: node.id,
              name: `${item.name} · ${node.title}`,
              kind: "canvas_node",
              episodeId: item.id,
            }))
          : []),
      ];
    }),
    voicePresets: presets,
    deliverables: deliverables.map(item => ({
      ...item,
      ...(input.detailIds?.includes(item.id) ||
      input.request.includes(item.title) ||
      /世界观|制作规范|world|bible/i.test(input.request)
        ? { payload: deliverablePayloads.find(row => row.id === item.id)?.payload ?? null }
        : {}),
    })),
    media,
  };
}
