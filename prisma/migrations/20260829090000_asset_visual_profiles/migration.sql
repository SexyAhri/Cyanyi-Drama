ALTER TABLE `novel_characters`
    ADD COLUMN `visual_profile_json` LONGTEXT NULL;

ALTER TABLE `novel_locations`
    ADD COLUMN `visual_profile_json` LONGTEXT NULL;

ALTER TABLE `novel_props`
    ADD COLUMN `visual_profile_json` LONGTEXT NULL;
