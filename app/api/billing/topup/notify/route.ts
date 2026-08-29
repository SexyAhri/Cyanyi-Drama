import { settleEpayNotification } from "@/lib/billing/epay";

export async function GET(request: Request) {
  return handleNotification(Object.fromEntries(new URL(request.url).searchParams));
}

export async function POST(request: Request) {
  const form = await request.formData();
  const parameters = Object.fromEntries(
    [...form.entries()].map(([key, value]) => [key, String(value)]),
  );
  return handleNotification(parameters);
}

async function handleNotification(parameters: Record<string, string>) {
  try {
    await settleEpayNotification(parameters);
    return new Response("success", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch {
    return new Response("fail", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
