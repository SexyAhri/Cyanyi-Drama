-- Legacy databases may retain this CHECK from the earlier workflow schema.
-- Both user pause and cooperative worker handoff settle attempts as 'paused'.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workflow_step_attempts'::regclass
      AND conname = 'workflow_step_attempts_status_check'
  ) THEN
    ALTER TABLE "workflow_step_attempts"
      DROP CONSTRAINT "workflow_step_attempts_status_check";
    ALTER TABLE "workflow_step_attempts"
      ADD CONSTRAINT "workflow_step_attempts_status_check"
      CHECK ("status" IN ('pending', 'queued', 'running', 'succeeded', 'failed', 'canceled', 'unknown', 'paused'));
  END IF;
END $$;
