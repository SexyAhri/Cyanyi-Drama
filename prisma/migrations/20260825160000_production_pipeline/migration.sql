-- AlterTable
ALTER TABLE `storyboard_panels` ADD COLUMN `acting_notes_json` TEXT NULL,
    ADD COLUMN `duration_seconds` DOUBLE NULL,
    ADD COLUMN `first_last_frame_prompt` TEXT NULL,
    ADD COLUMN `linked_to_next_panel` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `phase` VARCHAR(191) NOT NULL DEFAULT 'phase1',
    ADD COLUMN `photography_rules` TEXT NULL,
    ADD COLUMN `srt_end` DOUBLE NULL,
    ADD COLUMN `srt_start` DOUBLE NULL,
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    ADD COLUMN `subtitle_text` TEXT NULL;

-- CreateTable
CREATE TABLE `novel_props` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `summary` TEXT NULL,
    `metadata_json` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `novel_props_project_id_updated_at_idx`(`project_id`, `updated_at`),
    UNIQUE INDEX `novel_props_project_id_name_key`(`project_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `story_clips` (
    `id` VARCHAR(191) NOT NULL,
    `episode_id` VARCHAR(191) NOT NULL,
    `clip_index` INTEGER NOT NULL,
    `summary` TEXT NOT NULL,
    `content` TEXT NOT NULL,
    `start_text` TEXT NULL,
    `end_text` TEXT NULL,
    `screenplay` TEXT NULL,
    `characters_json` TEXT NULL,
    `locations_json` TEXT NULL,
    `props_json` TEXT NULL,
    `shot_count` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,

    INDEX `story_clips_project_id_updated_at_idx`(`project_id`, `updated_at`),
    INDEX `story_clips_episode_id_updated_at_idx`(`episode_id`, `updated_at`),
    UNIQUE INDEX `story_clips_episode_id_clip_index_key`(`episode_id`, `clip_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `story_shots` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `episode_id` VARCHAR(191) NOT NULL,
    `clip_id` VARCHAR(191) NULL,
    `shot_index` INTEGER NOT NULL,
    `sequence` TEXT NULL,
    `description` TEXT NULL,
    `location_name` VARCHAR(191) NULL,
    `characters_json` TEXT NULL,
    `props_json` TEXT NULL,
    `camera_move` TEXT NULL,
    `image_prompt` TEXT NULL,
    `video_prompt` TEXT NULL,
    `image_asset_id` VARCHAR(191) NULL,
    `video_asset_id` VARCHAR(191) NULL,
    `srt_start` DOUBLE NULL,
    `srt_end` DOUBLE NULL,
    `duration_seconds` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `story_shots_project_id_updated_at_idx`(`project_id`, `updated_at`),
    INDEX `story_shots_episode_id_shot_index_idx`(`episode_id`, `shot_index`),
    INDEX `story_shots_clip_id_shot_index_idx`(`clip_id`, `shot_index`),
    INDEX `story_shots_image_asset_id_idx`(`image_asset_id`),
    INDEX `story_shots_video_asset_id_idx`(`video_asset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `voice_presets` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `provider_voice_id` VARCHAR(191) NULL,
    `language` VARCHAR(191) NULL,
    `gender` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `sample_asset_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `voice_presets_user_id_updated_at_idx`(`user_id`, `updated_at`),
    INDEX `voice_presets_project_id_updated_at_idx`(`project_id`, `updated_at`),
    INDEX `voice_presets_sample_asset_id_idx`(`sample_asset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `voice_lines` (
    `id` VARCHAR(191) NOT NULL,
    `episode_id` VARCHAR(191) NOT NULL,
    `line_index` INTEGER NOT NULL,
    `speaker` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `voice_preset_id` VARCHAR(191) NULL,
    `audio_asset_id` VARCHAR(191) NULL,
    `emotion_prompt` TEXT NULL,
    `emotion_strength` DOUBLE NULL,
    `matched_panel_id` VARCHAR(191) NULL,
    `duration_seconds` DOUBLE NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `voice_lines_episode_id_updated_at_idx`(`episode_id`, `updated_at`),
    INDEX `voice_lines_voice_preset_id_idx`(`voice_preset_id`),
    INDEX `voice_lines_audio_asset_id_idx`(`audio_asset_id`),
    INDEX `voice_lines_matched_panel_id_idx`(`matched_panel_id`),
    UNIQUE INDEX `voice_lines_episode_id_line_index_key`(`episode_id`, `line_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `episode_audio_tracks` (
    `id` VARCHAR(191) NOT NULL,
    `episode_id` VARCHAR(191) NOT NULL,
    `track_type` VARCHAR(191) NOT NULL,
    `asset_id` VARCHAR(191) NULL,
    `start_seconds` DOUBLE NULL,
    `end_seconds` DOUBLE NULL,
    `volume` DOUBLE NULL DEFAULT 1,
    `metadata_json` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `episode_audio_tracks_episode_id_track_type_idx`(`episode_id`, `track_type`),
    INDEX `episode_audio_tracks_asset_id_idx`(`asset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `editor_projects` (
    `id` VARCHAR(191) NOT NULL,
    `episode_id` VARCHAR(191) NOT NULL,
    `timeline_json` LONGTEXT NOT NULL,
    `subtitle_json` LONGTEXT NULL,
    `render_status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `render_task_id` VARCHAR(191) NULL,
    `output_asset_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `editor_projects_episode_id_key`(`episode_id`),
    INDEX `editor_projects_output_asset_id_idx`(`output_asset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `novel_props` ADD CONSTRAINT `novel_props_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `story_clips` ADD CONSTRAINT `story_clips_episode_id_fkey` FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `story_clips` ADD CONSTRAINT `story_clips_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `story_shots` ADD CONSTRAINT `story_shots_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `story_shots` ADD CONSTRAINT `story_shots_episode_id_fkey` FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `story_shots` ADD CONSTRAINT `story_shots_clip_id_fkey` FOREIGN KEY (`clip_id`) REFERENCES `story_clips`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `story_shots` ADD CONSTRAINT `story_shots_image_asset_id_fkey` FOREIGN KEY (`image_asset_id`) REFERENCES `media_assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `story_shots` ADD CONSTRAINT `story_shots_video_asset_id_fkey` FOREIGN KEY (`video_asset_id`) REFERENCES `media_assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voice_presets` ADD CONSTRAINT `voice_presets_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voice_presets` ADD CONSTRAINT `voice_presets_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voice_presets` ADD CONSTRAINT `voice_presets_sample_asset_id_fkey` FOREIGN KEY (`sample_asset_id`) REFERENCES `media_assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voice_lines` ADD CONSTRAINT `voice_lines_episode_id_fkey` FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voice_lines` ADD CONSTRAINT `voice_lines_voice_preset_id_fkey` FOREIGN KEY (`voice_preset_id`) REFERENCES `voice_presets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voice_lines` ADD CONSTRAINT `voice_lines_audio_asset_id_fkey` FOREIGN KEY (`audio_asset_id`) REFERENCES `media_assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voice_lines` ADD CONSTRAINT `voice_lines_matched_panel_id_fkey` FOREIGN KEY (`matched_panel_id`) REFERENCES `storyboard_panels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `episode_audio_tracks` ADD CONSTRAINT `episode_audio_tracks_episode_id_fkey` FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `episode_audio_tracks` ADD CONSTRAINT `episode_audio_tracks_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `editor_projects` ADD CONSTRAINT `editor_projects_episode_id_fkey` FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `editor_projects` ADD CONSTRAINT `editor_projects_output_asset_id_fkey` FOREIGN KEY (`output_asset_id`) REFERENCES `media_assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
