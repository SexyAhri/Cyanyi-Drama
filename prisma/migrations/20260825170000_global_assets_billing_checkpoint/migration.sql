-- CreateTable
CREATE TABLE `global_asset_folders` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `global_asset_folders_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `global_characters` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `folder_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `aliases` TEXT NULL,
    `profile_data` TEXT NULL,
    `profile_confirmed` BOOLEAN NOT NULL DEFAULT false,
    `voice_id` VARCHAR(191) NULL,
    `voice_type` VARCHAR(191) NULL,
    `global_voice_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `global_characters_user_id_idx`(`user_id`),
    INDEX `global_characters_folder_id_idx`(`folder_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `global_character_appearances` (
    `id` VARCHAR(191) NOT NULL,
    `character_id` VARCHAR(191) NOT NULL,
    `appearance_index` INTEGER NOT NULL,
    `change_reason` VARCHAR(191) NOT NULL DEFAULT 'default',
    `art_style` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `image_url` TEXT NULL,
    `image_asset_id` VARCHAR(191) NULL,
    `image_urls` TEXT NULL,
    `selected_index` INTEGER NULL,
    `previous_image_url` TEXT NULL,
    `previous_description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `global_character_appearances_character_id_idx`(`character_id`),
    UNIQUE INDEX `global_character_appearances_character_id_appearance_index_key`(`character_id`, `appearance_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `global_locations` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `folder_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `art_style` VARCHAR(191) NULL,
    `summary` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `global_locations_user_id_idx`(`user_id`),
    INDEX `global_locations_folder_id_idx`(`folder_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `global_location_images` (
    `id` VARCHAR(191) NOT NULL,
    `location_id` VARCHAR(191) NOT NULL,
    `image_index` INTEGER NOT NULL,
    `description` TEXT NULL,
    `image_url` TEXT NULL,
    `image_asset_id` VARCHAR(191) NULL,
    `is_selected` BOOLEAN NOT NULL DEFAULT false,
    `previous_image_url` TEXT NULL,
    `previous_description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `global_location_images_location_id_idx`(`location_id`),
    UNIQUE INDEX `global_location_images_location_id_image_index_key`(`location_id`, `image_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `global_voices` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `folder_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `voice_id` VARCHAR(191) NULL,
    `voice_type` VARCHAR(191) NOT NULL DEFAULT 'designed',
    `custom_voice_url` TEXT NULL,
    `voice_prompt` TEXT NULL,
    `gender` VARCHAR(191) NULL,
    `language` VARCHAR(191) NOT NULL DEFAULT 'zh',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `global_voices_user_id_idx`(`user_id`),
    INDEX `global_voices_folder_id_idx`(`folder_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_balances` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `balance` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `frozen_amount` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `total_spent` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `user_balances_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `balance_freezes` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 6) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `source` VARCHAR(64) NULL,
    `task_id` VARCHAR(191) NULL,
    `request_id` VARCHAR(191) NULL,
    `idempotency_key` VARCHAR(191) NULL,
    `metadata` TEXT NULL,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `balance_freezes_idempotency_key_key`(`idempotency_key`),
    INDEX `balance_freezes_user_id_idx`(`user_id`),
    INDEX `balance_freezes_status_idx`(`status`),
    INDEX `balance_freezes_task_id_idx`(`task_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `balance_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 6) NOT NULL,
    `balance_after` DECIMAL(18, 6) NOT NULL,
    `description` TEXT NULL,
    `related_id` VARCHAR(191) NULL,
    `freeze_id` VARCHAR(191) NULL,
    `idempotency_key` VARCHAR(128) NULL,
    `project_id` VARCHAR(128) NULL,
    `episode_id` VARCHAR(128) NULL,
    `task_type` VARCHAR(64) NULL,
    `billing_meta` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `balance_transactions_user_id_idx`(`user_id`),
    INDEX `balance_transactions_type_idx`(`type`),
    INDEX `balance_transactions_created_at_idx`(`created_at`),
    INDEX `balance_transactions_freeze_id_idx`(`freeze_id`),
    UNIQUE INDEX `balance_transactions_user_id_type_idempotency_key_key`(`user_id`, `type`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `usage_costs` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `api_type` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `cost` DECIMAL(18, 6) NOT NULL,
    `metadata` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `usage_costs_api_type_idx`(`api_type`),
    INDEX `usage_costs_created_at_idx`(`created_at`),
    INDEX `usage_costs_project_id_idx`(`project_id`),
    INDEX `usage_costs_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_checkpoints` (
    `id` VARCHAR(191) NOT NULL,
    `run_id` VARCHAR(191) NOT NULL,
    `step_key` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `state_json` JSON NOT NULL,
    `state_bytes` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workflow_checkpoints_run_id_created_at_idx`(`run_id`, `created_at`),
    UNIQUE INDEX `workflow_checkpoints_run_id_step_key_version_key`(`run_id`, `step_key`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_step_attempts` (
    `id` VARCHAR(191) NOT NULL,
    `run_id` VARCHAR(191) NOT NULL,
    `step_id` VARCHAR(191) NOT NULL,
    `attempt` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `provider` VARCHAR(191) NULL,
    `model_key` VARCHAR(191) NULL,
    `input_hash` VARCHAR(191) NULL,
    `input` JSON NULL,
    `output_text` TEXT NULL,
    `usage_json` JSON NULL,
    `error_code` VARCHAR(191) NULL,
    `error_message` TEXT NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `workflow_step_attempts_run_id_step_id_idx`(`run_id`, `step_id`),
    INDEX `workflow_step_attempts_step_id_attempt_idx`(`step_id`, `attempt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `media_hashes` (
    `id` VARCHAR(191) NOT NULL,
    `sha256` VARCHAR(191) NOT NULL,
    `storage_key` VARCHAR(512) NOT NULL,
    `mime_type` VARCHAR(191) NULL,
    `size_bytes` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `media_hashes_sha256_key`(`sha256`),
    INDEX `media_hashes_sha256_idx`(`sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `global_asset_folders` ADD CONSTRAINT `global_asset_folders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `global_characters` ADD CONSTRAINT `global_characters_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `global_characters` ADD CONSTRAINT `global_characters_folder_id_fkey` FOREIGN KEY (`folder_id`) REFERENCES `global_asset_folders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `global_character_appearances` ADD CONSTRAINT `global_character_appearances_character_id_fkey` FOREIGN KEY (`character_id`) REFERENCES `global_characters`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `global_character_appearances` ADD CONSTRAINT `global_character_appearances_image_asset_id_fkey` FOREIGN KEY (`image_asset_id`) REFERENCES `media_assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `global_locations` ADD CONSTRAINT `global_locations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `global_locations` ADD CONSTRAINT `global_locations_folder_id_fkey` FOREIGN KEY (`folder_id`) REFERENCES `global_asset_folders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `global_location_images` ADD CONSTRAINT `global_location_images_location_id_fkey` FOREIGN KEY (`location_id`) REFERENCES `global_locations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `global_location_images` ADD CONSTRAINT `global_location_images_image_asset_id_fkey` FOREIGN KEY (`image_asset_id`) REFERENCES `media_assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `global_voices` ADD CONSTRAINT `global_voices_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `global_voices` ADD CONSTRAINT `global_voices_folder_id_fkey` FOREIGN KEY (`folder_id`) REFERENCES `global_asset_folders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_balances` ADD CONSTRAINT `user_balances_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `balance_freezes` ADD CONSTRAINT `balance_freezes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `balance_transactions` ADD CONSTRAINT `balance_transactions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `usage_costs` ADD CONSTRAINT `usage_costs_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `usage_costs` ADD CONSTRAINT `usage_costs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_checkpoints` ADD CONSTRAINT `workflow_checkpoints_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `workflow_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_step_attempts` ADD CONSTRAINT `workflow_step_attempts_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `workflow_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_step_attempts` ADD CONSTRAINT `workflow_step_attempts_step_id_fkey` FOREIGN KEY (`step_id`) REFERENCES `workflow_steps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
