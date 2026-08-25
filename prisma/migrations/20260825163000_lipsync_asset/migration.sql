-- AlterTable
ALTER TABLE `storyboard_panels` ADD COLUMN `lip_sync_asset_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `storyboard_panels_lip_sync_asset_id_idx` ON `storyboard_panels`(`lip_sync_asset_id`);

-- AddForeignKey
ALTER TABLE `storyboard_panels` ADD CONSTRAINT `storyboard_panels_lip_sync_asset_id_fkey` FOREIGN KEY (`lip_sync_asset_id`) REFERENCES `media_assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
