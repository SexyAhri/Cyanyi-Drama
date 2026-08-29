import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { WorkspacePage } from "@/features/studio/components/workspace-page";
import { getCurrentUser } from "@/lib/server/auth";

export const metadata: Metadata = {
  title: "Workspace · Cyanyi Drama",
};

export default async function ProjectWorkspaceRoute({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await getCurrentUser();
  if (!user || user.anonymous) {
    redirect(`/login?next=${encodeURIComponent(`/projects/${projectId}`)}`);
  }
  return (
    <Suspense fallback={<WorkspaceRouteFallback />}>
      <WorkspacePage projectId={projectId} user={user} />
    </Suspense>
  );
}

function WorkspaceRouteFallback() {
  return <div className="h-dvh bg-background" />;
}
