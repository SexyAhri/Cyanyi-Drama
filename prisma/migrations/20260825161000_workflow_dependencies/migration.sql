-- AlterTable
ALTER TABLE `workflow_steps` ADD COLUMN `artifactTypes` JSON NULL,
    ADD COLUMN `dependsOn` JSON NULL,
    ADD COLUMN `failure_mode` VARCHAR(191) NOT NULL DEFAULT 'fail_run',
    ADD COLUMN `retryable` BOOLEAN NOT NULL DEFAULT true;
