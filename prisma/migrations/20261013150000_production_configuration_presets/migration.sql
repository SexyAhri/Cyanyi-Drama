CREATE TABLE "production_configuration_presets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "name_key" VARCHAR(80) NOT NULL,
    "configuration" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "production_configuration_presets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "production_configuration_presets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "production_configuration_presets_user_id_name_key_key" ON "production_configuration_presets"("user_id", "name_key");
CREATE INDEX "production_configuration_presets_user_id_created_at_idx" ON "production_configuration_presets"("user_id", "created_at");
