CREATE TABLE "system_installation" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'global',
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "system_installation_pkey" PRIMARY KEY ("id")
);

-- An existing installation must never expose an unauthenticated admin claim.
INSERT INTO "system_installation" ("id")
SELECT 'global'
WHERE EXISTS (SELECT 1 FROM "users" WHERE "anonymous" = false OR "role" = 'ADMIN');
