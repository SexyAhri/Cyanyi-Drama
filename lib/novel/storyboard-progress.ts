import { z } from "zod";
import { prisma } from "@/lib/server/prisma";

const previewPanelSchema = z.object({
  panelIndex: z.number().int().nonnegative(),
  previewId: z.string().optional(),
  sceneId: z.string().optional(),
  description: z.string().nullish(),
  durationSeconds: z.number().nullish(),
  locationName: z.string().nullish(),
  characters: z.array(z.string()).default([]),
  shotType: z.string().nullish(),
  speakingCharacter: z.string().nullish(),
  lipSyncText: z.string().nullish(),
  voiceoverText: z.string().nullish(),
  imagePrompt: z.string().default(""),
  videoPrompt: z.string().default(""),
});
const checkpointSchema = z.object({
  panels: z.array(previewPanelSchema),
  hash: z.string().optional(),
  sceneId: z.string().optional(),
  sceneNumber: z.number().optional(),
  updatedAt: z.string().optional(),
  reviewState: z.enum(["pending", "approved", "required"]).optional(),
  review: z
    .object({
      approved: z.boolean(),
      findings: z.array(z.object({ severity: z.string() })).default([]),
    })
    .optional(),
});
export type StoryboardProgress = {
  runId: string;
  status: string;
  phase: string;
  startedAt: string;
  updatedAt: string;
  totalPanels: number | null;
  totalBatches: number | null;
  totalScenes: number | null;
  completedScenes: number;
  completedPanels: number;
  completedBatches: number;
  panels: (z.infer<typeof previewPanelSchema> & {
    previewId: string;
    needsReview: boolean;
    reviewState: "pending" | "approved" | "required";
  })[];
};

export async function loadStoryboardProgress(
  userId: string,
  projectId: string,
  episodeId: string,
): Promise<StoryboardProgress | null> {
  const run = await prisma.workflowRun.findFirst({
    where: {
      userId,
      projectId,
      episodeId,
      workflowType: { in: ["script-to-storyboard", "episode-preproduction"] },
      steps: { some: { stepKey: "build_scene_storyboard" } },
      project: { userId },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      steps: { where: { stepKey: "build_scene_storyboard" }, select: { status: true } },
      startedAt: true,
      createdAt: true,
      artifacts: {
        where: {
          artifactType: {
            in: [
              "storyboard.director.batch",
              "storyboard.director.scene",
              "storyboard.director.progress",
            ],
          },
        },
        orderBy: { createdAt: "asc" },
        select: { artifactType: true, payload: true, createdAt: true },
      },
    },
  });
  if (!run || run.status === "succeeded" || run.steps[0]?.status === "succeeded") return null;
  const phaseStatus = ["paused", "canceled", "canceling"].includes(run.status) ? run.status : run.steps[0]?.status ?? run.status;
  const metadata = run.artifacts.find(
    (artifact) => artifact.artifactType === "storyboard.director.progress",
  );
  const totals = z
    .object({
      version: z.number().optional(),
      phase: z.string().optional(),
      totalPanels: z.number().int().nonnegative().nullable().optional(),
      totalBatches: z.number().int().nonnegative().optional(),
      totalScenes: z.number().int().nonnegative().optional(),
      sceneHashes: z.record(z.string(), z.string()).optional(),
      updatedAt: z.string().optional(),
    })
    .safeParse(metadata?.payload);
  const info = totals.success ? totals.data : undefined;
  const isScenePlan = (info?.version ?? 0) >= 5;
  const checkpoints = run.artifacts
    .flatMap((artifact) => {
      if (
        artifact.artifactType !==
        (isScenePlan
          ? "storyboard.director.scene"
          : "storyboard.director.batch")
      )
        return [];
      const parsed = checkpointSchema.safeParse(artifact.payload);
      if (!parsed.success) return [];
      const data = parsed.data;
      if (
        isScenePlan &&
        (!data.sceneId || data.hash !== info?.sceneHashes?.[data.sceneId])
      )
        return [];
      return [
        { ...data, at: data.updatedAt ?? artifact.createdAt.toISOString() },
      ];
    })
    .sort(
      (a, b) =>
        (a.sceneNumber ?? a.panels[0]?.panelIndex ?? 0) -
        (b.sceneNumber ?? b.panels[0]?.panelIndex ?? 0),
    );
  const panels = [
    ...new Map(
      checkpoints.flatMap((checkpoint) => {
        const reviewState =
          checkpoint.reviewState ??
          (!checkpoint.review
            ? "pending"
            : checkpoint.review.approved &&
                !checkpoint.review.findings.some(
                  (finding) => finding.severity !== "minor",
                )
              ? "approved"
              : "required");
        return checkpoint.panels.map((panel) => {
          const previewId = panel.previewId ?? `legacy:${panel.panelIndex}`;
          return [
            previewId,
            {
              ...panel,
              previewId,
              reviewState,
              needsReview: reviewState === "required",
            },
          ] as const;
        });
      }),
    ).values(),
  ].map((panel, panelIndex) => ({
    ...panel,
    panelIndex: isScenePlan ? panelIndex : panel.panelIndex,
  }));
  const updatedAt =
    [info?.updatedAt, ...checkpoints.map((checkpoint) => checkpoint.at)]
      .filter((value): value is string => !!value)
      .sort()
      .at(-1) ?? run.createdAt.toISOString();
  return {
    runId: run.id,
    status: phaseStatus,
    phase: info?.phase ?? "generating",
    startedAt: (run.startedAt ?? run.createdAt).toISOString(),
    updatedAt,
    totalPanels: info?.totalPanels ?? null,
    totalBatches: info?.totalBatches ?? null,
    totalScenes: info?.totalScenes ?? null,
    completedPanels: panels.length,
    completedBatches: isScenePlan ? 0 : checkpoints.length,
    completedScenes: isScenePlan ? checkpoints.length : 0,
    panels,
  };
}
