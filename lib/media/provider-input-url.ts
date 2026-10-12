import { createHmac, timingSafeEqual } from "node:crypto";

import { getAppSecret } from "@/lib/server/app-secret";

const PROVIDER_INPUT_URL_TTL_SECONDS = 30 * 60;

export function createProviderInputUrl(assetId: string, now = Date.now()) {
  const url = createProviderInputBaseUrl();
  const expires = Math.floor(now / 1000) + PROVIDER_INPUT_URL_TTL_SECONDS;
  const signature = signProviderInput(assetId, expires);
  url.searchParams.set("assetId", assetId);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  return url.toString();
}

export function createProviderTaskInputUrl(
  taskId: string,
  referenceIndex: number,
  now = Date.now(),
) {
  if (!Number.isInteger(referenceIndex) || referenceIndex < 0)
    throw new Error("PROVIDER_INPUT_REFERENCE_INDEX_INVALID");
  const url = createProviderInputBaseUrl();
  const expires = Math.floor(now / 1000) + PROVIDER_INPUT_URL_TTL_SECONDS;
  const signature = signProviderInput(
    `task:${taskId}:${referenceIndex}`,
    expires,
  );
  url.searchParams.set("taskId", taskId);
  url.searchParams.set("referenceIndex", String(referenceIndex));
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  return url.toString();
}

function createProviderInputBaseUrl() {
  const baseUrl = process.env.APP_BASE_URL?.trim();
  if (!baseUrl) throw new Error("PROVIDER_INPUT_PUBLIC_APP_URL_REQUIRED");

  let origin: URL;
  try {
    origin = new URL(baseUrl);
  } catch {
    throw new Error("PROVIDER_INPUT_PUBLIC_APP_URL_INVALID");
  }

  if (isLocalHostname(origin.hostname))
    throw new Error("PROVIDER_INPUT_PUBLIC_APP_URL_REQUIRED");

  const url = new URL("/api/media/provider-input", origin);
  return url;
}

export function verifyProviderInputSignature(
  assetId: string,
  expiresValue: string,
  signature: string,
  now = Date.now(),
) {
  return verifyProviderInputSignatureForSubject(
    assetId,
    expiresValue,
    signature,
    now,
  );
}

export function verifyProviderTaskInputSignature(
  taskId: string,
  referenceIndexValue: string,
  expiresValue: string,
  signature: string,
  now = Date.now(),
) {
  if (!/^\d+$/.test(referenceIndexValue)) return false;
  const referenceIndex = Number(referenceIndexValue);
  if (!Number.isSafeInteger(referenceIndex)) return false;
  return verifyProviderInputSignatureForSubject(
    `task:${taskId}:${referenceIndex}`,
    expiresValue,
    signature,
    now,
  );
}

function verifyProviderInputSignatureForSubject(
  subject: string,
  expiresValue: string,
  signature: string,
  now: number,
) {
  if (!/^\d+$/.test(expiresValue) || !/^[a-f0-9]{64}$/i.test(signature))
    return false;
  const expires = Number(expiresValue);
  const nowSeconds = Math.floor(now / 1000);
  if (
    !Number.isSafeInteger(expires) ||
    expires <= nowSeconds ||
    expires - nowSeconds > PROVIDER_INPUT_URL_TTL_SECONDS
  )
    return false;

  const expected = Buffer.from(signProviderInput(subject, expires), "hex");
  const actual = Buffer.from(signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function signProviderInput(subject: string, expires: number) {
  return createHmac("sha256", getAppSecret())
    .update(`provider-input:${subject}:${expires}`)
    .digest("hex");
}

function isLocalHostname(hostname: string) {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    value === "localhost" ||
    value === "127.0.0.1" ||
    value === "::1" ||
    value.endsWith(".localhost") ||
    value.endsWith(".local")
  );
}
