-- CreateTable
CREATE TABLE `workflow_runs` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `episode_id` VARCHAR(191) NULL,
    `workflow_type` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
    `input` JSON NULL,
    `output` JSON NULL,
    `error` JSON NULL,
    `cancel_requested_at` DATETIME(3) NULL,
    `workflow_version` INTEGER NOT NULL DEFAULT 1,
    `queued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `started_at` DATETIME(3) NULL,
    `heartbeat_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `workflow_runs_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `workflow_runs_project_id_status_idx`(`project_id`, `status`),
    INDEX `workflow_runs_episode_id_created_at_idx`(`episode_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_steps` (
    `id` VARCHAR(191) NOT NULL,
    `run_id` VARCHAR(191) NOT NULL,
    `step_key` VARCHAR(191) NOT NULL,
    `step_type` VARCHAR(191) NOT NULL,
    `step_index` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `attempt` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL DEFAULT 3,
    `input` JSON NULL,
    `output` JSON NULL,
    `error` JSON NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `workflow_steps_run_id_status_idx`(`run_id`, `status`),
    INDEX `workflow_steps_run_id_step_index_idx`(`run_id`, `step_index`),
    UNIQUE INDEX `workflow_steps_run_id_step_key_key`(`run_id`, `step_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_events` (
    `id` VARCHAR(191) NOT NULL,
    `run_id` VARCHAR(191) NOT NULL,
    `step_id` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NULL,
    `message` TEXT NULL,
    `payload` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workflow_events_run_id_created_at_idx`(`run_id`, `created_at`),
    INDEX `workflow_events_step_id_created_at_idx`(`step_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `workflow_runs` ADD CONSTRAINT `workflow_runs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_runs` ADD CONSTRAINT `workflow_runs_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_runs` ADD CONSTRAINT `workflow_runs_episode_id_fkey` FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_steps` ADD CONSTRAINT `workflow_steps_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `workflow_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_events` ADD CONSTRAINT `workflow_events_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `workflow_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
