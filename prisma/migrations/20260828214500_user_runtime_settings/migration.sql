CREATE TABLE `user_runtime_settings` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `structured_request_timeout_seconds` INTEGER NOT NULL DEFAULT 600,
    `structured_output_streaming` BOOLEAN NOT NULL DEFAULT true,
    `structured_transport_max_attempts` INTEGER NOT NULL DEFAULT 3,
    `workflow_step_max_attempts` INTEGER NOT NULL DEFAULT 3,
    `workflow_concurrency` INTEGER NOT NULL DEFAULT 2,
    `screenplay_clip_max_chars` INTEGER NOT NULL DEFAULT 1600,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_runtime_settings_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_runtime_settings`
    ADD CONSTRAINT `user_runtime_settings_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
