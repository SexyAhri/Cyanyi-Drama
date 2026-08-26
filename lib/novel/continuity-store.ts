import { prisma } from "@/lib/server/prisma";

export type StoryboardContinuityIssue = {
  clipId: string;
  code: string;
  severity: "error" | "warning";
  panelIndex: number | null;
  entityType:
    | "character"
    | "location"
    | "prop"
    | "camera"
    | "timeline"
    | null;
  entityName: string | null;
  message: string;
  suggestedFix: string | null;
};

export async function listLatestStoryboardContinuityIssues(
  userId: string,
  projectId: string,
  episodeId: string,
) {
  const run = await prisma.workflowRun.findFirst({
    where: {
      userId,
      projectId,
      episodeId,
      workflowType: "script-to-storyboard",
    },
    orderBy: { updatedAt: "desc" },
    select: {
      artifacts: {
        where: { artifactType: "storyboard.clip.continuity" },
        select: { refId: true, payload: true },
      },
    },
  });
  return normalizeContinuityArtifacts(run?.artifacts ?? []);
}

export function normalizeContinuityArtifacts(
  artifacts: Array<{ refId: string | null; payload: unknown }>,
) {
  return artifacts.flatMap((artifact): StoryboardContinuityIssue[] => {
    if (!artifact.refId || !isRecord(artifact.payload)) return [];
    const clipId = artifact.refId;
    const data = artifact.payload.data;
    if (artifact.payload.success !== true || !isRecord(data)) return [];
    const issues = Array.isArray(data.issues) ? data.issues : [];
    return issues.flatMap((value) => {
      if (!isRecord(value)) return [];
      if (
        typeof value.code !== "string" ||
        typeof value.message !== "string" ||
        (value.severity !== "error" && value.severity !== "warning")
      ) {
        return [];
      }
      const entityType = isEntityType(value.entityType)
        ? value.entityType
        : null;
      return [
        {
          clipId,
          code: value.code,
          severity: value.severity,
          panelIndex:
            typeof value.panelIndex === "number" &&
            Number.isInteger(value.panelIndex) &&
            value.panelIndex >= 0
              ? value.panelIndex
              : null,
          entityType,
          entityName:
            typeof value.entityName === "string" ? value.entityName : null,
          message: value.message,
          suggestedFix:
            typeof value.suggestedFix === "string"
              ? value.suggestedFix
              : null,
        },
      ];
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isEntityType(
  value: unknown,
): value is NonNullable<StoryboardContinuityIssue["entityType"]> {
  return (
    value === "character" ||
    value === "location" ||
    value === "prop" ||
    value === "camera" ||
    value === "timeline"
  );
}
