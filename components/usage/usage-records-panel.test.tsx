import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UsageRecordRow } from "./usage-records-panel";
import type { UsageRecord } from "@/lib/billing/usage-records";

const record: UsageRecord = {
  id: "c1", createdAt: "2026-10-15T10:37:05Z", user: { id: "u1", displayName: "User" }, project: null,
  model: "Model", apiType: "text", action: "model_request", quantity: 1100, unit: "tokens", cost: "0.000001",
  tokens: { input: 1000, output: 100, cacheRead: 200, cacheWrite: 50 },
};
describe("user-facing usage record", () => {
  it("shows recorded tokens, second precision and the full charge without right aligned cells or redundant token units", () => {
    const html = renderToStaticMarkup(<table><tbody><UsageRecordRow record={record} /></tbody></table>);
    expect(html).toContain("37:05");
    expect(html).toContain("1,000");
    expect(html).toContain("缓存写入 50");
    expect(html).toContain("0.000001");
    expect(html).not.toContain("令牌");
    expect(html).not.toContain("text-right");
    expect(html).not.toContain("1,100 Token");
  });
  it("shows missing token counts as dashes for non-token records", () => {
    const html = renderToStaticMarkup(<table><tbody><UsageRecordRow record={{ ...record, apiType: "image", unit: "image", quantity: 1, tokens: { input: null, output: null, cacheRead: null, cacheWrite: null } }} /></tbody></table>);
    expect(html).toContain("1 张");
    expect(html.match(/>—</g)).toHaveLength(3);
  });
});
