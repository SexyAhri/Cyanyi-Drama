import { AdminRequiredError, requireAdmin } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";

export async function GET() {
  try {
    await requireAdmin();
  } catch (error) {
    return adminError(error);
  }

  const [balances, transactions, users] = await Promise.all([
    prisma.userBalance.findMany({
      include: {
        user: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.balanceTransaction.findMany({
      include: {
        user: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.user.findMany({
      where: { anonymous: false },
      select: { id: true, displayName: true, email: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);

  return Response.json({
    balances: balances.map((balance) => ({
      ...balance,
      balance: balance.balance.toString(),
      frozenAmount: balance.frozenAmount.toString(),
      totalSpent: balance.totalSpent.toString(),
      createdAt: balance.createdAt.toISOString(),
      updatedAt: balance.updatedAt.toISOString(),
    })),
    transactions: transactions.map((transaction) => ({
      ...transaction,
      amount: transaction.amount.toString(),
      balanceAfter: transaction.balanceAfter.toString(),
      createdAt: transaction.createdAt.toISOString(),
    })),
    users,
  });
}

function adminError(error: unknown) {
  return Response.json(
    { message: "仅管理员可以查看扣费系统" },
    { status: error instanceof AdminRequiredError ? 403 : 500 },
  );
}
