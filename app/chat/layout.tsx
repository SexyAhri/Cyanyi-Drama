import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/server/auth";

export default async function ChatLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user || user.anonymous) redirect("/login?next=/chat");
  return children;
}
