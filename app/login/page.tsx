import type { Metadata } from "next";
import { redirect } from "next/navigation";
import packageJson from "../../package.json";

import { AuthPage } from "@/components/auth/auth-page";
import { normalizeAuthRedirect } from "@/lib/auth/redirect";
import { getCurrentUser } from "@/lib/server/auth";

export const metadata: Metadata = {
  title: "登录 · Cyanyi Drama",
};

export default async function LoginRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const nextPath = normalizeAuthRedirect(rawNext);
  const user = await getCurrentUser();

  if (user && !user.anonymous) {
    redirect(nextPath);
  }

  return (
    <AuthPage
      appVersion={packageJson.version}
      hasAnonymousSession={Boolean(user?.anonymous)}
      nextPath={nextPath}
    />
  );
}
