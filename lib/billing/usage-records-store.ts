import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { recordedUsageTokens, type UsageRecordsPage } from "./usage-records";

/** Caller supplies the authenticated user scope; URL parameters never control ownership. */
export async function listUsageRecords(
  params: URLSearchParams,
  userId?: string,
): Promise<UsageRecordsPage> {
  const query = params.get("query")?.trim().slice(0, 200) ?? "";
  const apiType = params.get("apiType")?.trim() ?? "";
  const bounded = (value: string | null, fallback: number, max: number) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0
      ? Math.min(number, max)
      : fallback;
  };
  const pageSize = bounded(
    params.get("pageSize") ?? params.get("limit"),
    20,
    100,
  );
  const requestedPage = bounded(params.get("page"), 1, 1_000_000);
  const requestedAsOf = new Date(params.get("asOf") ?? "");
  const now = new Date();
  const asOf =
    Number.isFinite(requestedAsOf.getTime()) && requestedAsOf <= now
      ? requestedAsOf
      : now;
  const scope: Prisma.UsageCostWhereInput = userId ? { userId } : {};
  const where: Prisma.UsageCostWhereInput = {
    ...scope,
    createdAt: { lte: asOf },
    ...(apiType && apiType !== "all" ? { apiType } : {}),
    ...(query
      ? {
          OR: [
            { model: { contains: query, mode: "insensitive" } },
            { action: { contains: query, mode: "insensitive" } },
            { project: { name: { contains: query, mode: "insensitive" } } },
            { user: { displayName: { contains: query, mode: "insensitive" } } },
            ...(!userId
              ? [
                  {
                    user: {
                      email: { contains: query, mode: "insensitive" as const },
                    },
                  },
                ]
              : []),
          ],
        }
      : {}),
  };
  const [aggregate, types] = await Promise.all([
    prisma.usageCost.aggregate({ where, _count: true, _sum: { cost: true } }),
    prisma.usageCost.findMany({
      where: scope,
      distinct: ["apiType"],
      select: { apiType: true },
      orderBy: { apiType: "asc" },
    }),
  ]);
  const page = Math.min(
    requestedPage,
    Math.max(1, Math.ceil(aggregate._count / pageSize)),
  );
  const costs = await prisma.usageCost.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      createdAt: true,
      model: true,
      apiType: true,
      action: true,
      quantity: true,
      unit: true,
      cost: true,
      metadata: true,
      user: { select: { id: true, displayName: true } },
      project: { select: { id: true, name: true } },
    },
  });
  return {
    costs: costs.map(({ metadata, ...cost }) => ({
      ...cost,
      createdAt: cost.createdAt.toISOString(),
      quantity: Number(cost.quantity),
      cost: cost.cost.toString(),
      tokens: recordedUsageTokens(metadata),
    })),
    filters: { apiTypes: types.map((item) => item.apiType) },
    summary: {
      count: aggregate._count,
      cost: aggregate._sum.cost?.toString() ?? "0",
    },
    page,
    pageSize,
    asOf: asOf.toISOString(),
  };
}
