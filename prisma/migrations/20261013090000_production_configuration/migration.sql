CREATE TABLE "production_configurations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "draft" JSONB NOT NULL DEFAULT '{}',
    "published" JSONB,
    "history" JSONB NOT NULL DEFAULT '[]',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "production_configurations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "production_configurations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "production_configurations_user_id_scope_key_key" ON "production_configurations"("user_id", "scope_key");
CREATE INDEX "production_configurations_user_id_updated_at_idx" ON "production_configurations"("user_id", "updated_at");
