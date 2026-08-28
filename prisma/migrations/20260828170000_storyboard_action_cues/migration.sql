ALTER TABLE `storyboard_panels`
  ADD COLUMN `world_context_json` TEXT NULL,
  ADD COLUMN `vfx_cues_json` TEXT NULL,
  ADD COLUMN `sfx_cues_json` TEXT NULL;
