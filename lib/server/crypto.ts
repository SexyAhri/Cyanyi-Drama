import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

const PASSWORD_SALT = "cyanyi-password-v1";

function getEncryptionKey() {
  return scryptSync(
    process.env.APP_SECRET || "cyanyi-development-secret",
    "cyanyi-db",
    32,
  );
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, `${PASSWORD_SALT}:${salt}`, 64).toString(
    "hex",
  );
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, encoded: string) {
  const [salt, expected] = encoded.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, `${PASSWORD_SALT}:${salt}`, 64).toString(
    "hex",
  );
  return actual === expected;
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSecret(value: string) {
  const [ivEncoded, tagEncoded, encryptedEncoded] = value.split(".");
  if (!ivEncoded || !tagEncoded || !encryptedEncoded)
    throw new Error("INVALID_ENCRYPTED_SECRET");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivEncoded, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
