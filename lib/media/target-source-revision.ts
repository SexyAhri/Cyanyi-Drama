import { createHash } from "node:crypto";
import { prisma } from "@/lib/server/prisma";
import { storyboardSourceFingerprintForPanel, storyboardSourceFingerprintForPanelLegacy } from "./storyboard-source-revision";
import { canvasAssetTargets, canvasDocumentSchema } from "@/lib/studio/canvas-document";
import { resolveCanvasGeneration } from "@/lib/studio/canvas-generation";

export function fingerprintCanvasGenerationSource(input: {
  prompt: string;
  references: Array<{ assetId: string; role: string }>;
  targets: Array<{ entityType: string; entityId: string }>;
  kind: "image" | "video";
}) {
  return createHash("sha256").update(JSON.stringify({ prompt: input.prompt, references: input.references, targets: input.targets, kind: input.kind })).digest("hex");
}

export function fingerprintMediaTargetSource(source: unknown, request: Record<string, unknown>) {
  const references = [
    ...(Array.isArray(request.referenceImages) ? request.referenceImages : []),
    ...(Array.isArray(request.referenceAudios) ? request.referenceAudios : []),
  ].map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const reference = value as Record<string, unknown>;
    const url = typeof reference.url === "string" ? reference.url : "";
    return {
      assetId: reference.assetId ?? null,
      storageKey: reference.storageKey ?? null,
      urlHash: url ? createHash("sha256").update(url).digest("hex") : null,
      mimeType: reference.mimeType ?? null,
      role: reference.role ?? null,
    };
  });
  return createHash("sha256").update(JSON.stringify({ source, references })).digest("hex");
}

export function fingerprintStoryboardPanelSource(
  panel: Parameters<typeof storyboardSourceFingerprintForPanel>[0],
  referencedAssets: unknown,
  request: Record<string, unknown>,
) {
  return fingerprintMediaTargetSource(
    { panel: storyboardSourceFingerprintForPanel(panel, request), referencedAssets },
    request,
  );
}

/** Build a compact revision of the editable source behind a generated target. */
export async function captureMediaTargetSourceRevision(input: {
  userId: string;
  projectId: string | null;
  episodeId: string | null;
  targetType: string | null;
  targetId: string | null;
  revisionVersion?: number;
  request: Record<string, unknown>;
}) {
  const { userId, projectId, episodeId, targetType, targetId, request } = input;
  const revisionVersion = input.revisionVersion ?? (targetType === "canvas_node" ? 3 : 2);
  if (!targetType || !targetId) return undefined;
  let source: unknown;

  if (targetType === "storyboard_panel") {
    const panel = await prisma.storyboardPanel.findFirst({
      where: { id: targetId, storyboard: { project: { userId } } },
      select: {
        clipId: true, description: true, videoPrompt: true, voiceoverText: true,
        lipSyncText: true, imagePrompt: true, imagePromptDesignJson: true,
        videoPromptDesignJson: true, firstLastFramePromptDesignJson: true,
        firstLastFramePrompt: true, startStateJson: true, endStateJson: true,
        motionBeatsJson: true, worldContextJson: true, imageAssetId: true,
        videoAssetId: true,
        charactersJson: true,
        propsJson: true,
        locationName: true,
        clip: { select: { content: true, screenplay: true } },
        voiceLines: { orderBy: { lineIndex: "asc" }, select: { speaker: true, content: true, delivery: true } },
        storyboard: { select: { projectId: true, episode: { select: { novelText: true, activeSourceId: true } } } },
      },
    });
    if (panel) {
      if (revisionVersion >= 2) {
        source = {
          fingerprint: fingerprintStoryboardPanelSource(
            panel,
            await loadReferencedPanelAssets(
            userId,
            panel.storyboard.projectId,
            panel,
            ),
            request,
          ),
        };
      } else {
        source = storyboardSourceFingerprintForPanelLegacy(panel, request);
      }
    }
  } else if (targetType === "character_appearance") {
    source = await prisma.characterAppearance.findFirst({
      where: { id: targetId, character: { projectId: projectId ?? undefined, project: { userId } } },
      select: { description: true, metadataJson: true, selected: true, imageAssetId: true, character: { select: { name: true, profileJson: true, visualProfileJson: true, appearances: { select: { id: true, selected: true, imageAssetId: true } } } } },
    });
  } else if (targetType === "location_image") {
    source = await prisma.locationImage.findFirst({
      where: { id: targetId, location: { projectId: projectId ?? undefined, project: { userId } } },
      select: { description: true, availableSlots: true, metadataJson: true, selected: true, imageAssetId: true, location: { select: { name: true, summary: true, visualProfileJson: true, selectedImageId: true, images: { select: { id: true, selected: true, imageAssetId: true } } } } },
    });
  } else if (targetType === "prop") {
    source = await prisma.novelProp.findFirst({
      where: { id: targetId, projectId: projectId ?? undefined, project: { userId } },
      select: { name: true, summary: true, metadataJson: true, visualProfileJson: true },
    });
  } else if (targetType === "global_character_appearance") {
    source = await prisma.globalCharacterAppearance.findFirst({
      where: { id: targetId, character: { userId } },
      select: { changeReason: true, artStyle: true, description: true, imageAssetId: true, selectedIndex: true, character: { select: { name: true, aliases: true, profileData: true, profileConfirmed: true, appearances: { select: { id: true, imageAssetId: true, selectedIndex: true, description: true } } } } },
    });
  } else if (targetType === "global_location_image") {
    source = await prisma.globalLocationImage.findFirst({
      where: { id: targetId, location: { userId } },
      select: { description: true, imageAssetId: true, isSelected: true, location: { select: { name: true, summary: true, artStyle: true, images: { select: { id: true, imageAssetId: true, isSelected: true } } } } },
    });
  } else if (targetType === "voice_line") {
    source = await prisma.voiceLine.findFirst({
      where: { id: targetId, episode: { projectId: projectId ?? undefined, project: { userId } } },
      select: { speaker: true, content: true, delivery: true, matchedPanelId: true },
    });
  } else if (targetType === "canvas_node" && episodeId) {
    const canvas = await prisma.creativeCanvas.findFirst({
      where: { episodeId, episode: { projectId: projectId ?? undefined, project: { userId } } },
      select: { revision: true, document: true },
    });
    if (canvas) {
      if (revisionVersion >= 3) {
        const parsed = canvasDocumentSchema.safeParse(canvas.document);
        const node = parsed.success ? parsed.data.nodes.find((item) => item.id === targetId) : undefined;
        let fingerprint: string;
        if (parsed.success && node && projectId) {
          const kind = request.format === "mp4" || request.videoMode ? "video" : "image";
          try {
            const compiled = await resolveCanvasGeneration({ document: parsed.data, node, kind, userId, projectId, episodeId });
            fingerprint = fingerprintCanvasGenerationSource({ prompt: compiled.prompt, references: compiled.references, targets: kind === "image" ? canvasAssetTargets(node, parsed.data) : [], kind });
          } catch {
            // Deleted or inaccessible inputs invalidate the result instead of attaching it.
            fingerprint = fingerprintMediaTargetSource({ unavailableCanvasInput: targetId }, {});
          }
        } else fingerprint = fingerprintMediaTargetSource({ missingCanvasNode: targetId }, {});
        return { targetType, targetId, revisionVersion, fingerprint };
      }
      const document = canvas.document as { nodes?: Array<{ id?: string }> };
      source = { revision: canvas.revision, node: document.nodes?.find((node) => node.id === targetId) ?? null };
    }
  }

  if (source === undefined || source === null) return undefined;
  const extra = targetType === "storyboard_panel" && typeof request.videoSegmentId === "string"
    ? await prisma.storyboardVideoSegment.findFirst({
        where: { id: request.videoSegmentId, panelId: targetId, panel: { storyboard: { projectId: projectId ?? undefined, episodeId: episodeId ?? undefined, project: { userId } } } },
        select: { segmentIndex: true, startSeconds: true, endSeconds: true, durationSeconds: true, prompt: true, action: true, model: true, mode: true },
      })
    : null;
  const fingerprint = fingerprintMediaTargetSource({ source, extra }, request);
  return { targetType, targetId, revisionVersion, fingerprint };
}

