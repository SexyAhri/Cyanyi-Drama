import type { Metadata } from "next";

import { ProjectsPage } from "@/features/studio/components/projects-page";

export const metadata: Metadata = {
  title: "Projects · Cyanyi Drama",
};

export default function ProjectsRoute() {
  return <ProjectsPage />;
}
