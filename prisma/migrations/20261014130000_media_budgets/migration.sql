CREATE TABLE "media_budgets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "scope_type" VARCHAR(24) NOT NULL,
    "scope_id" VARCHAR(191) NOT NULL,
    "limit" DECIMAL(18,6) NOT NULL,
    "unit" VARCHAR(32) NOT NULL DEFAULT 'credit',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "media_budgets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "media_budgets_project_id_scope_type_scope_id_key"
    ON "media_budgets"("project_id", "scope_type", "scope_id");
CREATE INDEX "media_budgets_user_id_project_id_idx"
    ON "media_budgets"("user_id", "project_id");
CREATE INDEX "media_budgets_project_id_scope_type_idx"
    ON "media_budgets"("project_id", "scope_type");

ALTER TABLE "media_budgets" ADD CONSTRAINT "media_budgets_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_budgets" ADD CONSTRAINT "media_budgets_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;