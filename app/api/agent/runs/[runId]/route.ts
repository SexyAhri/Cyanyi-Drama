import { getLangGraphRunState } from "@/lib/agent/langgraph-runtime";

export async function GET(
  _request: Request,
  { params }: { params: Promise<unknown> }
) {
  const { runId } = (await params) as { runId: string };

  return Response.json(await getLangGraphRunState(runId));
}
