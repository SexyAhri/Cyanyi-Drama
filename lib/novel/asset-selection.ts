import { prisma } from "@/lib/server/prisma";

export type SelectableAssetType = "character" | "location" | "prop" | "storyboard_panel";
export type StoryboardAssetKind = "image" | "video";

export async function selectProjectAsset(input: {
  userId: string;
  projectId: string;
  targetType: SelectableAssetType;
  targetId: string;
  assetId?: string;
  assetKind?: StoryboardAssetKind;
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
    const assetKind = input.assetKind ?? "image";
    const panel = await prisma.storyboardPanel.findFirst({
      where: {
        id: input.targetId,
        ...(assetKind === "video"
          ? { videoAssetId: { not: null } }
          : { imageAssetId: { not: null } }),
        storyboard: {
          projectId: input.projectId,
          project: { userId: input.userId },
        },
      },
      select: { id: true, imageAssetId: true, videoAssetId: true },
    });
    const assetId = assetKind === "video" ? panel?.videoAssetId : panel?.imageAssetId;
    if (!panel || !assetId) return null;
    const role = assetKind === "video" ? "selected_video" : "selected";
    await prisma.assetReference.upsert({
      where: {
        mediaAssetId_entityType_entityId_role: {
          mediaAssetId: assetId,
          entityType: "storyboard_panel",
          entityId: panel.id,
          role,
        },
      },
      create: {
        id: `${assetId}_storyboard_selected`,
        projectId: input.projectId,
        mediaAssetId: assetId,
        entityType: "storyboard_panel",
        entityId: panel.id,
        role,
      },
      update: {},
    });
    return {
      entityType: "storyboard_panel",
      entityId: panel.id,
      assetId,
      assetKind,
    };
  }

  if (input.targetType === "prop") {
    if (!input.assetId) return null;
    const asset = await prisma.mediaAsset.findFirst({
      where: {
        id: input.assetId,
        kind: "image",
        task: { userId: input.userId, projectId: input.projectId },
        references: {
          some: {
            projectId: input.projectId,
            entityType: "prop",
            entityId: input.targetId,
          },
        },
      },
      select: { id: true },
    });
    if (!asset) return null;
    await prisma.$transaction(async (tx) => {
      await tx.assetReference.deleteMany({
        where: {
          projectId: input.projectId,
          entityType: "prop",
          entityId: input.targetId,
          role: "selected",
        },
      });
      await tx.assetReference.create({
        data: {
          id: `${asset.id}_${input.targetId}_prop_selected`,
          projectId: input.projectId,
          mediaAssetId: asset.id,
          entityType: "prop",
          entityId: input.targetId,
          role: "selected",
        },
      });
    });
    return {
      entityType: "prop",
      entityId: input.targetId,
      assetId: asset.id,
    };
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
