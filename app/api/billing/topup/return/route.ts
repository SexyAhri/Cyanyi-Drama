export async function GET(request: Request) {
  const url = new URL(request.url);
  const tradeNo = url.searchParams.get("out_trade_no")?.trim();
  const destination = new URL("/chat", request.url);
  destination.searchParams.set("payment", tradeNo ? "returned" : "unknown");
  if (tradeNo) destination.searchParams.set("trade_no", tradeNo);
  return Response.redirect(destination);
}
