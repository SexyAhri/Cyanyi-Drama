-- AlterTable
ALTER TABLE `channels` ADD COLUMN `provider_key` VARCHAR(191) NOT NULL DEFAULT 'custom';

-- AlterTable
ALTER TABLE `location_images` ADD COLUMN `metadata_json` TEXT NULL;
