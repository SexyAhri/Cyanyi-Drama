-- Stage 2-1: structured novel-production domain tables.
CREATE TABLE `novel_characters` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `aliases` TEXT NULL,
    `profile_json` TEXT NULL,
    `introduction` TEXT NULL,
    `confirmed` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `novel_characters_project_id_updated_at_idx`(`project_id`, `updated_at`),
    UNIQUE INDEX `novel_characters_project_id_name_key`(`project_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `character_appearances` (
    `id` VARCHAR(191) NOT NULL,
    `character_id` VARCHAR(191) NOT NULL,
    `appearance_index` INTEGER NOT NULL,
    `description` TEXT NULL,
    `image_asset_id` VARCHAR(191) NULL,
    `selected` BOOLEAN NOT NULL DEFAULT false,
    `metadata_json` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `character_appearances_character_id_updated_at_idx`(`character_id`, `updated_at`),
    INDEX `character_appearances_image_asset_id_idx`(`image_asset_id`),
    UNIQUE INDEX `character_appearances_character_id_appearance_index_key`(`character_id`, `appearance_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `novel_locations` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `summary` TEXT NULL,
    `selected_image_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `novel_locations_project_id_updated_at_idx`(`project_id`, `updated_at`),
    INDEX `novel_locations_selected_image_id_idx`(`selected_image_id`),
    UNIQUE INDEX `novel_locations_project_id_name_key`(`project_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `location_images` (
    `id` VARCHAR(191) NOT NULL,
    `location_id` VARCHAR(191) NOT NULL,
    `image_index` INTEGER NOT NULL,
    `description` TEXT NULL,
    `available_slots` TEXT NULL,
    `image_asset_id` VARCHAR(191) NULL,
    `selected` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `location_images_location_id_updated_at_idx`(`location_id`, `updated_at`),
    INDEX `location_images_image_asset_id_idx`(`image_asset_id`),
    UNIQUE INDEX `location_images_location_id_image_index_key`(`location_id`, `image_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `storyboards` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `episode_id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `version` INTEGER NOT NULL DEFAULT 1,
    `source_hash` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `storyboards_episode_id_key`(`episode_id`),
    INDEX `storyboards_project_id_updated_at_idx`(`project_id`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `storyboard_panels` (
    `id` VARCHAR(191) NOT NULL,
    `storyboard_id` VARCHAR(191) NOT NULL,
    `panel_index` INTEGER NOT NULL,
    `shot_type` VARCHAR(191) NULL,
    `camera_move` TEXT NULL,
    `description` TEXT NULL,
    `location_name` VARCHAR(191) NULL,
    `characters_json` TEXT NULL,
    `props_json` TEXT NULL,
    `image_prompt` TEXT NULL,
    `video_prompt` TEXT NULL,
    `image_asset_id` VARCHAR(191) NULL,
    `video_asset_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `storyboard_panels_storyboard_id_updated_at_idx`(`storyboard_id`, `updated_at`),
    INDEX `storyboard_panels_image_asset_id_idx`(`image_asset_id`),
    INDEX `storyboard_panels_video_asset_id_idx`(`video_asset_id`),
    UNIQUE INDEX `storyboard_panels_storyboard_id_panel_index_key`(`storyboard_id`, `panel_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `asset_references` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `episode_id` VARCHAR(191) NULL,
    `media_asset_id` VARCHAR(191) NOT NULL,
    `entity_type` VARCHAR(191) NOT NULL,
    `entity_id` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `metadata_json` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `asset_references_project_id_entity_type_entity_id_idx`(`project_id`, `entity_type`, `entity_id`),
    INDEX `asset_references_episode_id_created_at_idx`(`episode_id`, `created_at`),
    UNIQUE INDEX `asset_references_media_asset_id_entity_type_entity_id_role_key`(`media_asset_id`, `entity_type`, `entity_id`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `novel_characters` ADD CONSTRAINT `novel_characters_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `character_appearances` ADD CONSTRAINT `character_appearances_character_id_fkey` FOREIGN KEY (`character_id`) REFERENCES `novel_characters`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `character_appearances` ADD CONSTRAINT `character_appearances_image_asset_id_fkey` FOREIGN KEY (`image_asset_id`) REFERENCES `media_assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `novel_locations` ADD CONSTRAINT `novel_locations_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `novel_locations` ADD CONSTRAINT `novel_locations_selected_image_id_fkey` FOREIGN KEY (`selected_image_id`) REFERENCES `location_images`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `location_images` ADD CONSTRAINT `location_images_location_id_fkey` FOREIGN KEY (`location_id`) REFERENCES `novel_locations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `location_images` ADD CONSTRAINT `location_images_image_asset_id_fkey` FOREIGN KEY (`image_asset_id`) REFERENCES `media_assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `storyboards` ADD CONSTRAINT `storyboards_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `storyboards` ADD CONSTRAINT `storyboards_episode_id_fkey` FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `storyboard_panels` ADD CONSTRAINT `storyboard_panels_storyboard_id_fkey` FOREIGN KEY (`storyboard_id`) REFERENCES `storyboards`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `storyboard_panels` ADD CONSTRAINT `storyboard_panels_image_asset_id_fkey` FOREIGN KEY (`image_asset_id`) REFERENCES `media_assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `storyboard_panels` ADD CONSTRAINT `storyboard_panels_video_asset_id_fkey` FOREIGN KEY (`video_asset_id`) REFERENCES `media_assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `asset_references` ADD CONSTRAINT `asset_references_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `asset_references` ADD CONSTRAINT `asset_references_episode_id_fkey` FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `asset_references` ADD CONSTRAINT `asset_references_media_asset_id_fkey` FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
