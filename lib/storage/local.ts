import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { getAppSecret } from "@/lib/server/app-secret";

export async function uploadLocalObject(
  key: string,
  body: Uint8Array | string,
) {
  const path = resolveLocalStoragePath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  return key;
}

export async function readLocalObject(key: string) {
  return readFile(resolveLocalStoragePath(key));
}

export async function deleteLocalObject(key: string) {
  await rm(resolveLocalStoragePath(key), { force: true });
}

export function getLocalObjectUrl(key: string, expiresIn = 3600) {
  const expires = Math.floor(Date.now() / 1000) + expiresIn;
  const signature = sign(key, expires);
  const encodedPath = key.split("/").map(encodeURIComponent).join("/");
  const baseUrl = (
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    `http://localhost:${process.env.PORT || "3000"}`
  ).replace(/\/+$/, "");
  return `${baseUrl}/api/files/${encodedPath}?expires=${expires}&signature=${signature}`;
}

export function verifyLocalObjectUrl(
  key: string,
  expiresValue: string | null,
  signatureValue: string | null,
) {
  const expires = Number(expiresValue);
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000))
    return false;
  if (!signatureValue) return false;
  const expected = Buffer.from(sign(key, expires), "hex");
  const provided = Buffer.from(signatureValue, "hex");
  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}

function resolveLocalStoragePath(key: string) {
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes(".."))
    throw new Error("LOCAL_STORAGE_KEY_INVALID");
  const root = join(process.cwd(), ".media");
  const target = resolve(root, normalized);
  if (target !== root && !target.startsWith(`${root}${sep}`))
    throw new Error("LOCAL_STORAGE_KEY_INVALID");
  return target;
}

function sign(key: string, expires: number) {
  return createHmac("sha256", getAppSecret())
    .update(`${key}:${expires}`)
    .digest("hex");
}
