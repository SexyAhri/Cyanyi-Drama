/** Opt-in HTTP/PostgreSQL verification. Only an empty, isolated test database is accepted. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { verifyPassword } from "../lib/server/crypto";

async function main() {
  assert(process.argv.includes("--run"), "Pass --run with an isolated test Web server.");
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(databaseUrl.hostname));
  assert(/^\/cyanyi_setup_verify_[a-z0-9_]+$/.test(databaseUrl.pathname), "Only cyanyi_setup_verify_* databases are allowed.");
  const base = process.env.SETUP_VERIFY_BASE ?? "http://127.0.0.1:3006";
  assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
  const db = new PrismaClient();
  const checks: string[] = [];
  const check = (label: string) => { checks.push(label); console.log(`PASS ${label}`); };
  const password = `Test-only-${randomUUID()}`;
  const input = { displayName: "初始化联验管理员", email: "setup-test@example.invalid", password, confirmPassword: password };
  const post = (path: string, data: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, {
    method: "POST", headers: { origin: new URL(base).origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(data),
  });
  let ownsFixtures = false;
  const originalSettings = await db.systemSettings.findUnique({ where: { id: "global" }, select: {
    registrationEnabled: true, emailAuthEnabled: true, emailVerificationEnabled: true,
  } });
  try {
    assert.equal(await db.user.count(), 0, "Test database must start empty.");
    assert.equal(await db.systemInstallation.count(), 0);
    ownsFixtures = true;

    assert.equal((await post("/api/auth/register", input)).status, 409);
    check("ordinary registration cannot preempt initial setup");
    assert.equal((await post("/api/auth/setup", input, { origin: "https://untrusted.example" })).status, 403);
    assert.equal((await post("/api/auth/setup", { ...input, role: "ADMIN" })).status, 400);
    assert.equal((await post("/api/auth/setup", { ...input, confirmPassword: "different" })).status, 400);
    assert.equal(await db.user.count(), 0);
    assert.equal(await db.systemInstallation.count(), 0);
    check("cross-origin and invalid input leave no accounts or installation claim");

    // This test-only trigger proves that account, installation and session writes
    // really roll back together when the final database write fails.
    await db.$executeRawUnsafe(`CREATE FUNCTION setup_verify_fail_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'setup verification injected failure'; END; $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER setup_verify_fail_session BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION setup_verify_fail_session()`);
    assert.equal((await post("/api/auth/setup", input)).status, 503);
    assert.equal(await db.user.count(), 0);
    assert.equal(await db.systemInstallation.count(), 0);
    assert.equal(await db.session.count(), 0);
    await db.$executeRawUnsafe(`DROP TRIGGER setup_verify_fail_session ON sessions`);
    await db.$executeRawUnsafe(`DROP FUNCTION setup_verify_fail_session()`);
    check("a failed session insert rolls back the entire initialization");

    const authFlags = { registrationEnabled: false, emailAuthEnabled: false, emailVerificationEnabled: true };
    await db.systemSettings.upsert({ where: { id: "global" }, create: { id: "global", ...authFlags }, update: authFlags });
    const responses = await Promise.all(Array.from({ length: 4 }, (_, index) => post("/api/auth/setup", { ...input, email: `setup-${index}@example.invalid` })));
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409, 409, 409]);
    assert.equal(await db.user.count(), 1);
    assert.equal(await db.systemInstallation.count(), 1);
    assert.equal(await db.session.count(), 1);
    check("four concurrent requests create exactly one administrator and session");
    check("setup works with registration closed and SMTP verification unconfigured");

    const success = responses.find((response) => response.status === 201)!;
    const result = await success.json();
    assert.equal(result.user.role, "ADMIN");
    assert.equal(result.user.passwordHash, undefined);
    assert.equal(result.sessionId, undefined);
    const cookie = success.headers.get("set-cookie")!.split(";", 1)[0];
    assert(success.headers.get("set-cookie")!.includes("HttpOnly"));
    const user = await db.user.findUniqueOrThrow({ where: { id: result.user.id } });
    assert.equal(user.anonymous, false);
    assert.equal(user.emailVerifiedAt, null, "Setup must not falsely claim email ownership verification.");
    assert(await verifyPassword(password, user.passwordHash!));
    const session = await db.session.findFirstOrThrow();
    assert.equal(session.id, createHash("sha256").update(cookie.split("=")[1]).digest("hex"));
    check("password and session token are hashed; public response contains no credentials");

    const authenticated = await fetch(`${base}/api/auth/session`, { headers: { cookie } });
    assert.equal(authenticated.status, 200);
    assert.equal((await authenticated.json()).user.id, user.id);
    const admin = await fetch(`${base}/admin`, { headers: { cookie } });
    assert.equal(admin.status, 200);
    assert.equal(new URL(admin.url).pathname, "/admin/channels");
    check("the returned cookie authenticates the new administrator and opens the real admin page");

    await db.systemSettings.update({ where: { id: "global" }, data: {
      registrationEnabled: true, emailAuthEnabled: true, emailVerificationEnabled: false,
    } });
    let loginResult = await post("/api/auth/login", { email: user.email, password });
    // The Redis client can be warming up on its first request; a 503 is not a
    // credential failure and must not be relabeled as success.
    for (let attempt = 0; attempt < 3 && loginResult.status === 503; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      loginResult = await post("/api/auth/login", { email: user.email, password });
    }
    assert.equal(loginResult.status, 200, await loginResult.clone().text());
    check("the administrator can sign in again through the existing login endpoint");

    const registered = await post("/api/auth/register", { ...input, email: "regular-test@example.invalid" });
    assert.equal(registered.status, 201, await registered.clone().text());
    assert.equal((await registered.json()).user.role, "USER");
    assert.equal((await post("/api/auth/setup", input)).status, 409);
    check("later registration stays USER and repeated setup cannot create another admin");

    await db.user.deleteMany();
    assert.equal((await post("/api/auth/setup", input)).status, 409);
    assert.equal(await db.user.count(), 0);
    check("removing every account never reopens completed setup");
    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
  } finally {
    if (ownsFixtures) {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS setup_verify_fail_session ON sessions`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS setup_verify_fail_session()`);
      await db.user.deleteMany();
      if (originalSettings) await db.systemSettings.update({ where: { id: "global" }, data: originalSettings });
      else await db.systemSettings.deleteMany();
      await db.systemInstallation.deleteMany();
      assert.equal(await db.session.count(), 0);
      console.log("CLEAN isolated database restored to empty; no production data touched");
    }
    await db.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
