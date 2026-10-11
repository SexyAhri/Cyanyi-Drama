import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import {
  AssetVisualProfileSpecSchema,
  parseAssetVisualProfile,
  type AssetVisualProfile,
  type AssetVisualProfileSpec,
} from "@/lib/assets/visual-profile";
import { StoryPackageSchema } from "./story-package-contract";
import { renderPackageScene, seedPackageProduction } from "./story-package-production";

/** Adoption creates missing production objects; existing work remains authoritative. */
export async function adoptStoryPackage(input: {
  userId: string;
  projectId: string;
  deliverableId: string;
}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const row = await tx.productionDeliverable.findFirst({
            where: {
              id: input.deliverableId,
              projectId: input.projectId,
              userId: input.userId,
              scopeType: "project",
              scopeId: input.projectId,
              deliverableType: "story_bible",
              project: { userId: input.userId },
            },
          });
          if (!row) throw new Error("策划包不存在");
          const payload = row.payload as Record<string, Prisma.JsonValue>;
          if (payload.adoption)
            return { adoption: payload.adoption, reused: true };
          const latest = await tx.productionDeliverable.findFirst({
            where: {
              projectId: input.projectId,
              scopeType: row.scopeType,
              scopeId: row.scopeId,
              deliverableType: row.deliverableType,
            },
            orderBy: { version: "desc" },
            select: { id: true },
          });
          if (
            latest?.id !== row.id ||
            row.supersededAt ||
            ["superseded", "stale", "locked"].includes(row.status)
          )
            throw new Error("策划包版本已变化，请刷新后采用最新版本");
          if (payload.packageFormat !== "cyanyi-story-package-v1")
            throw new Error("策划包格式不支持采用");
          const story = StoryPackageSchema.parse(payload.storyPackage);
          const numbers = story.episodeOutlines.map(
            (item) => item.episodeNumber,
          );
          if (
            numbers.length !== story.format.episodeCount ||
            new Set(numbers).size !== numbers.length ||
            numbers.some((number) => number > story.format.episodeCount) ||
            !numbers.includes(1)
          )
            throw new Error("逐集大纲数量或集号不完整，请修复策划包后再采用");
          const now = new Date();
          const visual = (
            imagePrompt: string,
            visualProfile?: AssetVisualProfileSpec,
          ): string =>
            JSON.stringify({
              version: 1,
              source: "model",
              updatedAt: now.toISOString(),
              projectArtStyle: story.format.artStyle,
              spec: visualProfile
                ? {
                    ...visualProfile,
                    inferenceNotes: [
                      ...visualProfile.inferenceNotes,
                      `策划包 ${row.id} v${row.version}`,
                    ],
                  }
                : {
                    visualIdentity: imagePrompt,
                    shapeAndStructure: "",
                    surfaceAndStyling: "",
                    colorPalette: "",
                    lightingAndPresentation: "",
                    signatureDetails: [],
                    consistencyRules: story.creativeProhibitions,
                    negativePrompt: "",
                    inferenceNotes: [`策划包 ${row.id} v${row.version}`],
                  },
            } satisfies AssetVisualProfile);
          const episodeIds: string[] = [];
          for (const outline of story.episodeOutlines) {
            const episode = await tx.episode.upsert({
              where: {
                projectId_episodeNumber: {
                  projectId: input.projectId,
                  episodeNumber: outline.episodeNumber,
                },
              },
              create: {
                id: randomUUID(),
                projectId: input.projectId,
                episodeNumber: outline.episodeNumber,
                name: outline.title,
                description: outline.summary,
              },
              update: {},
              include: {
                _count: {
                  select: {
                    clips: true,
                    voiceLines: true,
                    mediaTasks: true,
                    workflowRuns: true,
                  },
                },
                storyboard: { select: { id: true } },
                editorProject: { select: { id: true } },
              },
            });
            episodeIds.push(episode.id);
            if (outline.episodeNumber !== 1) continue;
            const content = story.firstEpisode.scenes.map(renderPackageScene).join("\n\n");
            const previous = await tx.episodeSourceVersion.aggregate({
              where: { episodeId: episode.id, kind: "adapted" },
              _max: { version: true },
            });
            const source = await tx.episodeSourceVersion.create({
              data: {
                id: randomUUID(),
                episodeId: episode.id,
                kind: "adapted",
                version: (previous._max.version ?? 0) + 1,
                title: story.firstEpisode.title,
                summary: story.firstEpisode.synopsis,
                content,
                sourceHash: createHash("sha256").update(content).digest("hex"),
                instructions: `策划包 ${row.id} v${row.version}`,
              },
            });
            if (
              !episode.novelText?.trim() &&
              !episode.activeSourceId &&
              !episode.storyboard &&
              !episode.editorProject &&
              Object.values(episode._count).every((count) => count === 0)
            )
              await tx.episode.update({
                where: { id: episode.id },
                data: {
                  novelText: content,
                  activeSourceId: source.id,
                  activeSourceKind: "adapted",
                },
              });
          }
          const characterIds: string[] = [],
            locationIds: string[] = [],
            propIds: string[] = [];
          for (const item of story.characters) {
            const asset = await tx.novelCharacter.upsert({
              where: {
                projectId_name: { projectId: input.projectId, name: item.name },
              },
              create: {
                id: randomUUID(),
                projectId: input.projectId,
                name: item.name,
                introduction: [
                  item.storyFunction,
                  item.personality,
                  item.motivation,
                  item.arc,
                  item.relationships,
                  item.voiceStyle,
                ].join("\n"),
                profileJson: JSON.stringify(item),
                visualProfileJson: visual(item.imagePrompt, item.visualProfile),
              },
              update: {},
            });
            const completedVisual = mergeMissingVisualProfile(
              asset.visualProfileJson,
              item.visualProfile,
              story.format.artStyle,
              `策划包 ${row.id} v${row.version}`,
              now,
            );
            if (completedVisual)
              await tx.novelCharacter.update({
                where: { id: asset.id },
                data: { visualProfileJson: completedVisual },
              });
            characterIds.push(asset.id);
          }
          for (const item of story.locations) {
            const asset = await tx.novelLocation.upsert({
              where: {
                projectId_name: { projectId: input.projectId, name: item.name },
              },
              create: {
                id: randomUUID(),
                projectId: input.projectId,
                name: item.name,
                summary: [
                  item.storyFunction,
                  item.spatialRules,
                  item.atmosphere,
                  item.reusableActions,
                ].join("\n"),
                visualProfileJson: visual(item.imagePrompt, item.visualProfile),
              },
              update: {},
            });
            const completedVisual = mergeMissingVisualProfile(
              asset.visualProfileJson,
              item.visualProfile,
              story.format.artStyle,
              `策划包 ${row.id} v${row.version}`,
              now,
            );
            if (completedVisual)
              await tx.novelLocation.update({
                where: { id: asset.id },
                data: { visualProfileJson: completedVisual },
              });
            locationIds.push(asset.id);
          }
          for (const item of story.props) {
            const asset = await tx.novelProp.upsert({
              where: {
                projectId_name: { projectId: input.projectId, name: item.name },
              },
              create: {
                id: randomUUID(),
                projectId: input.projectId,
                name: item.name,
                summary: [
                  item.storyFunction,
                  item.appearance,
                  item.capabilities,
                  item.limits,
                  item.costOrConsequence,
                ].join("\n"),
                metadataJson: JSON.stringify(item),
                visualProfileJson: visual(item.imagePrompt, item.visualProfile),
              },
              update: {},
            });
            const completedVisual = mergeMissingVisualProfile(
              asset.visualProfileJson,
              item.visualProfile,
              story.format.artStyle,
              `策划包 ${row.id} v${row.version}`,
              now,
            );
            if (completedVisual)
              await tx.novelProp.update({
                where: { id: asset.id },
                data: { visualProfileJson: completedVisual },
              });
            propIds.push(asset.id);
          }
          for (const episodeId of episodeIds) {
            await seedPackageProduction(tx, { ...input, episodeId, story });
          }
          const adoption = {
            adoptedAt: now.toISOString(),
            episodeIds,
            characterIds,
            locationIds,
            propIds,
          };
          await tx.productionApprovalGate.updateMany({
            where: { deliverableId: row.id },
            data: {
              status: "approved",
              decidedByUserId: input.userId,
              decidedAt: now,
              note: "确认采用策划包并进入制作",
            },
          });
          await tx.productionDeliverable.update({
            where: { id: row.id },
            data: {
              status: "approved",
              approvedAt: now,
              approvedByUserId: input.userId,
              payload: { ...payload, adoption } as Prisma.InputJsonValue,
            },
          });
          return { adoption, reused: false };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 30000,
        },
      );
    } catch (error) {
      if (
        attempt < 2 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      )
        continue;
      throw error;
    }
  }
}

