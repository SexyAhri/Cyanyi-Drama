import { listUsageRecords } from "@/lib/billing/usage-records-store";
import { AdminRequiredError, requireAdmin } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (error) {
    return adminError(error);
  }

  return Response.json(await listUsageRecords(new URL(request.url).searchParams));
}

function adminError(error: unknown) {
  return Response.json(
    { message: "仅管理员可以查看全站用量记录" },
    { status: error instanceof AdminRequiredError ? 403 : 500 },
  );
}
