-- AlterTable
ALTER TABLE `workflow_runs`
    ADD COLUMN `target_type` VARCHAR(191) NULL,
    ADD COLUMN `target_id` VARCHAR(191) NULL,
    ADD COLUMN `active_dedupe_key` VARCHAR(191) NULL,
    ADD COLUMN `lease_owner` VARCHAR(191) NULL,
    ADD COLUMN `lease_expires_at` DATETIME(3) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `workflow_runs_active_dedupe_key_key` ON `workflow_runs`(`active_dedupe_key`);

-- CreateIndex
CREATE INDEX `workflow_runs_workflow_type_target_type_target_id_status_idx` ON `workflow_runs`(`workflow_type`, `target_type`, `target_id`, `status`);

-- CreateIndex
CREATE INDEX `workflow_runs_lease_expires_at_idx` ON `workflow_runs`(`lease_expires_at`);