function mergeMissingVisualProfile(
  currentJson: string | null,
  proposed: AssetVisualProfileSpec | undefined,
  artStyle: string,
  sourceNote: string,
  now: Date,
) {
  if (!proposed) return null;
  const current = parseAssetVisualProfile(parseJson(currentJson));
  if (current && AssetVisualProfileSpecSchema.safeParse(current.spec).success)
    return null;
  const old = current?.spec;
  const spec: AssetVisualProfileSpec = {
    visualIdentity: old?.visualIdentity.trim() || proposed.visualIdentity,
    shapeAndStructure:
      old?.shapeAndStructure.trim() || proposed.shapeAndStructure,
    surfaceAndStyling:
      old?.surfaceAndStyling.trim() || proposed.surfaceAndStyling,
    colorPalette: old?.colorPalette.trim() || proposed.colorPalette,
    lightingAndPresentation:
      old?.lightingAndPresentation.trim() || proposed.lightingAndPresentation,
    signatureDetails: old?.signatureDetails.length
      ? old.signatureDetails
      : proposed.signatureDetails,
    consistencyRules: old?.consistencyRules.length
      ? old.consistencyRules
      : proposed.consistencyRules,
    negativePrompt: old?.negativePrompt.trim() || proposed.negativePrompt,
    inferenceNotes: old?.inferenceNotes.length
      ? old.inferenceNotes
      : proposed.inferenceNotes,
  };
  return JSON.stringify({
    version: 1,
    source: current?.source ?? "model",
    ...(current?.model ? { model: current.model } : {}),
    updatedAt: now.toISOString(),
    projectArtStyle: current?.projectArtStyle || artStyle,
    ...(current?.storyWorld ? { storyWorld: current.storyWorld } : {}),
    spec,
    promptTrace: {
      ...current?.promptTrace,
      storyPackageVisualProfileBackfill: sourceNote,
    },
  } satisfies AssetVisualProfile);
}

function parseJson(value: string | null) {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
