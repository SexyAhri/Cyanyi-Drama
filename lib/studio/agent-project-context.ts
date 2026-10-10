import {
  listNovelCharacters,
  listNovelLocations,
} from "@/lib/novel/domain-store";
import { listProductionProps } from "@/lib/production/domain-store";
import { parseAssetVisualProfile } from "@/lib/assets/visual-profile";
import { buildAssetGenerationPrompt } from "@/lib/assets/generation-prompt";
import { prisma } from "@/lib/server/prisma";
import { canvasDocumentSchema } from "./canvas-document";

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
      where: owned,
      orderBy: { episodeNumber: "asc" },
      select: {
        id: true,
        name: true,
        episodeNumber: true,
        novelText: true,
        activeSourceKind: true,
        clips: { select: { screenplay: true } },
        sourceVersions: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            kind: true,
            version: true,
            title: true,
            content: true,
          },
        },
        storyboard: {
          select: {
            version: true,
            status: true,
            panels: {
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
        payload: true,
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
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        author: true,
        synopsis: true,
        sourceFileName: true,
        charCount: true,
        sourceText: true,
      },
    }),
  ]);
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
      detailTextLimit: 30000,
      otherAssetsHaveSummaries: true,
    },
    episodeIndex: episodes.map((item) => ({
      id: item.id,
      name: item.name,
      number: item.episodeNumber,
      hasScript: Boolean(item.novelText?.trim()),
      hasStructuredScript: Boolean(
        item.clips.length && item.clips.every((clip) => clip.screenplay),
      ),
      sourceKind: item.activeSourceKind,
      shotCount: item.storyboard?.panels.length ?? 0,
      voiceLineCount: item.voiceLines.length,
      canvasNodeCount:
        canvasDocumentSchema.safeParse(item.canvas?.document).data?.nodes
          .length ?? 0,
    })),
    manuscripts: manuscripts.map(({ sourceText, ...item }) => ({
      ...item,
      ...(input.detailIds?.includes(item.id) ||
      input.request.includes(item.title)
        ? {
            text: sourceText.slice(0, 30000),
            truncated: sourceText.length > 30000,
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
        script: item.novelText?.slice(0, 30000) ?? null,
        scriptTruncated: (item.novelText?.length ?? 0) > 30000,
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
                text: source.content.slice(0, 30000),
                truncated: source.content.length > 30000,
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
    deliverables: deliverables.map(({ payload, ...item }) => ({
      ...item,
      ...(input.detailIds?.includes(item.id) ||
      input.request.includes(item.title) ||
      /世界观|制作规范|world|bible/i.test(input.request)
        ? { payload }
        : {}),
    })),
    media,
  };
}
