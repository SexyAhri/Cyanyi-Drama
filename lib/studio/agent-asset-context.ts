import { buildAssetGenerationPrompt } from "@/lib/assets/generation-prompt";
import { parseAssetVisualProfile } from "@/lib/assets/visual-profile";
import {
  listNovelCharacters,
  listNovelLocations,
} from "@/lib/novel/domain-store";
import { listProductionProps } from "@/lib/production/domain-store";
import { prisma } from "@/lib/server/prisma";

export async function loadAgentAssetContext(input: {
  userId: string;
  projectId: string;
  selection?: { id: string; kind: string };
  artStyle?: string;
}) {
  const selection = input.selection;
  if (!selection || !["character", "location", "prop"].includes(selection.kind))
    return null;
  const candidates: Array<{
    assetId: string | null;
    selected: boolean;
    description: string | null;
  }> = [];
  let name: string;
  let description: string | null;
  let profileValue: unknown;
  let details: Record<string, unknown> | undefined;
  const kind = selection.kind as "character" | "location" | "prop";
  if (kind === "character") {
    const entity = (
      await listNovelCharacters(input.userId, input.projectId)
    )?.find((item) => item.id === selection.id);
    if (!entity) return null;
    name = entity.name;
    description = entity.introduction;
    profileValue = entity.visualProfile;
    details = entity.profile;
    candidates.push(
      ...entity.appearances.map((item) => ({
        assetId: item.imageAssetId,
        selected: item.selected,
        description: item.description,
      })),
    );
  } else if (kind === "location") {
    const entity = (
      await listNovelLocations(input.userId, input.projectId)
    )?.find((item) => item.id === selection.id);
    if (!entity) return null;
    name = entity.name;
    description = entity.summary;
    profileValue = entity.visualProfile;
    candidates.push(
      ...entity.images.map((item) => ({
        assetId: item.imageAssetId,
        selected: item.selected,
        description: item.description,
      })),
    );
  } else {
    const entity = (
      await listProductionProps(input.userId, input.projectId)
    )?.find((item) => item.id === selection.id);
    if (!entity) return null;
    name = entity.name;
    description = entity.summary;
    profileValue = entity.visualProfile;
    details = entity.metadata;
    const assets = await prisma.mediaAsset.findMany({
      where: {
        task: { userId: input.userId, projectId: input.projectId },
        references: {
          some: {
            projectId: input.projectId,
            entityType: "prop",
            entityId: selection.id,
          },
        },
      },
      select: {
        id: true,
        references: {
          where: {
            projectId: input.projectId,
            entityType: "prop",
            entityId: selection.id,
          },
          select: { role: true },
        },
      },
    });
    candidates.push(
      ...assets.map((item) => ({
        assetId: item.id,
        selected: item.references.some((ref) => ref.role === "selected"),
        description: null,
      })),
    );
  }
  const visualProfile = parseAssetVisualProfile(profileValue);
  const visualDescription =
    candidates.find((item) => item.selected && item.description?.trim())
      ?.description ??
    candidates.find((item) => item.description?.trim())?.description;
  const selectedIds = candidates
    .filter((item) => item.selected && item.assetId)
    .map((item) => item.assetId as string);
  const selectedImage = selectedIds.length
    ? await prisma.mediaAsset.findFirst({
        where: {
          id: { in: selectedIds },
          kind: "image",
          task: {
            userId: input.userId,
            projectId: input.projectId,
            status: "succeeded",
          },
        },
        select: { url: true, storageKey: true },
      })
    : null;
  return {
    name,
    kind,
    description,
    visualProfile: visualProfile
      ? { source: visualProfile.source, spec: visualProfile.spec }
      : null,
    generationPrompt: buildAssetGenerationPrompt({
      kind,
      name,
      description,
      visualDescription,
      visualProfile,
      details,
      artStyle: input.artStyle,
    }),
    candidateCount: candidates.length,
    selectedImageReady: Boolean(
      selectedImage && (selectedImage.url || selectedImage.storageKey),
    ),
  };
}
