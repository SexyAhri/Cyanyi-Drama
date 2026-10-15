/** Read-only diagnosis. Never invokes a model or changes a workflow, price or bill. */
import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/server/prisma";

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function parse(value: unknown) {
  try {
    return object(typeof value === "string" ? JSON.parse(value) : value);
  } catch {
    return {};
  }
}
function stageLabel(data: Record<string, unknown>, fallback: string) {
  if (data.firstEpisode) return "第一集正文";
  if (data.videoPrompt) return "场次视听设计";
  if (data.format) return "全剧规划";
  if (Array.isArray(data.episodeOutlines)) return "逐集大纲";
  for (const kind of ["characters", "props", "locations"])
    if (Array.isArray(data[kind])) {
      const values = data[kind] as Array<Record<string, unknown>>;
      if (values.some((value) => value.imagePrompt))
        return `资产档案 · ${values.map((value) => String(value.name)).join("、")}`;
      return "资产名册";
    }
  return fallback;
}

async function main() {
  const projectId = option("--project");
  if (!projectId)
    throw new Error(
      "Pass --project <id>; this command reads that project's records only.",
    );
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) throw new Error("Project not found");
  const [costs, artifacts] = await Promise.all([
    prisma.usageCost.findMany({
      where: { projectId, apiType: "text" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        action: true,
        metadata: true,
        cost: true,
        createdAt: true,
      },
    }),
    prisma.workflowArtifact.findMany({
      where: {
        run: { projectId },
        artifactType: { in: ["story-package.phase", "prompt.trace"] },
      },
      orderBy: { createdAt: "asc" },
      select: { artifactType: true, payload: true },
    }),
  ]);
  const receiptStages = new Map<
    string,
    {
      label: string;
      fields: string[];
      outputCharacters: number;
      corrections: number;
    }
  >();
  for (const artifact of artifacts) {
    const payload = object(artifact.payload),
      trace =
        artifact.artifactType === "story-package.phase"
          ? object(payload.trace)
          : payload;
    const data = object(payload.data);
    const label = stageLabel(
      data,
      typeof trace.promptId === "string" ? trace.promptId : "未归因请求",
    );
    for (const receipt of Array.isArray(trace.billing) ? trace.billing : []) {
      const id = object(receipt).id;
      if (typeof id !== "string" || receiptStages.has(id)) continue;
      receiptStages.set(id, {
        label,
        fields: Object.keys(data),
        outputCharacters: Number(
          object(trace.characterUsage).outputCharacters ?? 0,
        ),
        corrections: Number(trace.correctionAttempts ?? 0),
      });
    }
  }
  const requests = costs.map((entry, index) => {
    const metadata = parse(entry.metadata),
      usage = object(metadata.actualUsage),
      stage = receiptStages.get(entry.id);
    return {
      index: index + 1,
      atUtc: entry.createdAt.toISOString(),
      stage: stage?.label ?? entry.action,
      outputFields: stage?.fields ?? [],
      inputTokens: Number(usage.inputTokens ?? 0),
      outputTokens: Number(usage.outputTokens ?? 0),
      cachedInputTokens: Number(usage.cachedInputTokens ?? 0),
      inputCharacters: Number(object(metadata.usage).inputCharacters ?? 0),
      outputCharacters: stage?.outputCharacters ?? null,
      correctionAttempts: stage?.corrections ?? null,
      applicationCharge: entry.cost.toString(),
    };
  });
  const totals = requests.reduce(
    (sum, request) => ({
      requests: sum.requests + 1,
      inputTokens: sum.inputTokens + request.inputTokens,
      outputTokens: sum.outputTokens + request.outputTokens,
      cachedInputTokens: sum.cachedInputTokens + request.cachedInputTokens,
    }),
    { requests: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  );
  const report = {
    project,
    method:
      "UsageCost actualUsage, joined to phase trace billing receipt IDs; each bill counted once",
    totals,
    requests,
    limitations: [
      "No raw HTTP prompt bodies were recorded for this run. Input character counts cannot prove exact repeated context or potential cache savings.",
      "No new model calls or same-task quality comparison were performed. Do not infer wasted tokens, incorrect billing or free upstream service.",
    ],
  };
  const out = option("--out");
  if (out) {
    const target = path.resolve(out);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(report, null, 2) + "\n", "utf8");
  }
  console.log(JSON.stringify(report));
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Usage diagnosis failed",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
