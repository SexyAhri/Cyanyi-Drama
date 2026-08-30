ALTER TABLE "project_configs"
ADD COLUMN "episode_target_duration_seconds" INTEGER NOT NULL DEFAULT 85;

ALTER TABLE "project_configs"
ADD CONSTRAINT "project_configs_episode_target_duration_seconds_check"
CHECK ("episode_target_duration_seconds" BETWEEN 60 AND 90);

ALTER TABLE "episode_source_versions"
ADD COLUMN "production_plan" JSONB,
ADD COLUMN "production_plan_version" INTEGER;
