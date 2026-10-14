ALTER TABLE "media_tasks"
ADD COLUMN "execution_phase" VARCHAR(32) NOT NULL DEFAULT 'queued';

UPDATE "media_tasks"
SET "execution_phase" = CASE
  WHEN "status" IN ('succeeded', 'failed', 'canceled') THEN "status"
  WHEN "status" = 'running' THEN 'connecting'
  ELSE 'queued'
END;

ALTER TABLE "media_task_events"
ADD COLUMN "execution_phase" VARCHAR(32);
