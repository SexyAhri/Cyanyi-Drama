ALTER TABLE `user_runtime_settings`
    ADD COLUMN `image_generation_ratio` VARCHAR(191) NOT NULL DEFAULT '1:1',
    ADD COLUMN `image_generation_resolution` VARCHAR(191) NOT NULL DEFAULT '1k',
    ADD COLUMN `image_generation_count` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `image_generation_quality` VARCHAR(191) NOT NULL DEFAULT 'high',
    ADD COLUMN `video_generation_ratio` VARCHAR(191) NOT NULL DEFAULT '16:9',
    ADD COLUMN `video_generation_resolution` VARCHAR(191) NOT NULL DEFAULT '1080p',
    ADD COLUMN `video_generation_duration` VARCHAR(191) NOT NULL DEFAULT '10s';
