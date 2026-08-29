import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/server/auth";

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user && !user.anonymous ? "/projects" : "/login");
}
