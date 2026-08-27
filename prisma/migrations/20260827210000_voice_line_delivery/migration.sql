ALTER TABLE `voice_lines`
  ADD COLUMN `delivery` VARCHAR(32) NOT NULL DEFAULT 'dialogue' AFTER `emotion_strength`;
