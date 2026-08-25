export const dynamic = "force-dynamic";

const allowedHosts = new Set([
  "cdn.jsdelivr.net",
  "github.com",
  "pbs.twimg.com",
  "raw.githubusercontent.com",
  "user-images.githubusercontent.com",
]);

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const imageUrl = requestUrl.searchParams.get("url");

  if (!imageUrl) {
    return new Response("Missing image url.", { status: 400 });
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    return new Response("Invalid image url.", { status: 400 });
  }

  if (!allowedHosts.has(parsedUrl.hostname)) {
    return new Response("Image host is not allowed.", { status: 400 });
  }

  try {
    const response = await fetch(parsedUrl, {
      cache: "no-store",
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 AppleWebKit/537.36 Chrome Safari",
      },
    });

    if (!response.ok || !response.body) {
      return new Response("Image fetch failed.", { status: 502 });
    }

    return new Response(response.body, {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Type":
          response.headers.get("content-type") || "application/octet-stream",
      },
    });
  } catch {
    return new Response("Image fetch failed.", { status: 502 });
  }
}
