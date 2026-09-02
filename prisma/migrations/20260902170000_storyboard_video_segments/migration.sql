CREATE TABLE "storyboard_video_segments" (
    "id" TEXT NOT NULL,
    "panel_id" TEXT NOT NULL,
    "task_id" TEXT,
    "segment_index" INTEGER NOT NULL,
    "start_seconds" DOUBLE PRECISION NOT NULL,
    "end_seconds" DOUBLE PRECISION NOT NULL,
    "duration_seconds" DOUBLE PRECISION NOT NULL,
    "prompt" TEXT NOT NULL,
    "action" TEXT,
    "model" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'reference',
    "video_asset_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storyboard_video_segments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "storyboard_video_segments_task_id_key"
ON "storyboard_video_segments"("task_id");

CREATE UNIQUE INDEX "storyboard_video_segments_panel_id_segment_index_key"
ON "storyboard_video_segments"("panel_id", "segment_index");

CREATE INDEX "storyboard_video_segments_panel_id_updated_at_idx"
ON "storyboard_video_segments"("panel_id", "updated_at");

CREATE INDEX "storyboard_video_segments_video_asset_id_idx"
ON "storyboard_video_segments"("video_asset_id");

ALTER TABLE "storyboard_video_segments"
ADD CONSTRAINT "storyboard_video_segments_panel_id_fkey"
FOREIGN KEY ("panel_id") REFERENCES "storyboard_panels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "storyboard_video_segments"
ADD CONSTRAINT "storyboard_video_segments_video_asset_id_fkey"
FOREIGN KEY ("video_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
