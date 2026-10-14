import { Prisma } from "@prisma/client";

import { AdminRequiredError, requireAdmin } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";

export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (error) {
    return adminError(error);
  }

  const params = new URL(request.url).searchParams;
  const query = params.get("query")?.trim() ?? "";
  const apiType = params.get("apiType")?.trim() ?? "";
  const limit = clampLimit(Number(params.get("limit") || 200));
  const where: Prisma.UsageCostWhereInput = {
    ...(apiType ? { apiType } : {}),
    ...(query
      ? {
          OR: [
            { model: { contains: query, mode: "insensitive" } },
            { action: { contains: query, mode: "insensitive" } },
            { project: { name: { contains: query, mode: "insensitive" } } },
            { user: { displayName: { contains: query, mode: "insensitive" } } },
            { user: { email: { contains: query, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [costs, aggregate, apiTypes] = await Promise.all([
    prisma.usageCost.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        user: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.usageCost.aggregate({ where, _count: true, _sum: { cost: true } }),
    prisma.usageCost.findMany({
      distinct: ["apiType"],
      select: { apiType: true },
      orderBy: { apiType: "asc" },
    }),
  ]);

  return Response.json({
    costs: costs.map((cost) => ({
      ...cost,
      cost: cost.cost.toString(),
      quantity: Number(cost.quantity),
      createdAt: cost.createdAt.toISOString(),
    })),
    filters: { apiTypes: apiTypes.map((item) => item.apiType) },
    summary: {
      count: aggregate._count,
      cost: aggregate._sum.cost?.toString() ?? "0",
    },
  });
}

function clampLimit(value: number) {
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 1), 500) : 200;
}

function adminError(error: unknown) {
  return Response.json(
    { message: "仅管理员可以查看全站使用日志" },
    { status: error instanceof AdminRequiredError ? 403 : 500 },
  );
}
