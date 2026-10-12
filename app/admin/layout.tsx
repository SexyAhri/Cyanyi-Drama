import { redirect } from "next/navigation";

import { AdminShell } from "@/components/admin/admin-shell";
import { getCurrentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user || user.anonymous) redirect("/login?next=/admin/channels");
  if (user.role !== "ADMIN") redirect("/projects");
  return <AdminShell user={user}>{children}</AdminShell>;
}
