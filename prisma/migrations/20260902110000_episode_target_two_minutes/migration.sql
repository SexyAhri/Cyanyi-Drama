ALTER TABLE "project_configs"
ALTER COLUMN "episode_target_duration_seconds" SET DEFAULT 120;

ALTER TABLE "project_configs"
DROP CONSTRAINT IF EXISTS "project_configs_episode_target_duration_seconds_check";

ALTER TABLE "project_configs"
ADD CONSTRAINT "project_configs_episode_target_duration_seconds_check"
CHECK ("episode_target_duration_seconds" BETWEEN 60 AND 180);

UPDATE "project_configs"
SET "episode_target_duration_seconds" = 120
WHERE "episode_target_duration_seconds" = 85;
