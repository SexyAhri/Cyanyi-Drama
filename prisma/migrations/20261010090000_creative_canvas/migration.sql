CREATE TABLE "creative_canvases" (
  "episode_id" TEXT NOT NULL,
  "document" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "creative_canvases_pkey" PRIMARY KEY ("episode_id"),
  CONSTRAINT "creative_canvases_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
