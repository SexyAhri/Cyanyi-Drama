/** Bump only when the built-in defaults change. Persisted snapshots remain self-contained. */
export const PRODUCTION_DEFAULTS_VERSION =
  "production-defaults-2026-10-13" as const;
export const PRODUCTION_DEFAULT_TEMPLATE = {
  id: PRODUCTION_DEFAULTS_VERSION,
  inheritance: ["user", "project", "episode", "panel", "request"],
  legacySnapshotFormat: "production-configuration-v1",
} as const;
