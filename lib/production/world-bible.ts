import { prisma } from "@/lib/server/prisma";

export async function loadApprovedWorldBible(
  userId: string,
  projectId: string,
) {
  return loadProjectWorldBible(userId, projectId, ["approved", "locked"]);
}

export async function loadCurrentWorldBible(
  userId: string,
  projectId: string,
) {
  return loadProjectWorldBible(userId, projectId, [
    "draft",
    "review",
    "approved",
    "locked",
  ]);
}

async function loadProjectWorldBible(
  userId: string,
  projectId: string,
  statuses: string[],
) {
  const store = prisma.productionDeliverable;
  if (!store?.findFirst) return null;
  const deliverable = await store.findFirst({
    where: {
      userId,
      projectId,
      deliverableType: "story_bible",
      status: { in: statuses },
      supersededAt: null,
      scopeType: "project",
      scopeId: projectId,
    },
    orderBy: [{ version: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      version: true,
      status: true,
      payload: true,
    },
  });
  return deliverable
    ? {
        id: deliverable.id,
        title: deliverable.title,
        version: deliverable.version,
        status: deliverable.status,
        payload: compactStoryBiblePayload(deliverable.payload),
      }
    : null;
}

function compactStoryBiblePayload(payload: unknown) {
  if (!isRecord(payload) || payload.packageFormat !== "cyanyi-story-package-v1")
    return payload;
  const storyPackage = isRecord(payload.storyPackage)
    ? payload.storyPackage
    : null;
  if (!storyPackage) return payload;
  return {
    title: storyPackage.title,
    logline: storyPackage.logline,
    synopsis: storyPackage.synopsis,
    worldRules: storyPackage.worldRules,
    characters: compactAssets(storyPackage.characters, [
      "name",
      "role",
      "ageAndAppearance",
      "personality",
      "motivation",
      "arc",
      "relationships",
      "voiceStyle",
    ]),
    props: compactAssets(storyPackage.props, [
      "name",
      "storyFunction",
      "appearance",
      "capabilities",
      "limits",
      "costOrConsequence",
    ]),
    locations: compactAssets(storyPackage.locations, [
      "name",
      "storyFunction",
      "spatialRules",
      "atmosphere",
    ]),
    creativeProhibitions: storyPackage.creativeProhibitions,
  };
}

function compactAssets(value: unknown, keys: string[]) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((asset) =>
      Object.fromEntries(
        keys.flatMap((key) => (key in asset ? [[key, asset[key]]] : [])),
      ),
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
