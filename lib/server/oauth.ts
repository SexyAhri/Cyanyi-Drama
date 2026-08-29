import { createHash, randomBytes } from "node:crypto";

import { normalizeAuthRedirect } from "@/lib/auth/redirect";

import { getCurrentUser, loginWithExternalIdentity } from "./auth";
import { prisma } from "./prisma";
import { getOAuthProviderConfig } from "./system-settings";

const FLOW_TTL_MS = 10 * 60 * 1000;

export type OAuthProviderName = "github" | "linuxdo";

export async function beginOAuthFlow(
  provider: OAuthProviderName,
  request: Request,
  next?: string,
) {
  const config = await getOAuthProviderConfig(provider);
  const currentUser = await getCurrentUser();
  const state = randomBytes(32).toString("base64url");
  await prisma.authFlow.create({
    data: {
      tokenHash: hashState(state),
      provider,
      redirectPath: normalizeAuthRedirect(next),
      anonymousUserId: currentUser?.anonymous ? currentUser.id : null,
      expiresAt: new Date(Date.now() + FLOW_TTL_MS),
    },
  });
  const callbackUrl = oauthCallbackUrl(request, provider);
  const authorize = new URL(
    provider === "github"
      ? "https://github.com/login/oauth/authorize"
      : "https://connect.linux.do/oauth2/authorize",
  );
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("redirect_uri", callbackUrl);
  if (provider === "github") authorize.searchParams.set("scope", "user:email");
  else authorize.searchParams.set("response_type", "code");
  return authorize.toString();
}

export async function completeOAuthFlow(
  provider: OAuthProviderName,
  request: Request,
) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state")?.trim();
  const code = url.searchParams.get("code")?.trim();
  const providerError =
    url.searchParams.get("error_description") || url.searchParams.get("error");
  if (providerError) throw new Error(`OAUTH_PROVIDER_ERROR:${providerError}`);
  if (!state || !code) throw new Error("OAUTH_CALLBACK_INVALID");

  const flow = await prisma.authFlow.findFirst({
    where: {
      tokenHash: hashState(state),
      provider,
      intent: "login",
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!flow) throw new Error("OAUTH_STATE_INVALID");
  const claimed = await prisma.authFlow.updateMany({
    where: { id: flow.id, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (claimed.count !== 1) throw new Error("OAUTH_STATE_INVALID");

  const config = await getOAuthProviderConfig(provider);
  const callbackUrl = oauthCallbackUrl(request, provider);
  const profile =
    provider === "github"
      ? await fetchGitHubProfile(code, callbackUrl, config)
      : await fetchLinuxDoProfile(code, callbackUrl, config);
  const currentUser = await getCurrentUser();
  const previousAnonymousUserId =
    currentUser?.anonymous && currentUser.id === flow.anonymousUserId
      ? currentUser.id
      : undefined;
  const result = await loginWithExternalIdentity({
    provider,
    providerUserId: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    email: profile.email,
    profile: profile.raw,
    previousAnonymousUserId,
  });
  return { ...result, redirectPath: flow.redirectPath };
}

export function isOAuthProvider(value: string): value is OAuthProviderName {
  return value === "github" || value === "linuxdo";
}

async function fetchGitHubProfile(
  code: string,
  redirectUri: string,
  config: { clientId: string; clientSecret: string },
) {
  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const tokenPayload = (await tokenResponse.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
  };
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    throw new Error(
      tokenPayload.error_description || "OAUTH_TOKEN_EXCHANGE_FAILED",
    );
  }
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${tokenPayload.access_token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const [userResponse, emailsResponse] = await Promise.all([
    fetch("https://api.github.com/user", {
      headers,
      signal: AbortSignal.timeout(20_000),
    }),
    fetch("https://api.github.com/user/emails", {
      headers,
      signal: AbortSignal.timeout(20_000),
    }),
  ]);
  if (!userResponse.ok) throw new Error("OAUTH_USERINFO_FAILED");
  const user = (await userResponse.json()) as {
    id?: number;
    login?: string;
    name?: string | null;
  };
  const emails = emailsResponse.ok
    ? ((await emailsResponse.json()) as Array<{
        email?: string;
        primary?: boolean;
        verified?: boolean;
      }>)
    : [];
  const email =
    emails.find((item) => item.primary && item.verified)?.email ||
    emails.find((item) => item.verified)?.email;
  if (!user.id || !user.login) throw new Error("OAUTH_USERINFO_INVALID");
  return {
    id: String(user.id),
    username: user.login,
    displayName: user.name || user.login,
    email,
    raw: { id: user.id, login: user.login, name: user.name, email },
  };
}

async function fetchLinuxDoProfile(
  code: string,
  redirectUri: string,
  config: {
    clientId: string;
    clientSecret: string;
    minimumTrustLevel: number;
  },
) {
  const credentials = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
  ).toString("base64");
  const tokenResponse = await fetch("https://connect.linux.do/oauth2/token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const tokenPayload = (await tokenResponse.json().catch(() => ({}))) as {
    access_token?: string;
    message?: string;
  };
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    throw new Error(tokenPayload.message || "OAUTH_TOKEN_EXCHANGE_FAILED");
  }
  const userResponse = await fetch("https://connect.linux.do/api/user", {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${tokenPayload.access_token}`,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!userResponse.ok) throw new Error("OAUTH_USERINFO_FAILED");
  const user = (await userResponse.json()) as {
    id?: number;
    username?: string;
    name?: string;
    active?: boolean;
    silenced?: boolean;
    trust_level?: number;
  };
  if (!user.id || !user.username) throw new Error("OAUTH_USERINFO_INVALID");
  if (user.active === false || user.silenced === true) {
    throw new Error("LINUXDO_ACCOUNT_UNAVAILABLE");
  }
  if ((user.trust_level ?? 0) < config.minimumTrustLevel) {
    throw new Error(`LINUXDO_TRUST_LEVEL_LOW:${config.minimumTrustLevel}`);
  }
  return {
    id: String(user.id),
    username: user.username,
    displayName: user.name || user.username,
    email: undefined,
    raw: {
      id: user.id,
      username: user.username,
      name: user.name,
      active: user.active,
      silenced: user.silenced,
      trustLevel: user.trust_level,
    },
  };
}

function hashState(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function oauthCallbackUrl(request: Request, provider: OAuthProviderName) {
  const origin = (
    process.env.APP_BASE_URL?.trim() || new URL(request.url).origin
  ).replace(/\/$/, "");
  return `${origin}/api/auth/oauth/${provider}/callback`;
}
