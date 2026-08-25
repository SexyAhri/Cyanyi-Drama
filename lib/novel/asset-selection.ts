import { prisma } from "@/lib/server/prisma";

export type SelectableAssetType = "character" | "location" | "storyboard_panel";

export async function selectProjectAsset(input: {
  userId: string;
  projectId: string;
  targetType: SelectableAssetType;
  targetId: string;
}) {
  if (input.targetType === "character") {
    const appearance = await prisma.characterAppearance.findFirst({
      where: {
        id: input.targetId,
        imageAssetId: { not: null },
        character: { projectId: input.projectId, project: { userId: input.userId } },
      },
      select: { id: true, characterId: true, imageAssetId: true },
    });
    if (!appearance || !appearance.imageAssetId) return null;
    const assetId = appearance.imageAssetId;

    await prisma.$transaction(async (tx) => {
      await tx.characterAppearance.updateMany({
        where: { characterId: appearance.characterId },
        data: { selected: false },
      });
      await tx.characterAppearance.update({
        where: { id: appearance.id },
        data: { selected: true, updatedAt: new Date() },
      });
      await tx.assetReference.upsert({
        where: {
          mediaAssetId_entityType_entityId_role: {
            mediaAssetId: assetId,
            entityType: "character_appearance",
            entityId: appearance.id,
            role: "selected",
          },
        },
        create: {
          id: `${assetId}_character_selected`,
          projectId: input.projectId,
          mediaAssetId: assetId,
          entityType: "character_appearance",
          entityId: appearance.id,
          role: "selected",
        },
        update: {},
      });
    });
    return { entityType: "character_appearance", entityId: appearance.id };
  }

  if (input.targetType === "storyboard_panel") {
    const panel = await prisma.storyboardPanel.findFirst({
      where: {
        id: input.targetId,
        imageAssetId: { not: null },
        storyboard: {
          projectId: input.projectId,
          project: { userId: input.userId },
        },
      },
      select: { id: true, imageAssetId: true },
    });
    if (!panel || !panel.imageAssetId) return null;
    const assetId = panel.imageAssetId;
    await prisma.assetReference.upsert({
      where: {
        mediaAssetId_entityType_entityId_role: {
          mediaAssetId: assetId,
          entityType: "storyboard_panel",
          entityId: panel.id,
          role: "selected",
        },
      },
      create: {
        id: `${assetId}_storyboard_selected`,
        projectId: input.projectId,
        mediaAssetId: assetId,
        entityType: "storyboard_panel",
        entityId: panel.id,
        role: "selected",
      },
      update: {},
    });
    return { entityType: "storyboard_panel", entityId: panel.id };
  }

  const image = await prisma.locationImage.findFirst({
    where: {
      id: input.targetId,
      imageAssetId: { not: null },
      location: { projectId: input.projectId, project: { userId: input.userId } },
    },
    select: { id: true, locationId: true, imageAssetId: true },
  });
  if (!image || !image.imageAssetId) return null;
  const assetId = image.imageAssetId;

  await prisma.$transaction(async (tx) => {
    await tx.locationImage.updateMany({
      where: { locationId: image.locationId },
      data: { selected: false },
    });
    await tx.locationImage.update({
      where: { id: image.id },
      data: { selected: true, updatedAt: new Date() },
    });
    await tx.novelLocation.update({
      where: { id: image.locationId },
      data: { selectedImageId: image.id, updatedAt: new Date() },
    });
    await tx.assetReference.upsert({
      where: {
        mediaAssetId_entityType_entityId_role: {
          mediaAssetId: assetId,
          entityType: "location_image",
          entityId: image.id,
          role: "selected",
        },
      },
      create: {
        id: `${assetId}_location_selected`,
        projectId: input.projectId,
        mediaAssetId: assetId,
        entityType: "location_image",
        entityId: image.id,
        role: "selected",
      },
      update: {},
    });
  });
  return { entityType: "location_image", entityId: image.id };
}
