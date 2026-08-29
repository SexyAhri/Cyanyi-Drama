import { attachSessionCookie } from "@/lib/server/auth";
import { completeOAuthFlow, isOAuthProvider } from "@/lib/server/oauth";

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  if (!isOAuthProvider(provider)) {
    return Response.redirect(new URL("/login?oauth_error=unknown_provider", request.url));
  }
  try {
    const result = await completeOAuthFlow(provider, request);
    return attachSessionCookie(
      Response.redirect(new URL(result.redirectPath, request.url)),
      result.sessionId,
    );
  } catch (error) {
    const code = oauthErrorCode(error);
    return Response.redirect(new URL(`/login?oauth_error=${code}`, request.url));
  }
}

function oauthErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "oauth_failed";
  if (message.startsWith("LINUXDO_TRUST_LEVEL_LOW")) return "trust_level_low";
  if (message === "REGISTRATION_DISABLED") return "registration_disabled";
  if (message === "OAUTH_STATE_INVALID") return "state_invalid";
  if (message === "OAUTH_PROVIDER_ALREADY_BOUND") return "already_bound";
  return "oauth_failed";
}
