ALTER TABLE "media_hashes"
ADD COLUMN "data" BYTEA;

CREATE UNIQUE INDEX "media_hashes_storage_key_key"
ON "media_hashes"("storage_key");
