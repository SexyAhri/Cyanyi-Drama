import { submitEpisodeProductionRequest } from "@/lib/studio/production-http";
type Context = { params: Promise<{ projectId: string; episodeId: string }> };
export function POST(request: Request, context: Context) {
  return submitEpisodeProductionRequest(request, context, "start_voice_design");
}
