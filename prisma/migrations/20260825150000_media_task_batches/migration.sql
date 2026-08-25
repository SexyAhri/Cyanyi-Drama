ALTER TABLE `media_tasks` ADD COLUMN `batch_id` VARCHAR(191) NULL;

CREATE INDEX `media_tasks_batch_id_updated_at_idx`
ON `media_tasks` (`batch_id`, `updated_at`);
