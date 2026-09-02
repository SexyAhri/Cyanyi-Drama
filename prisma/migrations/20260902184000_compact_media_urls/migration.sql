UPDATE "media_assets"
SET "url" = '/api/media/assets/' || "id" || '/content'
WHERE "storage_key" IS NOT NULL;

UPDATE "media_tasks"
SET "payload" = jsonb_set(
  "payload",
  '{output}',
  COALESCE(
    (
      SELECT jsonb_agg(
        CASE
          WHEN jsonb_typeof(item) = 'object' AND item ? 'id'
          THEN (item - 'thumbnailUrl') || jsonb_build_object(
            'url',
            '/api/media/assets/' || (item ->> 'id') || '/content'
          )
          ELSE item
        END
      )
      FROM jsonb_array_elements("payload" -> 'output') AS item
    ),
    '[]'::jsonb
  )
)
WHERE jsonb_typeof("payload" -> 'output') = 'array';

UPDATE "media_tasks"
SET "payload" = jsonb_set(
  "payload",
  '{request,referenceImages}',
  COALESCE(
    (
      SELECT jsonb_agg(
        CASE
          WHEN jsonb_typeof(item) = 'object' AND item ? 'storageKey'
          THEN item || jsonb_build_object(
            'url',
            'stored:' || (item ->> 'storageKey')
          )
          ELSE item
        END
      )
      FROM jsonb_array_elements("payload" #> '{request,referenceImages}') AS item
    ),
    '[]'::jsonb
  )
)
WHERE jsonb_typeof("payload" #> '{request,referenceImages}') = 'array';
