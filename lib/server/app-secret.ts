const DEVELOPMENT_APP_SECRET = "cyanyi-development-secret";

const UNSAFE_PRODUCTION_SECRETS = new Set([
  DEVELOPMENT_APP_SECRET,
  "cyanyi-local-development",
  "change-me",
  "changeme",
]);

export function getAppSecret() {
  const configured = process.env.APP_SECRET?.trim();
  if (configured) {
    if (
      process.env.NODE_ENV === "production" &&
      UNSAFE_PRODUCTION_SECRETS.has(configured.toLowerCase())
    ) {
      throw new Error("APP_SECRET_INSECURE");
    }
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_SECRET_REQUIRED");
  }
  return DEVELOPMENT_APP_SECRET;
}
