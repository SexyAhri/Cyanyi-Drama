/** Explicit opt-in integration check. Only random fixtures are written; no real model is called. */
import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { prisma } from "../lib/server/prisma";
import { creditUserBalance, saveModelPricePlan } from "../lib/billing/service";
import { reserveModelRequestCharge, settleModelRequestCharge, releaseExpiredModelRequestCharges } from "../lib/billing/model-charge";
import { requestOpenAiText } from "../lib/llm/openai-structured";
import { renderPrompt, PROMPT_IDS } from "../lib/prompts";

async function main() {
  if (!process.argv.includes("--run")) throw new Error("Use --run against a local test database; creates and cleans random fixtures.");
  const userId = randomUUID(), provider = `token-verify-${randomUUID()}`, model = "token-fixture";
  const identity = { userId, provider };
  const key = { provider, model, capability: "text" };
  const rates = [
    { unit: "1m_input_tokens", unitPrice: "2" },
    { unit: "1m_output_tokens", unitPrice: "8" },
    { unit: "1m_cached_input_tokens", unitPrice: "0.2" },
  ];
  const usage = { inputTokens: 1_000_000, outputTokens: 100_000, cachedInputTokens: 200_000 };
  const snapshot = async () => createHash("sha256").update(JSON.stringify(await Promise.all([
    prisma.modelPrice.findMany({ where: { provider: { not: provider } }, orderBy: { id: "asc" } }),
    prisma.usageCost.findMany({ where: { userId: { not: userId } }, orderBy: { id: "asc" } }),
    prisma.balanceFreeze.findMany({ where: { userId: { not: userId } }, orderBy: { id: "asc" } }),
    prisma.userBalance.findMany({ where: { userId: { not: userId } }, orderBy: { id: "asc" } }),
    prisma.balanceTransaction.findMany({ where: { userId: { not: userId } }, orderBy: { id: "asc" } }),
  ]))).digest("hex");
  const before = await snapshot();
  let checks = 0, calls = 0;
  const check = (label: string) => { checks++; console.log(`PASS ${label}`); };
  const reserve = () => reserveModelRequestCharge({ identity, model, capability: "text", action: "integration", usage: { inputCharacters: 10, requests: 1 } });
  const server = createServer((_req, res) => {
    calls++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "local fixture response" }, finish_reason: "stop" }], usage: { prompt_tokens: 1_000_000, completion_tokens: 100_000, prompt_tokens_details: { cached_tokens: 200_000 } } }));
  });
  try {
    await prisma.user.create({ data: { id: userId, displayName: "Disposable token billing verification" } });
    await creditUserBalance({ userId, amount: 100, idempotencyKey: randomUUID() });
    if (process.argv.includes("--http")) {
      const session = randomUUID();
      await prisma.session.create({ data: { id: createHash("sha256").update(session).digest("hex"), userId, expiresAt: new Date(Date.now() + 300_000) } });
      const api = (method: string, body?: unknown, cookie = `cyanyi_session=${session}`) => fetch(`http://localhost:3001/api/billing/prices${method === "DELETE" ? `?${new URLSearchParams(key)}` : ""}`, { method, headers: { "Content-Type": "application/json", Cookie: cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.equal((await api("PUT", { ...key, rates }, "")).status, 403);
      assert.equal((await api("PUT", { ...key, rates })).status, 403);
      assert.equal((await api("DELETE")).status, 403);
      await prisma.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
      assert.equal((await api("PUT", { ...key, rates: rates.slice(0, 2) })).status, 400);
      assert.equal((await api("PUT", { ...key, rates })).status, 200);
      assert.equal(await prisma.modelPrice.count({ where: { ...key, active: true } }), 3);
      assert.equal((await api("DELETE")).status, 200);
      assert.equal(await prisma.modelPrice.count({ where: { ...key, active: true } }), 0);
      await prisma.modelPrice.deleteMany({ where: key });
      check("real Next HTTP admin guards, grouped save, validation and soft-disable");
    }
    await prisma.modelPrice.createMany({ data: ["request", "1k_character"].map(unit => ({ ...key, unit, unitPrice: "0.1" })) });
    const legacyCharge = await reserve();
    await saveModelPricePlan({ ...key, rates });
    assert.equal(await prisma.modelPrice.count({ where: { ...key, active: true } }), 3);
    assert.equal(await prisma.modelPrice.count({ where: { ...key, active: false } }), 2);
    assert.equal((await settleModelRequestCharge(legacyCharge, true))?.amount, "0.2");
    check("atomic plan replacement retains old rows and existing legacy freezes");

    const charge = await reserve(); assert.ok(charge);
    await saveModelPricePlan({ ...key, rates: rates.map(rate => ({ ...rate, unitPrice: "99" })) });
    const receipts = await Promise.all([settleModelRequestCharge(charge, true, usage), settleModelRequestCharge(charge, true, usage)]);
    assert.ok(receipts.every(receipt => receipt?.amount === "2.44"));
    assert.equal(await prisma.usageCost.count({ where: { userId, id: receipts[0]!.id } }), 1);
    assert.equal((await settleModelRequestCharge(charge, true, { inputTokens: 0, outputTokens: 0 }))?.amount, "2.44");
    assert.equal((await prisma.userBalance.findUniqueOrThrow({ where: { userId } })).totalSpent.toString(), "2.64");
    check("frozen rates survive edits; concurrent/repeated settlement charges once");

    await saveModelPricePlan({ ...key, rates });
    const writtenUsage = { ...usage, outputTokens: 0, cacheWriteTokens: 100_000 };
    assert.equal((await settleModelRequestCharge(await reserve(), true, writtenUsage))?.amount, "1.64");
    await saveModelPricePlan({ ...key, rates: [...rates, { unit: "1m_cache_write_tokens", unitPrice: "3" }] });
    assert.equal((await settleModelRequestCharge(await reserve(), true, writtenUsage))?.amount, "1.74");
    check("cache reads and optional writes never double-charge normal input");

    const invalid = await reserve(); assert.ok(invalid);
    await assert.rejects(settleModelRequestCharge(invalid, true, null), /Token/);
    assert.equal((await prisma.balanceFreeze.findUniqueOrThrow({ where: { id: invalid.id } })).status, "released");
    const failed = await reserve(); assert.ok(failed);
    await settleModelRequestCharge(failed, false);
    assert.equal((await prisma.balanceFreeze.findUniqueOrThrow({ where: { id: failed.id } })).status, "released");
    check("missing usage and provider failure release rather than bill estimates");

    await saveModelPricePlan({ ...key, rates });
    const recover = await reserve(); assert.ok(recover);
    const balance = await prisma.userBalance.findUniqueOrThrow({ where: { userId } });
    await prisma.userBalance.delete({ where: { userId } });
    await assert.rejects(settleModelRequestCharge(recover, true, usage));
    const persisted = JSON.parse((await prisma.balanceFreeze.findUniqueOrThrow({ where: { id: recover.id } })).metadata!);
    assert.equal(persisted.requestSucceeded, true); assert.deepEqual(persisted.actualUsage, usage);
    await prisma.userBalance.create({ data: balance });
    assert.equal(await releaseExpiredModelRequestCharges(new Date(), userId), 1);
    assert.equal((await settleModelRequestCharge(recover, false))?.amount, "2.44");
    check("provider usage survives wallet failure and reconciles using the frozen price");

    const pending = await reserve(); assert.ok(pending);
    const other = await reserve(); assert.ok(other);
    const lowBalance = await prisma.userBalance.findUniqueOrThrow({ where: { userId } });
    await prisma.userBalance.update({ where: { userId }, data: { balance: lowBalance.frozenAmount } });
    await assert.rejects(settleModelRequestCharge(pending, true, usage), /余额/);
    await prisma.balanceFreeze.update({ where: { id: other.id }, data: { expiresAt: new Date(0) } });
    assert.equal(await releaseExpiredModelRequestCharges(new Date(), userId), 1);
    assert.equal((await prisma.balanceFreeze.findUniqueOrThrow({ where: { id: pending.id } })).status, "pending");
    await creditUserBalance({ userId, amount: 100, idempotencyKey: randomUUID() });
    assert.equal(await releaseExpiredModelRequestCharges(new Date(), userId), 1);
    check("insufficient actual balance retains usage without blocking other reconciliation; top-up recovers");

    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const response = await requestOpenAiText({ billing: identity, provider, model, apiKeys: ["local-test-only"], baseUrl: `http://127.0.0.1:${address.port}/v1`, stream: false,
      prompt: renderPrompt({ id: PROMPT_IDS.STORY_CHARACTER_ANALYSIS, variables: { source_text: "local source", character_library: "[]" } }),
    });
    assert.equal(calls, 1); assert.equal(response.trace.billing[0].amount, "2.44");
    const ledger = await prisma.usageCost.findUniqueOrThrow({ where: { id: response.trace.billing[0].id } });
    assert.equal(ledger.unit, "tokens"); assert.equal(Number(ledger.quantity), 1_100_000);
    assert.equal(JSON.parse(ledger.metadata!).actualUsage.cachedInputTokens, 200_000);
    check("real HTTP adapter -> provider usage -> PostgreSQL wallet and itemized ledger");

    await saveModelPricePlan({ ...key, rates: rates.map(rate => ({ ...rate, unitPrice: "0" })) });
    assert.equal((await settleModelRequestCharge(await reserve(), true, usage))?.amount, "0");
    assert.equal((await prisma.userBalance.findUniqueOrThrow({ where: { userId } })).frozenAmount.toString(), "0");
    await assert.rejects(saveModelPricePlan({ ...key, rates: rates.slice(0, 2) }));
    assert.equal(await prisma.modelPrice.count({ where: { ...key, active: true } }), 3);
    check("explicit free prices settle at zero; rejected plans do not mutate effective rates");
    await prisma.modelPrice.updateMany({ where: { ...key, unit: "1m_output_tokens" }, data: { active: false } });
    await assert.rejects(reserve(), /不完整/);
    check("corrupt/incomplete token plans block external calls");
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.modelPrice.deleteMany({ where: { provider } });
    await prisma.user.deleteMany({ where: { id: userId } });
    assert.equal(await snapshot(), before, "Existing billing rows changed during verification");
    assert.equal(await prisma.user.count({ where: { id: userId } }), 0);
    console.log(`Cleaned exact random fixtures; existing billing data unchanged. ${checks} checks, ${calls} local stub calls.`);
  }
}
main().finally(() => prisma.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
