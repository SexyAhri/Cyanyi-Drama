import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/server/prisma";

export type GlobalAssetKind = "character" | "location" | "voice";

export async function listGlobalAssetHub(userId: string, folderId?: string) {
  const folderWhere = folderId ? { folderId } : {};
  const [folders, characters, locations, voices] = await Promise.all([
    prisma.globalAssetFolder.findMany({
      where: { userId },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    }),
    prisma.globalCharacter.findMany({
      where: { userId, ...folderWhere },
      include: { appearances: { orderBy: { appearanceIndex: "asc" } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.globalLocation.findMany({
      where: { userId, ...folderWhere },
      include: { images: { orderBy: { imageIndex: "asc" } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.globalVoice.findMany({
      where: { userId, ...folderWhere },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  return { folders, characters, locations, voices };
}

export async function createGlobalFolder(userId: string, name: string) {
  return prisma.globalAssetFolder.create({
    data: { userId, name: required(name, "GLOBAL_FOLDER_NAME_REQUIRED") },
  });
}

export async function updateGlobalFolder(
  userId: string,
  folderId: string,
  name: string,
) {
  const result = await prisma.globalAssetFolder.updateMany({
    where: { id: folderId, userId },
    data: { name: required(name, "GLOBAL_FOLDER_NAME_REQUIRED") },
  });
  return result.count
    ? prisma.globalAssetFolder.findUnique({ where: { id: folderId } })
    : null;
}

export async function deleteGlobalFolder(userId: string, folderId: string) {
  const result = await prisma.globalAssetFolder.deleteMany({
    where: { id: folderId, userId },
  });
  return result.count > 0;
}

export async function createGlobalCharacter(
  userId: string,
  input: Record<string, unknown>,
) {
  const name = required(input.name, "GLOBAL_CHARACTER_NAME_REQUIRED");
  const appearances = Array.isArray(input.appearances)
    ? input.appearances.filter(isObject)
    : [];
  return prisma.globalCharacter.create({
    data: {
      userId,
      folderId: optionalString(input.folderId),
      name,
      aliases: stringifyStringArray(input.aliases),
      profileData: stringifyObject(input.profile),
      profileConfirmed: input.profileConfirmed === true,
      voiceId: optionalString(input.voiceId),
      voiceType: optionalString(input.voiceType),
      globalVoiceId: optionalString(input.globalVoiceId),
      appearances: appearances.length
        ? {
            create: appearances.map((appearance, index) => ({
              appearanceIndex:
                finiteInteger(appearance.appearanceIndex) ?? index,
              changeReason:
                optionalString(appearance.changeReason) ?? "default",
              artStyle: optionalString(appearance.artStyle),
              description: optionalString(appearance.description),
              imageUrl: optionalString(appearance.imageUrl),
              imageAssetId: optionalString(appearance.imageAssetId),
              imageUrls: stringifyStringArray(appearance.imageUrls),
              selectedIndex: finiteInteger(appearance.selectedIndex),
            })),
          }
        : undefined,
    },
    include: { appearances: { orderBy: { appearanceIndex: "asc" } } },
  });
}

export async function updateGlobalCharacter(
  userId: string,
  characterId: string,
  input: Record<string, unknown>,
) {
  const existing = await prisma.globalCharacter.findFirst({
    where: { id: characterId, userId },
  });
  if (!existing) return null;
  return prisma.globalCharacter.update({
    where: { id: characterId },
    data: {
      name:
        input.name === undefined
          ? undefined
          : required(input.name, "GLOBAL_CHARACTER_NAME_REQUIRED"),
      folderId:
        input.folderId === undefined
          ? undefined
          : optionalString(input.folderId),
      aliases:
        input.aliases === undefined
          ? undefined
          : stringifyStringArray(input.aliases),
      profileData:
        input.profile === undefined
          ? undefined
          : stringifyObject(input.profile),
      profileConfirmed:
        typeof input.profileConfirmed === "boolean"
          ? input.profileConfirmed
          : undefined,
      voiceId:
        input.voiceId === undefined ? undefined : optionalString(input.voiceId),
      voiceType:
        input.voiceType === undefined
          ? undefined
          : required(input.voiceType, "GLOBAL_VOICE_TYPE_REQUIRED"),
      globalVoiceId:
        input.globalVoiceId === undefined
          ? undefined
          : optionalString(input.globalVoiceId),
    },
    include: { appearances: { orderBy: { appearanceIndex: "asc" } } },
  });
}

export async function deleteGlobalCharacter(
  userId: string,
  characterId: string,
) {
  return (
    (
      await prisma.globalCharacter.deleteMany({
        where: { id: characterId, userId },
      })
    ).count > 0
  );
}

export async function createGlobalLocation(
  userId: string,
  input: Record<string, unknown>,
) {
  const images = Array.isArray(input.images)
    ? input.images.filter(isObject)
    : [];
  return prisma.globalLocation.create({
    data: {
      userId,
      folderId: optionalString(input.folderId),
      name: required(input.name, "GLOBAL_LOCATION_NAME_REQUIRED"),
      artStyle: optionalString(input.artStyle),
      summary: optionalString(input.summary),
      images: images.length
        ? {
            create: images.map((image, index) => ({
              imageIndex: finiteInteger(image.imageIndex) ?? index,
              description: optionalString(image.description),
              imageUrl: optionalString(image.imageUrl),
              imageAssetId: optionalString(image.imageAssetId),
              isSelected: image.isSelected === true,
            })),
          }
        : undefined,
    },
    include: { images: { orderBy: { imageIndex: "asc" } } },
  });
}

export async function updateGlobalLocation(
  userId: string,
  locationId: string,
  input: Record<string, unknown>,
) {
  const existing = await prisma.globalLocation.findFirst({
    where: { id: locationId, userId },
  });
  if (!existing) return null;
  return prisma.globalLocation.update({
    where: { id: locationId },
    data: {
      name:
        input.name === undefined
          ? undefined
          : required(input.name, "GLOBAL_LOCATION_NAME_REQUIRED"),
      folderId:
        input.folderId === undefined
          ? undefined
          : optionalString(input.folderId),
      artStyle:
        input.artStyle === undefined
          ? undefined
          : optionalString(input.artStyle),
      summary:
        input.summary === undefined ? undefined : optionalString(input.summary),
    },
    include: { images: { orderBy: { imageIndex: "asc" } } },
  });
}

export async function deleteGlobalLocation(userId: string, locationId: string) {
  return (
    (
      await prisma.globalLocation.deleteMany({
        where: { id: locationId, userId },
      })
    ).count > 0
  );
}

export async function createGlobalVoice(
  userId: string,
  input: Record<string, unknown>,
) {
  return prisma.globalVoice.create({
    data: {
      userId,
      folderId: optionalString(input.folderId),
      name: required(input.name, "GLOBAL_VOICE_NAME_REQUIRED"),
      description: optionalString(input.description),
      voiceId: optionalString(input.voiceId),
      voiceType: optionalString(input.voiceType) ?? "designed",
      customVoiceUrl: optionalString(input.customVoiceUrl),
      voicePrompt: optionalString(input.voicePrompt),
      gender: optionalString(input.gender),
      language: optionalString(input.language) ?? "zh",
    },
  });
}

export async function updateGlobalVoice(
  userId: string,
  voiceId: string,
  input: Record<string, unknown>,
) {
  const existing = await prisma.globalVoice.findFirst({
    where: { id: voiceId, userId },
  });
  if (!existing) return null;
  return prisma.globalVoice.update({
    where: { id: voiceId },
    data: {
      name:
        input.name === undefined
          ? undefined
          : required(input.name, "GLOBAL_VOICE_NAME_REQUIRED"),
      folderId:
        input.folderId === undefined
          ? undefined
          : optionalString(input.folderId),
      description:
        input.description === undefined
          ? undefined
          : optionalString(input.description),
      voiceId:
        input.voiceId === undefined ? undefined : optionalString(input.voiceId),
      voiceType:
        input.voiceType === undefined
          ? undefined
          : required(input.voiceType, "GLOBAL_VOICE_TYPE_REQUIRED"),
      customVoiceUrl:
        input.customVoiceUrl === undefined
          ? undefined
          : optionalString(input.customVoiceUrl),
      voicePrompt:
        input.voicePrompt === undefined
          ? undefined
          : optionalString(input.voicePrompt),
      gender:
        input.gender === undefined ? undefined : optionalString(input.gender),
      language:
        input.language === undefined
          ? undefined
          : required(input.language, "GLOBAL_VOICE_LANGUAGE_REQUIRED"),
    },
  });
}

export async function deleteGlobalVoice(userId: string, voiceId: string) {
  return (
    (await prisma.globalVoice.deleteMany({ where: { id: voiceId, userId } }))
      .count > 0
  );
}

export async function selectGlobalImage(
  userId: string,
  kind: "character" | "location",
  imageId: string,
  candidateIndex?: number,
) {
  if (kind === "character") {
    const appearance = await prisma.globalCharacterAppearance.findFirst({
      where: { id: imageId, character: { userId } },
    });
    if (!appearance) return null;
    const candidates = parseStringArray(appearance.imageUrls);
    const index = candidateIndex ?? appearance.selectedIndex ?? 0;
    const imageUrl = candidates[index] ?? appearance.imageUrl;
    if (!imageUrl) throw new Error("GLOBAL_IMAGE_CANDIDATE_NOT_FOUND");
    return prisma.globalCharacterAppearance.update({
      where: { id: imageId },
      data: {
        previousImageUrl: appearance.imageUrl,
        previousDescription: appearance.description,
        imageUrl,
        selectedIndex: index,
      },
    });
  }

  const image = await prisma.globalLocationImage.findFirst({
    where: { id: imageId, location: { userId } },
  });
  if (!image) return null;
  await prisma.$transaction([
    prisma.globalLocationImage.updateMany({
      where: { locationId: image.locationId },
      data: { isSelected: false },
    }),
    prisma.globalLocationImage.update({
      where: { id: imageId },
      data: { isSelected: true },
    }),
  ]);
  return prisma.globalLocationImage.findUnique({ where: { id: imageId } });
}

export async function revertGlobalImage(
  userId: string,
  kind: "character" | "location",
  imageId: string,
) {
  if (kind === "character") {
    const appearance = await prisma.globalCharacterAppearance.findFirst({
      where: { id: imageId, character: { userId } },
    });
    if (!appearance) return null;
    if (!appearance.previousImageUrl)
      throw new Error("GLOBAL_IMAGE_HISTORY_EMPTY");
    return prisma.globalCharacterAppearance.update({
      where: { id: imageId },
      data: {
        imageUrl: appearance.previousImageUrl,
        description: appearance.previousDescription,
        previousImageUrl: appearance.imageUrl,
        previousDescription: appearance.description,
      },
    });
  }
  const image = await prisma.globalLocationImage.findFirst({
    where: { id: imageId, location: { userId } },
  });
  if (!image) return null;
  if (!image.previousImageUrl) throw new Error("GLOBAL_IMAGE_HISTORY_EMPTY");
  return prisma.globalLocationImage.update({
    where: { id: imageId },
    data: {
      imageUrl: image.previousImageUrl,
      description: image.previousDescription,
      previousImageUrl: image.imageUrl,
      previousDescription: image.description,
    },
  });
}

export async function copyGlobalAssetToProject(
  userId: string,
  projectId: string,
  kind: GlobalAssetKind,
  assetId: string,
) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });
  if (!project) return null;

  if (kind === "character") {
    const source = await prisma.globalCharacter.findFirst({
      where: { id: assetId, userId },
      include: { appearances: true },
    });
    if (!source) return null;
    const character = await prisma.novelCharacter.upsert({
      where: { projectId_name: { projectId, name: source.name } },
      create: {
        id: randomUUID(),
        projectId,
        name: source.name,
        aliases: source.aliases,
        profileJson: source.profileData,
        confirmed: source.profileConfirmed,
      },
      update: {
        aliases: source.aliases,
        profileJson: source.profileData,
        confirmed: source.profileConfirmed,
      },
    });
    for (const appearance of source.appearances) {
      await prisma.characterAppearance.upsert({
        where: {
          characterId_appearanceIndex: {
            characterId: character.id,
            appearanceIndex: appearance.appearanceIndex,
          },
        },
        create: {
          id: randomUUID(),
          characterId: character.id,
          appearanceIndex: appearance.appearanceIndex,
          description: appearance.description,
          imageAssetId: appearance.imageAssetId,
          selected: appearance.selectedIndex !== null,
          metadataJson: appearance.imageUrl
            ? JSON.stringify({
                sourceUrl: appearance.imageUrl,
                globalAssetId: source.id,
              })
            : JSON.stringify({ globalAssetId: source.id }),
        },
        update: {
          description: appearance.description,
          imageAssetId: appearance.imageAssetId,
          selected: appearance.selectedIndex !== null,
          metadataJson: appearance.imageUrl
            ? JSON.stringify({
                sourceUrl: appearance.imageUrl,
                globalAssetId: source.id,
              })
            : JSON.stringify({ globalAssetId: source.id }),
        },
      });
    }
    return { kind, asset: character };
  }

  if (kind === "location") {
    const source = await prisma.globalLocation.findFirst({
      where: { id: assetId, userId },
      include: { images: true },
    });
    if (!source) return null;
    const location = await prisma.novelLocation.upsert({
      where: { projectId_name: { projectId, name: source.name } },
      create: {
        id: randomUUID(),
        projectId,
        name: source.name,
        summary: source.summary,
      },
      update: { summary: source.summary },
    });
    for (const image of source.images) {
      await prisma.locationImage.upsert({
        where: {
          locationId_imageIndex: {
            locationId: location.id,
            imageIndex: image.imageIndex,
          },
        },
        create: {
          id: randomUUID(),
          locationId: location.id,
          imageIndex: image.imageIndex,
          description: image.description,
          metadataJson: JSON.stringify({
            globalAssetId: source.id,
            sourceUrl: image.imageUrl,
          }),
          imageAssetId: image.imageAssetId,
          selected: image.isSelected,
        },
        update: {
          description: image.description,
          metadataJson: JSON.stringify({
            globalAssetId: source.id,
            sourceUrl: image.imageUrl,
          }),
          imageAssetId: image.imageAssetId,
          selected: image.isSelected,
        },
      });
    }
    return { kind, asset: location };
  }

  const source = await prisma.globalVoice.findFirst({
    where: { id: assetId, userId },
  });
  if (!source) return null;
  const existing = await prisma.voicePreset.findFirst({
    where: { userId, projectId, name: source.name },
  });
  const voice = existing
    ? await prisma.voicePreset.update({
        where: { id: existing.id },
        data: {
          providerVoiceId: source.voiceId,
          language: source.language,
          gender: source.gender,
          description: source.description,
        },
      })
    : await prisma.voicePreset.create({
        data: {
          id: randomUUID(),
          userId,
          projectId,
          name: source.name,
          providerVoiceId: source.voiceId,
          language: source.language,
          gender: source.gender,
          description: source.description,
        },
      });
  return { kind, asset: voice };
}

function required(value: unknown, code: string) {
  const normalized = optionalString(value);
  if (!normalized) throw new Error(code);
  return normalized;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() || null : null;
}

function finiteInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringifyObject(value: unknown) {
  return isObject(value) ? JSON.stringify(value) : null;
}

function stringifyStringArray(value: unknown) {
  return Array.isArray(value)
    ? JSON.stringify(
        value.filter((item): item is string => typeof item === "string"),
      )
    : null;
}

function parseStringArray(value: string | null) {
  try {
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
