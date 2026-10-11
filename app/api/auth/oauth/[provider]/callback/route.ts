import { attachSessionCookie } from "@/lib/server/auth";
import {
  clearOAuthStateCookieHeader,
  completeOAuthFlow,
  isOAuthProvider,
} from "@/lib/server/oauth";

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  let response: Response;
  if (!isOAuthProvider(provider)) {
    response = Response.redirect(
      new URL("/login?oauth_error=unknown_provider", request.url),
    );
  } else {
    try {
      const result = await completeOAuthFlow(provider, request);
      response = attachSessionCookie(
        Response.redirect(new URL(result.redirectPath, request.url)),
        result.sessionId,
      );
    } catch (error) {
      const code = oauthErrorCode(error);
      response = Response.redirect(
        new URL(`/login?oauth_error=${code}`, request.url),
      );
    }
  }
  const stateCookie = clearOAuthStateCookieHeader(request);
  if (stateCookie) response.headers.append("Set-Cookie", stateCookie);
  return response;
}

function oauthErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "oauth_failed";
  if (message.startsWith("LINUXDO_TRUST_LEVEL_LOW")) return "trust_level_low";
  if (message === "REGISTRATION_DISABLED") return "registration_disabled";
  if (message === "OAUTH_STATE_INVALID") return "state_invalid";
  if (message === "OAUTH_PROVIDER_ALREADY_BOUND") return "already_bound";
  return "oauth_failed";
}
