import {
  BillingError,
  listModelPrices,
  saveModelPricePlan,
} from "@/lib/billing/service";
import {
  AdminRequiredError,
  attachSessionCookie,
  ensureAnonymousUser,
  requireAdmin,
} from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";

export async function GET() {
  const { sessionId } = await ensureAnonymousUser();
  const prices = await listModelPrices();
  return attachSessionCookie(Response.json({ prices }), sessionId);
}

export async function PUT(request: Request) {
  try {
    await requireAdmin();
  } catch (error) {
    return priceAdminError(error);
  }
  const sessionId = null;
  const rawBody: unknown = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody))
    return Response.json({ message: "价格方案格式无效" }, { status: 400 });
  const body = rawBody as Record<string, unknown>;
  try {
    const rates = body.rates ?? [{ unit: body.unit, unitPrice: body.unitPrice }];
    if (!Array.isArray(rates) || rates.length > 4 || rates.some(rate => !rate || typeof rate !== "object" || typeof rate.unit !== "string" || !["string", "number"].includes(typeof rate.unitPrice)))
      return Response.json({ message: "价格方案格式无效" }, { status: 400 });
    const prices = await saveModelPricePlan({
      provider: typeof body.provider === "string" ? body.provider : "",
      model: typeof body.model === "string" ? body.model : "",
      capability: typeof body.capability === "string" ? body.capability : "",
      rates: rates as Array<{ unit: string; unitPrice: string | number }>,
    });
    return attachSessionCookie(Response.json({ prices, price: prices[0] }), sessionId);
  } catch (error) {
    const status = error instanceof BillingError ? error.status : 500;
    return attachSessionCookie(
      Response.json(
        { message: error instanceof Error ? error.message : String(error) },
        { status },
      ),
      sessionId,
    );
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
  } catch (error) {
    return priceAdminError(error);
  }
  const params = new URL(request.url).searchParams;
  const provider = params.get("provider")?.trim();
  const model = params.get("model")?.trim();
  const capability = params.get("capability")?.trim();
  if (provider && model && capability) {
    await prisma.modelPrice.updateMany({ where: { provider, model, capability }, data: { active: false } });
    return Response.json({ ok: true });
  }
  const id = params.get("id")?.trim();
  if (!id) return Response.json({ message: "价格 ID 不能为空" }, { status: 400 });
  await prisma.modelPrice.updateMany({ where: { id }, data: { active: false } });
  return Response.json({ ok: true });
}

function priceAdminError(error: unknown) {
  return Response.json(
    { message: "仅管理员可以管理模型价格" },
    { status: error instanceof AdminRequiredError ? 403 : 500 },
  );
}
