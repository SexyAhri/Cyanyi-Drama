import {
  creditUserBalance,
  getUserBalance,
  BillingError,
} from "@/lib/billing/service";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

export async function GET() {
  const { user, sessionId } = await ensureAnonymousUser();
  const balance = await getUserBalance(user.id);
  return attachSessionCookie(Response.json({ balance }), sessionId);
}

export async function POST(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  if (process.env.BILLING_ALLOW_MANUAL_CREDIT !== "true")
    return attachSessionCookie(
      Response.json({ message: "手动充值未启用" }, { status: 403 }),
      sessionId,
    );
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  try {
    const transaction = await creditUserBalance({
      userId: user.id,
      amount:
        typeof body.amount === "number" || typeof body.amount === "string"
          ? body.amount
          : "",
      description:
        typeof body.description === "string" ? body.description : undefined,
      idempotencyKey:
        typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
          ? body.idempotencyKey.trim()
          : crypto.randomUUID(),
    });
    return attachSessionCookie(
      Response.json({ transaction }, { status: 201 }),
      sessionId,
    );
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
