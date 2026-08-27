import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  createProductionDeliverable,
  listProductionDeliverables,
  PRODUCTION_DELIVERABLE_STATUSES,
  ProductionDeliverableError,
} from "@/lib/production/deliverables";
import {
  getProductionDepartment,
  PRODUCTION_DEPARTMENTS,
} from "@/lib/production/departments";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const search = new URL(request.url).searchParams;
  const department = search.get("department")?.trim() || undefined;
  const status = search.get("status")?.trim() || undefined;
  if (department && !getProductionDepartment(department))
    return attachSessionCookie(
      Response.json(
        { message: "PRODUCTION_DEPARTMENT_INVALID" },
        { status: 400 },
      ),
      sessionId,
    );
  if (
    status &&
    !PRODUCTION_DELIVERABLE_STATUSES.some((candidate) => candidate === status)
  )
    return attachSessionCookie(
      Response.json(
        { message: "PRODUCTION_DELIVERABLE_STATUS_INVALID" },
        { status: 400 },
      ),
      sessionId,
    );
  try {
    const deliverables = await listProductionDeliverables(user.id, projectId, {
      department,
      episodeId: search.get("episodeId")?.trim() || undefined,
      status,
    });
    return attachSessionCookie(
      Response.json({ departments: PRODUCTION_DEPARTMENTS, deliverables }),
      sessionId,
    );
  } catch (error) {
    return errorResponse(error, sessionId);
  }
}

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  if (
    !isString(body.department) ||
    !isString(body.deliverableType) ||
    !isString(body.title) ||
    !isString(body.scopeType) ||
    !isString(body.scopeId) ||
    !isRecord(body.payload) ||
    (body.episodeId !== undefined && !isString(body.episodeId)) ||
    (body.sourceRefs !== undefined && !Array.isArray(body.sourceRefs)) ||
    (body.dependencyIds !== undefined && !isStringArray(body.dependencyIds)) ||
    (body.cost !== undefined &&
      typeof body.cost !== "number" &&
      typeof body.cost !== "string")
  )
    return attachSessionCookie(
      Response.json(
        { message: "PRODUCTION_DELIVERABLE_INPUT_INVALID" },
        { status: 400 },
      ),
      sessionId,
    );
  try {
    const deliverable = await createProductionDeliverable(user.id, projectId, {
      department: body.department,
      deliverableType: body.deliverableType,
      title: body.title,
      scopeType: body.scopeType,
      scopeId: body.scopeId,
      episodeId: isString(body.episodeId) ? body.episodeId : undefined,
      payload: body.payload,
      sourceRefs: body.sourceRefs as unknown[] | undefined,
      promptTrace: body.promptTrace,
      cost:
        typeof body.cost === "number" || typeof body.cost === "string"
          ? body.cost
          : undefined,
      dependencyIds: body.dependencyIds as string[] | undefined,
    });
    return attachSessionCookie(
      Response.json({ deliverable }, { status: 201 }),
      sessionId,
    );
  } catch (error) {
    return errorResponse(error, sessionId);
  }
}

function errorResponse(error: unknown, sessionId: string | null) {
  const known = error instanceof ProductionDeliverableError;
  return attachSessionCookie(
    Response.json(
      { message: known ? error.message : "PRODUCTION_DELIVERABLE_FAILED" },
      { status: known ? error.status : 500 },
    ),
    sessionId,
  );
}

async function readObject(request: Request) {
  const value: unknown = await request.json().catch(() => ({}));
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}
