INSERT INTO "production_configurations" (
  "id",
  "user_id",
  "scope_key",
  "revision",
  "version",
  "draft",
  "published",
  "history",
  "published_at",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid()::text,
  settings."user_id",
  'user',
  1,
  1,
  jsonb_build_object('workflow', jsonb_build_object('concurrency', settings."workflow_concurrency")),
  jsonb_build_object('workflow', jsonb_build_object('concurrency', settings."workflow_concurrency")),
  jsonb_build_array(
    jsonb_build_object(
      'version', 1,
      'configuration', jsonb_build_object('workflow', jsonb_build_object('concurrency', settings."workflow_concurrency")),
      'note', '迁移原工作流并发设置',
      'createdAt', CURRENT_TIMESTAMP::text,
      'authorId', settings."user_id"
    )
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "user_runtime_settings" AS settings
ON CONFLICT ("user_id", "scope_key") DO NOTHING;
