import { readStoredObject } from "@/lib/storage";
import { verifyLocalObjectUrl } from "@/lib/storage/local";

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: Context) {
  const { path } = await context.params;
  const key = path.join("/");
  const params = new URL(request.url).searchParams;
  if (
    !verifyLocalObjectUrl(key, params.get("expires"), params.get("signature"))
  )
    return Response.json({ message: "链接无效或已过期" }, { status: 403 });
  try {
    const body = await readStoredObject(key);
    return new Response(body, {
      headers: {
        "Content-Type": contentTypeForKey(key),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return Response.json({ message: "文件不存在" }, { status: 404 });
  }
}

function contentTypeForKey(key: string) {
  const extension = key.split(".").pop()?.toLowerCase();
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      mp4: "video/mp4",
      webm: "video/webm",
      mp3: "audio/mpeg",
      wav: "audio/wav",
    }[extension ?? ""] ?? "application/octet-stream"
  );
}
