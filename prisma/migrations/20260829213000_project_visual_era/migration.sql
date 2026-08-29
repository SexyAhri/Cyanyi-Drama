ALTER TABLE "project_configs"
ADD COLUMN "visual_era" VARCHAR(32) NOT NULL DEFAULT 'source',
ADD COLUMN "visual_era_custom" TEXT;
