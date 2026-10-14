export type WorkflowRequestUpdate = {
  requestId: string;
  requestType: string;
  status: "running" | "succeeded" | "failed";
  targetType?: string;
  targetId?: string;
  provider?: string;
  model?: string;
  inputHash?: string;
  input?: unknown;
  artifactRefs?: string[];
  error?: string;
  reused?: boolean;
  reuseReason?: "cache_fingerprint_match" | "previous_validated_artifact";
  cacheVersion?: string;
  promptVersion?: string;
  promptVersionHash?: string;
};

export async function recordWorkflowArtifactReuse(input: {
  recordRequest?: (request: WorkflowRequestUpdate) => Promise<void>;
  request: Omit<WorkflowRequestUpdate, "status" | "artifactRefs" | "error" | "reused" | "reuseReason">;
  artifactRefs: string[];
  reuseReason: NonNullable<WorkflowRequestUpdate["reuseReason"]>;
}) {
  await input.recordRequest?.({
    ...input.request,
    status: "succeeded",
    artifactRefs: input.artifactRefs,
    reused: true,
    reuseReason: input.reuseReason,
  });
}

export async function trackWorkflowRequest<T>(input: {
  recordRequest?: (request: WorkflowRequestUpdate) => Promise<void>;
  request: Omit<WorkflowRequestUpdate, "status" | "artifactRefs" | "error">;
  execute: () => Promise<{ result: T; artifactRefs?: string[] }>;
}): Promise<T> {
  await input.recordRequest?.({ ...input.request, status: "running" });
  const requestSummary = Object.fromEntries(
    Object.entries(input.request).filter(([key]) => key !== "input"),
  ) as typeof input.request;
  try {
    const completed = await input.execute();
    await input.recordRequest?.({
      ...requestSummary,
      status: "succeeded",
      artifactRefs: completed.artifactRefs,
    });
    return completed.result;
  } catch (error) {
    await input.recordRequest?.({
      ...requestSummary,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
