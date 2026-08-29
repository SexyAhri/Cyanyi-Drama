import {
  creditUserBalance,
  getUserBalance,
  BillingError,
} from "@/lib/billing/service";
import {
  AdminRequiredError,
  attachSessionCookie,
  ensureAnonymousUser,
  requireAdmin,
} from "@/lib/server/auth";

export async function GET() {
  const { user, sessionId } = await ensureAnonymousUser();
  const balance = await getUserBalance(user.id);
  return attachSessionCookie(Response.json({ balance }), sessionId);
}

export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return Response.json(
      { message: "仅管理员可以手动调整余额" },
      { status: error instanceof AdminRequiredError ? 403 : 500 },
    );
  }
  const sessionId = null;
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  try {
    const transaction = await creditUserBalance({
      userId:
        typeof body.userId === "string" && body.userId.trim()
          ? body.userId.trim()
          : admin.id,
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
