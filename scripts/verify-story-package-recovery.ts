/** Opt-in real HTTP/PostgreSQL/workflow/wallet check; all model responses are local fixtures. */
import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { prisma } from "../lib/server/prisma";
import { encryptSecret } from "../lib/server/crypto";
import { processWorkflowJob } from "../lib/workflow/runtime";
import { getWorkflowQueue } from "../lib/queue/workflow-queue";
import { getRedisConnection } from "../lib/queue/connection";
import { makePackage, phaseResponses } from "../lib/production/story-package-test-fixture";
import { createProductionDeliverable } from "../lib/production/deliverables";

async function main() {
  if (!process.argv.includes("--run")) throw new Error("Requires --run; creates and cleans only random local fixtures. Start Web first, no general Worker.");
  const base = process.env.STORY_VERIFY_BASE ?? "http://localhost:3000";
  assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
  const userId = randomUUID(), outsiderId = randomUUID(), projectId = randomUUID(), channelId = randomUUID();
  const provider = `story-verify-${randomUUID()}`, model = "local-story-fixture";
  const token = randomUUID(), outsiderToken = randomUUID();
  const runIds: string[] = [];
  const story = makePackage();
  story.format.episodeCount = 100;
  story.episodeOutlines = Array.from({ length: 100 }, (_, i) => ({ ...story.episodeOutlines[0], episodeNumber: i + 1 }));
  story.hooks = Array.from({ length: 100 }, (_, i) => ({ ...story.hooks[0], episodeNumber: i + 1 }));
  story.volumes = Array.from({ length: 10 }, (_, i) => ({ ...story.volumes[0], volume: i + 1, episodeRange: `${i * 10 + 1}-${i * 10 + 10}` }));
  const responses = phaseResponses(story);
  let calls = 0, checks = 0;
  const received: string[] = [];
  const check = (label: string) => { checks++; console.log(`PASS ${label}`); };
  const snapshot = async () => createHash("sha256").update(JSON.stringify(await Promise.all([
    prisma.modelPrice.findMany({ where: { provider: { not: provider } }, orderBy: { id: "asc" } }),
    prisma.usageCost.findMany({ where: { userId: { notIn: [userId, outsiderId] } }, orderBy: { id: "asc" } }),
    prisma.userBalance.findMany({ where: { userId: { notIn: [userId, outsiderId] } }, orderBy: { userId: "asc" } }),
    prisma.productionDeliverable.findMany({ where: { projectId: { not: projectId } }, orderBy: { id: "asc" } }),
  ]))).digest("hex");
  const before = await snapshot();
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      received.push(JSON.stringify(body.messages));
      calls++;
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.flushHeaders();
      if (calls === 4) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"episodeOutlines":[' } }] })}\n\n`);
        // Break a genuine response body after delivering bytes, not a fabricated thrown error.
        setTimeout(() => res.destroy(), 100);
        return;
      }
      const value = responses.shift();
      if (!value) throw new Error("Unexpected extra provider request");
      const text = JSON.stringify(value);
      for (let offset = 0; offset < text.length; offset += 300) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(offset, offset + 300) } }] })}\n\n`);
      }
      res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 } })}\n\ndata: [DONE]\n\n`);
    } catch (error) { res.destroy(error as Error); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const headers = { Cookie: `cyanyi_session=${token}`, "Content-Type": "application/json" };
  const setup = { storyIdea: "长线治愈种田连载", episodeCount: 100, structure: "长线阶段式" };
  const submit = (cookie = headers.Cookie) => fetch(`${base}/api/projects/${projectId}/story-package/generate`, {
    method: "POST", headers: { ...headers, Cookie: cookie }, body: JSON.stringify({ channelId, model, setup }),
  });
  try {
    await prisma.user.createMany({ data: [{ id: userId, displayName: "临时百集断线验收" }, { id: outsiderId, displayName: "临时越权验收" }] });
    for (const [owner, session] of [[userId, token], [outsiderId, outsiderToken]]) await prisma.session.create({ data: {
      id: createHash("sha256").update(session).digest("hex"), userId: owner, expiresAt: new Date(Date.now() + 3600_000),
    } });
    await prisma.userBalance.create({ data: { userId, balance: 10 } });
    await prisma.project.create({ data: { id: projectId, userId, name: "断线验收冻结项目", config: { create: {
      id: randomUUID(), artStyle: "anime", episodeTargetDurationSeconds: 95,
    } } } });
    await prisma.channel.create({ data: {
      id: channelId, userId, scope: "USER", name: "本地文本 stub，非真实模型", protocol: "openai-compatible",
      providerKey: provider, baseUrl: `http://127.0.0.1:${address.port}/v1`, encryptedApiKeys: encryptSecret('["local-fixture-not-a-real-key"]'),
      models: { create: { id: randomUUID(), modelId: model, name: "本地故事 fixture", modelType: "text", capabilitiesJson: '{"supportsStructuredOutputs":true}' } },
    } });
    await prisma.modelPrice.create({ data: { provider, model, capability: "text", unit: "request", unitPrice: "0.01" } });
    assert.equal((await submit(`cyanyi_session=${outsiderToken}`)).status, 404);
    assert.equal(calls, 0);
    check("cross-user submission denied before provider access");
    const submitted = await submit();
    assert.equal(submitted.status, 202, await submitted.clone().text());
    const data = await submitted.json();
    const runId = data.workflowId as string;
    runIds.push(runId);
    assert.equal(data.submitted, true);
    assert.equal(calls, 0);
    assert.equal((await (await submit()).json()).workflowId, runId);
    assert.equal(await prisma.workflowRun.count({ where: { projectId } }), 1);
    check("202 background submission and active-run deduplication without a model call");
    const frozen = await prisma.workflowRun.findUniqueOrThrow({ where: { id: runId }, include: { steps: true } });
    assert.match(JSON.stringify(frozen.steps[0].input), /断线验收冻结项目/);
    await prisma.project.update({ where: { id: projectId }, data: { name: "编辑后不得污染旧任务", config: { update: { episodeTargetDurationSeconds: 180, artStyle: "realistic" } } } });
    await processWorkflowJob(runId, userId);
    const failed = await prisma.workflowRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(failed.status, "failed", JSON.stringify(failed.error));
    assert.match(JSON.stringify(failed.error), /response_body.*UND_ERR_SOCKET/);
    assert.equal(calls, 4);
    assert.equal(await prisma.workflowArtifact.count({ where: { runId, artifactType: "story-package.phase" } }), 3);
    assert.equal(await prisma.productionDeliverable.count({ where: { projectId } }), 0);
    assert.equal(await prisma.usageCost.count({ where: { userId } }), 3);
    check("real midbody socket termination retains 3 phases, no incomplete package or failed-request charge");
    const continued = await fetch(`${base}/api/workflows/${runId}`, { method: "POST", headers, body: JSON.stringify({ action: "continue" }) });
    assert.equal(continued.status, 200, await continued.clone().text());
    await processWorkflowJob(runId, userId);
    const complete = await prisma.workflowRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(complete.status, "succeeded", JSON.stringify(complete.error));
    assert.equal(calls, 33);
    assert.equal(responses.length, 0);
    const reused = await prisma.workflowEvent.findMany({ where: { runId, type: "request_succeeded" } });
    assert.equal(reused.filter(event => (event.payload as { reused?: boolean })?.reused).length, 3);
    assert(received.every(text => !text.includes("编辑后不得污染旧任务")));
    const saved = await prisma.productionDeliverable.findFirstOrThrow({ where: { projectId } });
    const payload = saved.payload as { storyPackage: typeof story };
    assert.equal(payload.storyPackage.episodeOutlines.length, 100);
    assert.equal(payload.storyPackage.firstEpisode.targetDurationSeconds, 95);
    assert.equal(payload.storyPackage.format.artStyle, "anime");
    assert.equal(saved.status, "draft");
    check("continue reuses saved phases and produces 100 outlines under the frozen project config");
    const wallet = await prisma.userBalance.findUniqueOrThrow({ where: { userId } });
    assert.equal(wallet.totalSpent.toString(), "0.32");
    assert.equal(wallet.frozenAmount.toString(), "0");
    assert.equal(await prisma.usageCost.count({ where: { userId } }), 32);
    check("32 completed text requests charged exactly once; reused phases free, failed response released");
    const duplicate = await createProductionDeliverable(userId, projectId, { department: "development", deliverableType: "story_bible", scopeType: saved.scopeType,
      scopeId: saved.scopeId, title: saved.title, payload: payload as unknown as Record<string, unknown>, idempotencyKey: `story-package:${runId}` });
    assert.equal(duplicate.id, saved.id);
    assert.equal(duplicate.version, 1);
    assert.equal(await prisma.productionDeliverable.count({ where: { projectId } }), 1);
    check("idempotent final save returns the existing draft without superseding or adding versions");
    assert.equal(await prisma.mediaTask.count({ where: { userId } }), 0);
    console.log(JSON.stringify({ ok: true, checks, localHttpRequests: calls, successfulPhases: 32, testAccountCharged: wallet.totalSpent.toString(), realModelRequests: 0 }));
  } finally {
    // Remove only this script's random queue jobs. Never flush a queue or Redis database.
    const queue = getWorkflowQueue();
    for (const state of ["wait", "delayed", "failed", "completed"] as const) {
      for (const job of await queue.getJobs([state], 0, -1)) if (runIds.includes(job.data.runId)) await job.remove();
    }
    await prisma.user.deleteMany({ where: { id: { in: [userId, outsiderId] } } });
    await prisma.modelPrice.deleteMany({ where: { provider } });
    assert.equal(await snapshot(), before, "Existing production deliverables and billing unchanged");
    assert.equal(await prisma.workflowRun.count({ where: { projectId } }), 0);
    console.log("PASS random fixture cleanup; original deliverables and billing hashes unchanged");
    await queue.close();
    await getRedisConnection().quit();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
