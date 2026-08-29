-- AlterTable
ALTER TABLE "episodes"
ADD COLUMN "active_source_id" TEXT,
ADD COLUMN "active_source_kind" VARCHAR(32) NOT NULL DEFAULT 'original';

-- CreateTable
CREATE TABLE "manuscripts" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "synopsis" TEXT,
    "source_file_name" TEXT,
    "source_text" TEXT NOT NULL,
    "source_hash" VARCHAR(64) NOT NULL,
    "char_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "manuscripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode_source_versions" (
    "id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "manuscript_id" TEXT,
    "kind" VARCHAR(32) NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "content" TEXT NOT NULL,
    "adaptation_mode" VARCHAR(32),
    "instructions" TEXT,
    "change_summary" JSONB,
    "prompt_trace" JSONB,
    "channel_id" TEXT,
    "model" TEXT,
    "source_hash" VARCHAR(64) NOT NULL,
    "source_start_index" INTEGER,
    "source_end_index" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "episode_source_versions_pkey" PRIMARY KEY ("id")
);

-- Backfill existing source text as immutable original version 1.
INSERT INTO "episode_source_versions" (
    "id", "episode_id", "kind", "version", "title", "summary", "content",
    "source_hash", "created_at"
)
SELECT
    "id" || ':source:original:1', "id", 'original', 1, "name", "description",
    "novel_text", md5("novel_text"), "created_at"
FROM "episodes"
WHERE "novel_text" IS NOT NULL AND length(trim("novel_text")) > 0;

UPDATE "episodes"
SET "active_source_id" = "id" || ':source:original:1'
WHERE "novel_text" IS NOT NULL AND length(trim("novel_text")) > 0;

-- CreateIndex
CREATE UNIQUE INDEX "manuscripts_project_id_source_hash_key" ON "manuscripts"("project_id", "source_hash");
CREATE INDEX "manuscripts_project_id_created_at_idx" ON "manuscripts"("project_id", "created_at");
CREATE UNIQUE INDEX "episode_source_versions_episode_id_kind_version_key" ON "episode_source_versions"("episode_id", "kind", "version");
CREATE INDEX "episode_source_versions_episode_id_created_at_idx" ON "episode_source_versions"("episode_id", "created_at");
CREATE INDEX "episode_source_versions_manuscript_id_idx" ON "episode_source_versions"("manuscript_id");

-- AddForeignKey
ALTER TABLE "manuscripts" ADD CONSTRAINT "manuscripts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "episode_source_versions" ADD CONSTRAINT "episode_source_versions_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "episode_source_versions" ADD CONSTRAINT "episode_source_versions_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
