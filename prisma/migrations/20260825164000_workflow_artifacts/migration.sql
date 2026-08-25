CREATE TABLE `workflow_artifacts` (
    `id` VARCHAR(191) NOT NULL,
    `run_id` VARCHAR(191) NOT NULL,
    `step_id` VARCHAR(191) NOT NULL,
    `artifact_type` VARCHAR(191) NOT NULL,
    `ref_id` VARCHAR(191) NULL,
    `payload` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`),
    UNIQUE INDEX `workflow_artifacts_run_id_step_id_artifact_type_ref_id_key` (`run_id`, `step_id`, `artifact_type`, `ref_id`),
    INDEX `workflow_artifacts_run_id_artifact_type_idx` (`run_id`, `artifact_type`),
    INDEX `workflow_artifacts_ref_id_idx` (`ref_id`),
    CONSTRAINT `workflow_artifacts_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `workflow_runs` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `workflow_artifacts_step_id_fkey` FOREIGN KEY (`step_id`) REFERENCES `workflow_steps` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
