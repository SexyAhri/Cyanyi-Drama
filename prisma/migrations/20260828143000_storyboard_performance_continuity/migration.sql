-- AlterTable
ALTER TABLE `storyboard_panels`
    ADD COLUMN `scene_number` INTEGER NULL,
    ADD COLUMN `speaking_character` VARCHAR(191) NULL,
    ADD COLUMN `lip_sync_text` TEXT NULL,
    ADD COLUMN `voiceover_text` TEXT NULL,
    ADD COLUMN `start_state_json` TEXT NULL,
    ADD COLUMN `end_state_json` TEXT NULL,
    ADD COLUMN `motion_beats_json` TEXT NULL;