async function loadReferencedPanelAssets(
  userId: string,
  projectId: string,
  panel: { charactersJson: string | null; propsJson: string | null; locationName: string | null },
) {
  const characterNames = parseNames(panel.charactersJson);
  const propNames = parseNames(panel.propsJson);
  const [characters, locations, props] = await Promise.all([
    characterNames.length
      ? prisma.novelCharacter.findMany({
          where: { projectId, project: { userId }, name: { in: characterNames } },
          orderBy: { name: "asc" },
          select: {
            name: true,
            profileJson: true,
            visualProfileJson: true,
            appearances: {
              where: { selected: true },
              orderBy: { appearanceIndex: "asc" },
              select: {
                id: true,
                appearanceIndex: true,
                description: true,
                metadataJson: true,
                imageAssetId: true,
                imageAsset: { select: { storageKey: true, mimeType: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    panel.locationName
      ? prisma.novelLocation.findMany({
          where: { projectId, project: { userId }, name: panel.locationName },
          orderBy: { name: "asc" },
          select: {
            name: true,
            summary: true,
            visualProfileJson: true,
            selectedImageId: true,
            selectedImage: {
              select: {
                id: true,
                description: true,
                imageAssetId: true,
                imageAsset: { select: { storageKey: true, mimeType: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    propNames.length
      ? prisma.novelProp.findMany({
          where: { projectId, project: { userId }, name: { in: propNames } },
          orderBy: { name: "asc" },
          select: { id: true, name: true, summary: true, visualProfileJson: true, metadataJson: true },
        })
      : Promise.resolve([]),
  ]);
  const propReferences = props.length
    ? await prisma.assetReference.findMany({
        where: { projectId, entityType: "prop", role: "selected", entityId: { in: props.map((prop) => prop.id) } },
        orderBy: { entityId: "asc" },
        select: {
          entityId: true,
          mediaAssetId: true,
          mediaAsset: { select: { storageKey: true, mimeType: true } },
        },
      })
    : [];
  return { characters, locations, props, propReferences };
}

function parseNames(value: string | null) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((name): name is string => typeof name === "string" && Boolean(name.trim())))].sort();
  } catch {
    return [];
  }
}
