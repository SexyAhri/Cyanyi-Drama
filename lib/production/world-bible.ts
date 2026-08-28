import { prisma } from "@/lib/server/prisma";

export async function loadApprovedWorldBible(
  userId: string,
  projectId: string,
) {
  const store = prisma.productionDeliverable;
  if (!store?.findFirst) return null;
  const deliverable = await store.findFirst({
    where: {
      userId,
      projectId,
      deliverableType: "story_bible",
      status: { in: ["approved", "locked"] },
      scopeType: "project",
      scopeId: projectId,
    },
    orderBy: [{ version: "desc" }, { updatedAt: "desc" }],
    select: { id: true, title: true, version: true, payload: true },
  });
  return deliverable
    ? {
        id: deliverable.id,
        title: deliverable.title,
        version: deliverable.version,
        payload: deliverable.payload,
      }
    : null;
}
