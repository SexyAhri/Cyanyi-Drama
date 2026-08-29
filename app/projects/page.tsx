import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProjectsPage } from "@/features/studio/components/projects-page";
import { getCurrentUser } from "@/lib/server/auth";

export const metadata: Metadata = {
  title: "Projects · Cyanyi Drama",
};

export default async function ProjectsRoute() {
  const user = await getCurrentUser();
  if (!user || user.anonymous) redirect("/login?next=/projects");
  return <ProjectsPage user={user} />;
}
