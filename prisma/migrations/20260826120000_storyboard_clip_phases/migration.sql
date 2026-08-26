-- AlterTable
ALTER TABLE `storyboard_panels`
    ADD COLUMN `clip_id` VARCHAR(191) NULL,
    ADD COLUMN `clip_panel_index` INTEGER NULL,
    ADD COLUMN `source_evidence_json` TEXT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `storyboard_panels_clip_id_clip_panel_index_key`
    ON `storyboard_panels`(`clip_id`, `clip_panel_index`);

-- CreateIndex
CREATE INDEX `storyboard_panels_storyboard_id_clip_id_idx`
    ON `storyboard_panels`(`storyboard_id`, `clip_id`);

-- AddForeignKey
ALTER TABLE `storyboard_panels`
    ADD CONSTRAINT `storyboard_panels_clip_id_fkey`
    FOREIGN KEY (`clip_id`) REFERENCES `story_clips`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
