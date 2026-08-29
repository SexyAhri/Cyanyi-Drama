import {
  createEpayOrder,
  getTopupConfiguration,
  listPaymentOrders,
} from "@/lib/billing/epay";
import { BillingError } from "@/lib/billing/service";
import { getCurrentUser } from "@/lib/server/auth";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.anonymous) {
    return Response.json({ message: "请先登录" }, { status: 401 });
  }
  const limit = Number(new URL(request.url).searchParams.get("limit") || 20);
  const [config, orders] = await Promise.all([
    getTopupConfiguration(),
    listPaymentOrders(user.id, limit),
  ]);
  return Response.json({ config, orders });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.anonymous) {
    return Response.json({ message: "请先登录" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const result = await createEpayOrder({
      userId: user.id,
      amount:
        typeof body.amount === "string" || typeof body.amount === "number"
          ? body.amount
          : "",
      paymentMethod:
        typeof body.paymentMethod === "string" ? body.paymentMethod : "",
      request,
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "充值订单创建失败" },
      { status: error instanceof BillingError ? error.status : 400 },
    );
  }
}
