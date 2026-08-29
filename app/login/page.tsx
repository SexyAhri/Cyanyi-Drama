import type { Metadata } from "next";
import { redirect } from "next/navigation";
import packageJson from "../../package.json";

import { AuthPage } from "@/components/auth/auth-page";
import { normalizeAuthRedirect } from "@/lib/auth/redirect";
import { getPublicAuthConfig } from "@/lib/server/auth-config";
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
  const rawMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const rawOauthError = Array.isArray(params.oauth_error)
    ? params.oauth_error[0]
    : params.oauth_error;
  const nextPath = normalizeAuthRedirect(rawNext);
  const user = await getCurrentUser();
  const authConfig = await getPublicAuthConfig();

  if (user && !user.anonymous) {
    redirect(nextPath);
  }

  return (
    <AuthPage
      appVersion={packageJson.version}
      authConfig={authConfig}
      hasAnonymousSession={Boolean(user?.anonymous)}
      initialMode={rawMode === "register" ? "register" : "login"}
      nextPath={nextPath}
      oauthError={rawOauthError}
    />
  );
}
