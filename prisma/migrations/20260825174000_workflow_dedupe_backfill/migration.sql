-- Backfill workflow targets for runs created before target-level deduplication.
UPDATE `workflow_runs`
SET
    `target_type` = COALESCE(`target_type`, IF(`episode_id` IS NULL, 'project', 'episode')),
    `target_id` = COALESCE(`target_id`, `episode_id`, `project_id`)
WHERE `target_type` IS NULL OR `target_id` IS NULL;

-- Keep only the newest active run when legacy data already contains duplicates.
UPDATE `workflow_runs` AS `run`
INNER JOIN (
    SELECT `id`
    FROM (
        SELECT
            `id`,
            ROW_NUMBER() OVER (
                PARTITION BY `user_id`, `project_id`, `workflow_type`, `target_type`, `target_id`
                ORDER BY `updated_at` DESC, `created_at` DESC
            ) AS `row_number`
        FROM `workflow_runs`
        WHERE `status` IN ('queued', 'running', 'canceling', 'paused')
    ) AS `ranked_runs`
    WHERE `row_number` > 1
) AS `duplicate_runs` ON `duplicate_runs`.`id` = `run`.`id`
SET
    `run`.`status` = 'failed',
    `run`.`error` = JSON_OBJECT(
        'code', 'WORKFLOW_DUPLICATE_SUPERSEDED',
        'message', 'A newer active run exists for the same workflow target.'
    ),
    `run`.`completed_at` = CURRENT_TIMESTAMP(3),
    `run`.`active_dedupe_key` = NULL,
    `run`.`lease_owner` = NULL,
    `run`.`lease_expires_at` = NULL;

-- Populate the active key after legacy duplicates have been settled.
UPDATE `workflow_runs`
SET `active_dedupe_key` = SHA2(
    CONCAT_WS(
        CHAR(0),
        LOWER(TRIM(`user_id`)),
        LOWER(TRIM(`project_id`)),
        LOWER(TRIM(`workflow_type`)),
        LOWER(TRIM(`target_type`)),
        LOWER(TRIM(`target_id`))
    ),
    256
)
WHERE `status` IN ('queued', 'running', 'canceling', 'paused');
