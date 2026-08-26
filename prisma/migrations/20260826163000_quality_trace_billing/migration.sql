-- M6 structured tracing and idempotent usage reconciliation.
ALTER TABLE `workflow_runs`
  ADD COLUMN `trace_id` VARCHAR(64) NULL,
  ADD COLUMN `span_id` VARCHAR(64) NULL;

UPDATE `workflow_runs`
SET
  `trace_id` = SHA2(CONCAT('trace:workflow:', `id`), 256),
  `span_id` = SHA2(CONCAT('span:workflow:', `id`), 256)
WHERE `trace_id` IS NULL OR `span_id` IS NULL;

ALTER TABLE `workflow_runs`
  MODIFY `trace_id` VARCHAR(64) NOT NULL,
  MODIFY `span_id` VARCHAR(64) NOT NULL,
  ADD UNIQUE INDEX `workflow_runs_trace_id_key` (`trace_id`),
  ADD UNIQUE INDEX `workflow_runs_span_id_key` (`span_id`);

ALTER TABLE `workflow_steps`
  ADD COLUMN `trace_id` VARCHAR(64) NULL,
  ADD COLUMN `span_id` VARCHAR(64) NULL,
  ADD COLUMN `parent_span_id` VARCHAR(64) NULL;

UPDATE `workflow_steps` AS `step`
INNER JOIN `workflow_runs` AS `run` ON `run`.`id` = `step`.`run_id`
SET
  `step`.`trace_id` = `run`.`trace_id`,
  `step`.`span_id` = SHA2(CONCAT('span:workflow-step:', `step`.`id`), 256),
  `step`.`parent_span_id` = `run`.`span_id`
WHERE `step`.`trace_id` IS NULL OR `step`.`span_id` IS NULL OR `step`.`parent_span_id` IS NULL;

ALTER TABLE `workflow_steps`
  MODIFY `trace_id` VARCHAR(64) NOT NULL,
  MODIFY `span_id` VARCHAR(64) NOT NULL,
  MODIFY `parent_span_id` VARCHAR(64) NOT NULL,
  ADD UNIQUE INDEX `workflow_steps_span_id_key` (`span_id`),
  ADD INDEX `workflow_steps_trace_id_step_index_idx` (`trace_id`, `step_index`);

ALTER TABLE `media_tasks`
  ADD COLUMN `trace_id` VARCHAR(64) NULL,
  ADD COLUMN `span_id` VARCHAR(64) NULL,
  ADD COLUMN `parent_span_id` VARCHAR(64) NULL,
  ADD COLUMN `workflow_run_id` VARCHAR(191) NULL,
  ADD COLUMN `workflow_step_id` VARCHAR(191) NULL;

UPDATE `media_tasks`
SET
  `trace_id` = SHA2(CONCAT('trace:media-task:', `id`), 256),
  `span_id` = SHA2(CONCAT('span:media-task:', `id`), 256)
WHERE `trace_id` IS NULL OR `span_id` IS NULL;

ALTER TABLE `media_tasks`
  MODIFY `trace_id` VARCHAR(64) NOT NULL,
  MODIFY `span_id` VARCHAR(64) NOT NULL,
  ADD UNIQUE INDEX `media_tasks_span_id_key` (`span_id`),
  ADD INDEX `media_tasks_trace_id_created_at_idx` (`trace_id`, `created_at`),
  ADD INDEX `media_tasks_workflow_run_id_workflow_step_id_idx` (`workflow_run_id`, `workflow_step_id`),
  ADD CONSTRAINT `media_tasks_workflow_run_id_fkey`
    FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `media_tasks_workflow_step_id_fkey`
    FOREIGN KEY (`workflow_step_id`) REFERENCES `workflow_steps` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `usage_costs`
  ADD COLUMN `source_type` VARCHAR(64) NULL,
  ADD COLUMN `source_id` VARCHAR(191) NULL,
  ADD COLUMN `idempotency_key` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `usage_costs_idempotency_key_key` (`idempotency_key`),
  ADD INDEX `usage_costs_source_type_source_id_idx` (`source_type`, `source_id`);
