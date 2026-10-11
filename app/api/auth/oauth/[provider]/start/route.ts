import { beginOAuthFlow, isOAuthProvider } from "@/lib/server/oauth";

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  if (!isOAuthProvider(provider)) {
    return Response.json({ message: "不支持的登录服务" }, { status: 404 });
  }
  try {
    const next = new URL(request.url).searchParams.get("next") ?? undefined;
    const flow = await beginOAuthFlow(provider, request, next);
    const response = Response.redirect(flow.authorizeUrl);
    response.headers.append("Set-Cookie", flow.stateCookie);
    return response;
  } catch {
    return Response.redirect(new URL("/login?oauth_error=service_unavailable", request.url));
  }
}
