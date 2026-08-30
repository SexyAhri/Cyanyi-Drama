ALTER TABLE "voice_lines"
ADD COLUMN "voice_profile_prompt" TEXT,
ADD COLUMN "optimize_instructions" BOOLEAN NOT NULL DEFAULT true;
