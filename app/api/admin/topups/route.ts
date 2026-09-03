import { Prisma } from "@prisma/client";

import { AdminRequiredError, requireAdmin } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";

const paymentStatuses = new Set(["pending", "paid", "failed", "expired"]);

export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (error) {
    return adminError(error);
  }

  const params = new URL(request.url).searchParams;
  const status = params.get("status")?.trim() ?? "";
  const query = params.get("query")?.trim() ?? "";
  if (status && !paymentStatuses.has(status)) {
    return Response.json({ message: "不支持的充值订单状态" }, { status: 400 });
  }
  const where: Prisma.PaymentOrderWhereInput = {
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            { tradeNo: { contains: query, mode: "insensitive" } },
            { providerTradeNo: { contains: query, mode: "insensitive" } },
            { user: { displayName: { contains: query, mode: "insensitive" } } },
            { user: { email: { contains: query, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [orders, aggregate, paidAggregate] = await Promise.all([
    prisma.paymentOrder.findMany({
      where,
      include: {
        user: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.paymentOrder.aggregate({
      where,
      _count: true,
    }),
    prisma.paymentOrder.aggregate({
      where: { ...where, status: "paid" },
      _sum: { amount: true, creditAmount: true },
    }),
  ]);

  return Response.json({
    orders: orders.map((order) => ({
      ...order,
      amount: order.amount.toString(),
      creditAmount: order.creditAmount.toString(),
      expiresAt: order.expiresAt?.toISOString() ?? null,
      paidAt: order.paidAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    })),
    summary: {
      count: aggregate._count,
      amount: paidAggregate._sum.amount?.toString() ?? "0",
      creditAmount: paidAggregate._sum.creditAmount?.toString() ?? "0",
    },
  });
}

function adminError(error: unknown) {
  return Response.json(
    { message: "仅管理员可以查看充值订单" },
    { status: error instanceof AdminRequiredError ? 403 : 500 },
  );
}
