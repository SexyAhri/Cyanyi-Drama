-- CreateTable
CREATE TABLE "execution_notification_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "completed_enabled" BOOLEAN NOT NULL DEFAULT true,
    "partial_failure_enabled" BOOLEAN NOT NULL DEFAULT true,
    "action_required_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execution_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "run_id" TEXT,
    "media_task_id" TEXT,
    "kind" VARCHAR(32) NOT NULL,
    "dedupe_key" VARCHAR(191) NOT NULL,
    "title_zh" VARCHAR(240) NOT NULL,
    "title_en" VARCHAR(240) NOT NULL,
    "body_zh" TEXT NOT NULL,
    "body_en" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "execution_notification_preferences_user_id_key" ON "execution_notification_preferences"("user_id");

-- CreateIndex
CREATE INDEX "execution_notifications_user_id_read_at_created_at_idx" ON "execution_notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "execution_notifications_project_id_created_at_idx" ON "execution_notifications"("project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "execution_notifications_user_id_dedupe_key_key" ON "execution_notifications"("user_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "execution_notification_preferences" ADD CONSTRAINT "execution_notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_notifications" ADD CONSTRAINT "execution_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_notifications" ADD CONSTRAINT "execution_notifications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
