import type { Prisma } from "@prisma/client";

export function accessibleChannelWhere(
  userId: string,
  id?: string,
): Prisma.ChannelWhereInput {
  return {
    ...(id ? { id } : {}),
    enabled: true,
    OR: [{ scope: "SYSTEM" }, { scope: "USER", userId }],
  };
}

export function manageableChannelWhere(
  adminUserId: string,
  id?: string,
): Prisma.ChannelWhereInput {
  return {
    ...(id ? { id } : {}),
    OR: [{ scope: "SYSTEM" }, { scope: "USER", userId: adminUserId }],
  };
}
