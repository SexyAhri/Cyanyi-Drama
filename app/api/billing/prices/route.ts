import {
  BillingError,
  listModelPrices,
  upsertModelPrice,
} from "@/lib/billing/service";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

export async function GET() {
  const { sessionId } = await ensureAnonymousUser();
  const prices = await listModelPrices();
  return attachSessionCookie(Response.json({ prices }), sessionId);
}

export async function PUT(request: Request) {
  const { sessionId } = await ensureAnonymousUser();
  if (process.env.BILLING_ALLOW_PRICE_ADMIN !== "true")
    return attachSessionCookie(
      Response.json({ message: "价格管理未启用" }, { status: 403 }),
      sessionId,
    );
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
