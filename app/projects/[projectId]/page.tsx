import type { Metadata } from "next";
import { Suspense } from "react";

import { WorkspacePage } from "@/features/studio/components/workspace-page";

export const metadata: Metadata = {
  title: "Workspace · Cyanyi Drama",
};

export default async function ProjectWorkspaceRoute({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <Suspense fallback={<WorkspaceRouteFallback />}>
      <WorkspacePage projectId={projectId} />
    </Suspense>
  );
}

function WorkspaceRouteFallback() {
  return <div className="h-dvh bg-background" />;
}
