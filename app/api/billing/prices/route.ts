import {
  BillingError,
  listModelPrices,
  upsertModelPrice,
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
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  try {
    const price = await upsertModelPrice({
      provider: typeof body.provider === "string" ? body.provider : "",
      model: typeof body.model === "string" ? body.model : "",
      capability: typeof body.capability === "string" ? body.capability : "",
      unit: typeof body.unit === "string" ? body.unit : "",
      unitPrice:
        typeof body.unitPrice === "number" || typeof body.unitPrice === "string"
          ? body.unitPrice
          : "",
      active: typeof body.active === "boolean" ? body.active : undefined,
      metadata:
        body.metadata &&
        typeof body.metadata === "object" &&
        !Array.isArray(body.metadata)
          ? (body.metadata as Record<string, unknown>)
          : undefined,
    });
    return attachSessionCookie(Response.json({ price }), sessionId);
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
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return Response.json({ message: "价格 ID 不能为空" }, { status: 400 });
  await prisma.modelPrice.deleteMany({ where: { id } });
  return Response.json({ ok: true });
}

function priceAdminError(error: unknown) {
  return Response.json(
    { message: "仅管理员可以管理模型价格" },
    { status: error instanceof AdminRequiredError ? 403 : 500 },
  );
}
