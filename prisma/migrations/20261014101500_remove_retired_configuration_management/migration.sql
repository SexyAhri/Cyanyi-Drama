-- Retain live Agent settings and sound mode; task/run snapshots are untouched.
BEGIN;
WITH retained AS (
  SELECT id,
    (CASE WHEN scope_key = 'user' AND jsonb_typeof(draft->'agents') = 'object'
      THEN jsonb_build_object('agents', draft->'agents') ELSE '{}'::jsonb END)
    || (CASE WHEN draft->'sound'->>'mode' IN ('native', 'post', 'silent')
      THEN jsonb_build_object('sound', jsonb_build_object('mode', draft->'sound'->'mode')) ELSE '{}'::jsonb END) AS next_draft,
    CASE WHEN published IS NULL THEN NULL ELSE
      (CASE WHEN scope_key = 'user' AND jsonb_typeof(published->'agents') = 'object'
        THEN jsonb_build_object('agents', published->'agents') ELSE '{}'::jsonb END)
      || (CASE WHEN published->'sound'->>'mode' IN ('native', 'post', 'silent')
        THEN jsonb_build_object('sound', jsonb_build_object('mode', published->'sound'->'mode')) ELSE '{}'::jsonb END)
    END AS next_published
  FROM production_configurations
)
UPDATE production_configurations AS config
SET draft = retained.next_draft,
    published = retained.next_published,
    revision = config.revision + 1,
    version = config.version + CASE WHEN config.published IS DISTINCT FROM retained.next_published THEN 1 ELSE 0 END,
    updated_at = CURRENT_TIMESTAMP
FROM retained
WHERE config.id = retained.id
  AND (config.draft IS DISTINCT FROM retained.next_draft OR config.published IS DISTINCT FROM retained.next_published);

DROP TABLE production_configuration_presets;
ALTER TABLE production_configurations DROP COLUMN history;
COMMIT;
