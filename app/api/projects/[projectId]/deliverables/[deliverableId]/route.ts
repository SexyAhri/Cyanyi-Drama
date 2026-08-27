import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  ProductionDeliverableError,
  transitionProductionDeliverable,
  type ProductionDeliverableAction,
} from "@/lib/production/deliverables";

type Context = {
  params: Promise<{ projectId: string; deliverableId: string }>;
};

const ACTIONS = new Set<ProductionDeliverableAction>([
  "submit",
  "approve",
  "reject",
  "lock",
  "supersede",
]);

export async function PATCH(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, deliverableId } = await context.params;
  const body = await readObject(request);
  const action = typeof body.action === "string" ? body.action : "";
  if (!isAction(action))
    return attachSessionCookie(
      Response.json(
        { message: "PRODUCTION_DELIVERABLE_ACTION_INVALID" },
        { status: 400 },
      ),
      sessionId,
    );
  try {
    const deliverable = await transitionProductionDeliverable(
      user.id,
      projectId,
      deliverableId,
      {
        action,
        gateKey: typeof body.gateKey === "string" ? body.gateKey : undefined,
        note: typeof body.note === "string" ? body.note : undefined,
      },
    );
    return attachSessionCookie(Response.json({ deliverable }), sessionId);
  } catch (error) {
    const known = error instanceof ProductionDeliverableError;
    return attachSessionCookie(
      Response.json(
        { message: known ? error.message : "PRODUCTION_DELIVERABLE_FAILED" },
        { status: known ? error.status : 500 },
      ),
      sessionId,
    );
  }
}

function isAction(value: string): value is ProductionDeliverableAction {
  return ACTIONS.has(value as ProductionDeliverableAction);
}

async function readObject(request: Request) {
  const value: unknown = await request.json().catch(() => ({}));
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
