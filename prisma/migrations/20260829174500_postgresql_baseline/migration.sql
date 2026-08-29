-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT,
    "email_verified_at" TIMESTAMP(3),
    "display_name" TEXT NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_runtime_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "structured_request_timeout_seconds" INTEGER NOT NULL DEFAULT 600,
    "structured_output_streaming" BOOLEAN NOT NULL DEFAULT true,
    "structured_transport_max_attempts" INTEGER NOT NULL DEFAULT 3,
    "workflow_step_max_attempts" INTEGER NOT NULL DEFAULT 3,
    "workflow_concurrency" INTEGER NOT NULL DEFAULT 2,
    "screenplay_clip_max_chars" INTEGER NOT NULL DEFAULT 1600,
    "image_generation_ratio" TEXT NOT NULL DEFAULT '1:1',
    "image_generation_resolution" TEXT NOT NULL DEFAULT '1k',
    "image_generation_count" INTEGER NOT NULL DEFAULT 1,
    "image_generation_quality" TEXT NOT NULL DEFAULT 'high',
    "video_generation_ratio" TEXT NOT NULL DEFAULT '16:9',
    "video_generation_resolution" TEXT NOT NULL DEFAULT '1080p',
    "video_generation_duration" TEXT NOT NULL DEFAULT '10s',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_runtime_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verifications" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider_key" TEXT NOT NULL DEFAULT 'custom',
    "protocol" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "encrypted_api_keys" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "models" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model_type" TEXT NOT NULL,
    "capabilities_json" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "last_accessed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_configs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "analysis_model" TEXT,
    "character_model" TEXT,
    "location_model" TEXT,
    "storyboard_model" TEXT,
    "edit_model" TEXT,
    "video_model" TEXT,
    "audio_model" TEXT,
    "video_ratio" TEXT NOT NULL DEFAULT '9:16',
    "video_resolution" TEXT NOT NULL DEFAULT '720p',
    "art_style" TEXT NOT NULL DEFAULT 'american-comic',
    "tts_rate" TEXT NOT NULL DEFAULT '+50%',
    "workflow_mode" TEXT NOT NULL DEFAULT 'novel-promotion',
    "global_asset_text" TEXT,
    "capability_overrides_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episodes" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "episode_number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "novel_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_tasks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "trace_id" VARCHAR(64) NOT NULL,
    "span_id" VARCHAR(64) NOT NULL,
    "parent_span_id" VARCHAR(64),
    "workflow_run_id" TEXT,
    "workflow_step_id" TEXT,
    "channel_id" TEXT,
    "idempotency_key" TEXT,
    "project_id" TEXT,
    "episode_id" TEXT,
    "batch_id" TEXT,
    "target_type" TEXT,
    "target_id" TEXT,
    "status" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "provider_task_id" TEXT,
    "payload" JSONB NOT NULL,
    "error" JSONB,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 2,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progress_message" TEXT,
    "queue_job_id" TEXT,
    "cancel_requested_at" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "media_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_task_events" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT,
    "progress" INTEGER,
    "message" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storage_key" TEXT,
    "url" TEXT,
    "mime_type" TEXT,
    "metadata_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "novel_characters" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT,
    "profile_json" TEXT,
    "visual_profile_json" TEXT,
    "introduction" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "novel_characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_appearances" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "appearance_index" INTEGER NOT NULL,
    "description" TEXT,
    "image_asset_id" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "metadata_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "character_appearances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "novel_locations" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "visual_profile_json" TEXT,
    "selected_image_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "novel_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "novel_props" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "metadata_json" TEXT,
    "visual_profile_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "novel_props_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_images" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "image_index" INTEGER NOT NULL,
    "description" TEXT,
    "available_slots" TEXT,
    "metadata_json" TEXT,
    "image_asset_id" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storyboards" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "source_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storyboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storyboard_panels" (
    "id" TEXT NOT NULL,
    "storyboard_id" TEXT NOT NULL,
    "clip_id" TEXT,
    "clip_panel_index" INTEGER,
    "panel_index" INTEGER NOT NULL,
    "scene_number" INTEGER,
    "shot_type" TEXT,
    "camera_move" TEXT,
    "description" TEXT,
    "location_name" TEXT,
    "characters_json" TEXT,
    "props_json" TEXT,
    "image_prompt" TEXT,
    "video_prompt" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'phase1',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "srt_start" DOUBLE PRECISION,
    "srt_end" DOUBLE PRECISION,
    "duration_seconds" DOUBLE PRECISION,
    "subtitle_text" TEXT,
    "speaking_character" TEXT,
    "lip_sync_text" TEXT,
    "voiceover_text" TEXT,
    "start_state_json" TEXT,
    "end_state_json" TEXT,
    "motion_beats_json" TEXT,
    "world_context_json" TEXT,
    "vfx_cues_json" TEXT,
    "sfx_cues_json" TEXT,
    "acting_notes_json" TEXT,
    "photography_rules" TEXT,
    "first_last_frame_prompt" TEXT,
    "linked_to_next_panel" BOOLEAN NOT NULL DEFAULT false,
    "source_evidence_json" TEXT,
    "image_asset_id" TEXT,
    "video_asset_id" TEXT,
    "lip_sync_asset_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storyboard_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_clips" (
    "id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "clip_index" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "start_text" TEXT,
    "end_text" TEXT,
    "screenplay" TEXT,
    "characters_json" TEXT,
    "locations_json" TEXT,
    "props_json" TEXT,
    "shot_count" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "project_id" TEXT NOT NULL,

    CONSTRAINT "story_clips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_shots" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "clip_id" TEXT,
    "shot_index" INTEGER NOT NULL,
    "sequence" TEXT,
    "description" TEXT,
    "location_name" TEXT,
    "characters_json" TEXT,
    "props_json" TEXT,
    "camera_move" TEXT,
    "image_prompt" TEXT,
    "video_prompt" TEXT,
    "image_asset_id" TEXT,
    "video_asset_id" TEXT,
    "srt_start" DOUBLE PRECISION,
    "srt_end" DOUBLE PRECISION,
    "duration_seconds" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "story_shots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_presets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "name" TEXT NOT NULL,
    "provider_voice_id" TEXT,
    "language" TEXT,
    "gender" TEXT,
    "description" TEXT,
    "sample_asset_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_lines" (
    "id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "line_index" INTEGER NOT NULL,
    "speaker" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "voice_preset_id" TEXT,
    "audio_asset_id" TEXT,
    "emotion_prompt" TEXT,
    "emotion_strength" DOUBLE PRECISION,
    "delivery" TEXT NOT NULL DEFAULT 'dialogue',
    "matched_panel_id" TEXT,
    "duration_seconds" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode_audio_tracks" (
    "id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "track_type" TEXT NOT NULL,
    "asset_id" TEXT,
    "start_seconds" DOUBLE PRECISION,
    "end_seconds" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION DEFAULT 1,
    "metadata_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "episode_audio_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editor_projects" (
    "id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "timeline_json" TEXT NOT NULL,
    "subtitle_json" TEXT,
    "render_status" TEXT NOT NULL DEFAULT 'draft',
    "render_task_id" TEXT,
    "output_asset_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "editor_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_references" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "episode_id" TEXT,
    "media_asset_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "metadata_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_deliverables" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "episode_id" TEXT,
    "scope_type" VARCHAR(32) NOT NULL,
    "scope_id" TEXT NOT NULL,
    "department" VARCHAR(64) NOT NULL,
    "deliverable_type" VARCHAR(96) NOT NULL,
    "title" TEXT NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "source_refs" JSONB,
    "prompt_trace" JSONB,
    "cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "dependency_hash" TEXT NOT NULL,
    "approved_by_user_id" TEXT,
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_deliverables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_deliverable_dependencies" (
    "id" TEXT NOT NULL,
    "deliverable_id" TEXT NOT NULL,
    "depends_on_id" TEXT NOT NULL,
    "required_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_deliverable_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_approval_gates" (
    "id" TEXT NOT NULL,
    "deliverable_id" TEXT NOT NULL,
    "gate_key" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "decided_by_user_id" TEXT,
    "note" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_approval_gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "trace_id" VARCHAR(64) NOT NULL,
    "span_id" VARCHAR(64) NOT NULL,
    "project_id" TEXT NOT NULL,
    "episode_id" TEXT,
    "workflow_type" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "active_dedupe_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "input" JSONB,
    "output" JSONB,
    "error" JSONB,
    "cancel_requested_at" TIMESTAMP(3),
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "workflow_version" INTEGER NOT NULL DEFAULT 1,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_steps" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "trace_id" VARCHAR(64) NOT NULL,
    "span_id" VARCHAR(64) NOT NULL,
    "parent_span_id" VARCHAR(64) NOT NULL,
    "step_key" TEXT NOT NULL,
    "step_type" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dependsOn" JSONB,
    "artifactTypes" JSONB,
    "retryable" BOOLEAN NOT NULL DEFAULT true,
    "failure_mode" TEXT NOT NULL DEFAULT 'fail_run',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "input" JSONB,
    "output" JSONB,
    "error" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_artifacts" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "artifact_type" TEXT NOT NULL,
    "ref_id" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_events" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "step_id" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT,
    "message" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_asset_folders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_asset_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_characters" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "folder_id" TEXT,
    "name" TEXT NOT NULL,
    "aliases" TEXT,
    "profile_data" TEXT,
    "profile_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "voice_id" TEXT,
    "voice_type" TEXT,
    "global_voice_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_character_appearances" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "appearance_index" INTEGER NOT NULL,
    "change_reason" TEXT NOT NULL DEFAULT 'default',
    "art_style" TEXT,
    "description" TEXT,
    "image_url" TEXT,
    "image_asset_id" TEXT,
    "image_urls" TEXT,
    "selected_index" INTEGER,
    "previous_image_url" TEXT,
    "previous_description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_character_appearances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_locations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "folder_id" TEXT,
    "name" TEXT NOT NULL,
    "art_style" TEXT,
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_location_images" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "image_index" INTEGER NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "image_asset_id" TEXT,
    "is_selected" BOOLEAN NOT NULL DEFAULT false,
    "previous_image_url" TEXT,
    "previous_description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_location_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_voices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "folder_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "voice_id" TEXT,
    "voice_type" TEXT NOT NULL DEFAULT 'designed',
    "custom_voice_url" TEXT,
    "voice_prompt" TEXT,
    "gender" TEXT,
    "language" TEXT NOT NULL DEFAULT 'zh',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_voices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_balances" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "balance" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "frozen_amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total_spent" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_freezes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source" VARCHAR(64),
    "task_id" TEXT,
    "request_id" TEXT,
    "idempotency_key" TEXT,
    "metadata" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_freezes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "balance_after" DECIMAL(18,6) NOT NULL,
    "description" TEXT,
    "related_id" TEXT,
    "freeze_id" TEXT,
    "idempotency_key" VARCHAR(128),
    "project_id" VARCHAR(128),
    "episode_id" VARCHAR(128),
    "task_type" VARCHAR(64),
    "billing_meta" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_costs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "api_type" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "cost" DECIMAL(18,6) NOT NULL,
    "source_type" VARCHAR(64),
    "source_id" VARCHAR(191),
    "idempotency_key" VARCHAR(191),
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_checkpoints" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "step_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state_json" JSONB NOT NULL,
    "state_bytes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_step_attempts" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider" TEXT,
    "model_key" TEXT,
    "input_hash" TEXT,
    "input" JSONB,
    "output_text" TEXT,
    "usage_json" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_step_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_hashes" (
    "id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" VARCHAR(512) NOT NULL,
    "mime_type" TEXT,
    "size_bytes" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_hashes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_prices" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_runtime_settings_user_id_key" ON "user_runtime_settings"("user_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "email_verifications_email_purpose_created_at_idx" ON "email_verifications"("email", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "email_verifications_expires_at_idx" ON "email_verifications"("expires_at");

-- CreateIndex
CREATE INDEX "channels_user_id_created_at_idx" ON "channels"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "models_channel_id_idx" ON "models"("channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "models_channel_id_model_id_key" ON "models"("channel_id", "model_id");

-- CreateIndex
CREATE INDEX "projects_user_id_updated_at_idx" ON "projects"("user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "project_configs_project_id_key" ON "project_configs"("project_id");

-- CreateIndex
CREATE INDEX "episodes_project_id_episode_number_idx" ON "episodes"("project_id", "episode_number");

-- CreateIndex
CREATE UNIQUE INDEX "episodes_project_id_episode_number_key" ON "episodes"("project_id", "episode_number");

-- CreateIndex
CREATE UNIQUE INDEX "media_tasks_span_id_key" ON "media_tasks"("span_id");

-- CreateIndex
CREATE INDEX "media_tasks_user_id_updated_at_idx" ON "media_tasks"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "media_tasks_project_id_updated_at_idx" ON "media_tasks"("project_id", "updated_at");

-- CreateIndex
CREATE INDEX "media_tasks_episode_id_updated_at_idx" ON "media_tasks"("episode_id", "updated_at");

-- CreateIndex
CREATE INDEX "media_tasks_batch_id_updated_at_idx" ON "media_tasks"("batch_id", "updated_at");

-- CreateIndex
CREATE INDEX "media_tasks_channel_id_updated_at_idx" ON "media_tasks"("channel_id", "updated_at");

-- CreateIndex
CREATE INDEX "media_tasks_trace_id_created_at_idx" ON "media_tasks"("trace_id", "created_at");

-- CreateIndex
CREATE INDEX "media_tasks_workflow_run_id_workflow_step_id_idx" ON "media_tasks"("workflow_run_id", "workflow_step_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_tasks_user_id_idempotency_key_key" ON "media_tasks"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "media_task_events_task_id_created_at_idx" ON "media_task_events"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "media_assets_task_id_idx" ON "media_assets"("task_id");

-- CreateIndex
CREATE INDEX "novel_characters_project_id_updated_at_idx" ON "novel_characters"("project_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "novel_characters_project_id_name_key" ON "novel_characters"("project_id", "name");

-- CreateIndex
CREATE INDEX "character_appearances_character_id_updated_at_idx" ON "character_appearances"("character_id", "updated_at");

-- CreateIndex
CREATE INDEX "character_appearances_image_asset_id_idx" ON "character_appearances"("image_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "character_appearances_character_id_appearance_index_key" ON "character_appearances"("character_id", "appearance_index");

-- CreateIndex
CREATE INDEX "novel_locations_project_id_updated_at_idx" ON "novel_locations"("project_id", "updated_at");

-- CreateIndex
CREATE INDEX "novel_locations_selected_image_id_idx" ON "novel_locations"("selected_image_id");

-- CreateIndex
CREATE UNIQUE INDEX "novel_locations_project_id_name_key" ON "novel_locations"("project_id", "name");

-- CreateIndex
CREATE INDEX "novel_props_project_id_updated_at_idx" ON "novel_props"("project_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "novel_props_project_id_name_key" ON "novel_props"("project_id", "name");

-- CreateIndex
CREATE INDEX "location_images_location_id_updated_at_idx" ON "location_images"("location_id", "updated_at");

-- CreateIndex
CREATE INDEX "location_images_image_asset_id_idx" ON "location_images"("image_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "location_images_location_id_image_index_key" ON "location_images"("location_id", "image_index");

-- CreateIndex
CREATE UNIQUE INDEX "storyboards_episode_id_key" ON "storyboards"("episode_id");

-- CreateIndex
CREATE INDEX "storyboards_project_id_updated_at_idx" ON "storyboards"("project_id", "updated_at");

-- CreateIndex
CREATE INDEX "storyboard_panels_storyboard_id_updated_at_idx" ON "storyboard_panels"("storyboard_id", "updated_at");

-- CreateIndex
CREATE INDEX "storyboard_panels_storyboard_id_clip_id_idx" ON "storyboard_panels"("storyboard_id", "clip_id");

-- CreateIndex
CREATE INDEX "storyboard_panels_image_asset_id_idx" ON "storyboard_panels"("image_asset_id");

-- CreateIndex
CREATE INDEX "storyboard_panels_video_asset_id_idx" ON "storyboard_panels"("video_asset_id");

-- CreateIndex
CREATE INDEX "storyboard_panels_lip_sync_asset_id_idx" ON "storyboard_panels"("lip_sync_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "storyboard_panels_storyboard_id_panel_index_key" ON "storyboard_panels"("storyboard_id", "panel_index");

-- CreateIndex
CREATE UNIQUE INDEX "storyboard_panels_clip_id_clip_panel_index_key" ON "storyboard_panels"("clip_id", "clip_panel_index");

-- CreateIndex
CREATE INDEX "story_clips_project_id_updated_at_idx" ON "story_clips"("project_id", "updated_at");

-- CreateIndex
CREATE INDEX "story_clips_episode_id_updated_at_idx" ON "story_clips"("episode_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "story_clips_episode_id_clip_index_key" ON "story_clips"("episode_id", "clip_index");

-- CreateIndex
CREATE INDEX "story_shots_project_id_updated_at_idx" ON "story_shots"("project_id", "updated_at");

-- CreateIndex
CREATE INDEX "story_shots_episode_id_shot_index_idx" ON "story_shots"("episode_id", "shot_index");

-- CreateIndex
CREATE INDEX "story_shots_clip_id_shot_index_idx" ON "story_shots"("clip_id", "shot_index");

-- CreateIndex
CREATE INDEX "story_shots_image_asset_id_idx" ON "story_shots"("image_asset_id");

-- CreateIndex
CREATE INDEX "story_shots_video_asset_id_idx" ON "story_shots"("video_asset_id");

-- CreateIndex
CREATE INDEX "voice_presets_user_id_updated_at_idx" ON "voice_presets"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "voice_presets_project_id_updated_at_idx" ON "voice_presets"("project_id", "updated_at");

-- CreateIndex
CREATE INDEX "voice_presets_sample_asset_id_idx" ON "voice_presets"("sample_asset_id");

-- CreateIndex
CREATE INDEX "voice_lines_episode_id_updated_at_idx" ON "voice_lines"("episode_id", "updated_at");

-- CreateIndex
CREATE INDEX "voice_lines_voice_preset_id_idx" ON "voice_lines"("voice_preset_id");

-- CreateIndex
CREATE INDEX "voice_lines_audio_asset_id_idx" ON "voice_lines"("audio_asset_id");

-- CreateIndex
CREATE INDEX "voice_lines_matched_panel_id_idx" ON "voice_lines"("matched_panel_id");

-- CreateIndex
CREATE UNIQUE INDEX "voice_lines_episode_id_line_index_key" ON "voice_lines"("episode_id", "line_index");

-- CreateIndex
CREATE INDEX "episode_audio_tracks_episode_id_track_type_idx" ON "episode_audio_tracks"("episode_id", "track_type");

-- CreateIndex
CREATE INDEX "episode_audio_tracks_asset_id_idx" ON "episode_audio_tracks"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "editor_projects_episode_id_key" ON "editor_projects"("episode_id");

-- CreateIndex
CREATE INDEX "editor_projects_output_asset_id_idx" ON "editor_projects"("output_asset_id");

-- CreateIndex
CREATE INDEX "asset_references_project_id_entity_type_entity_id_idx" ON "asset_references"("project_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "asset_references_episode_id_created_at_idx" ON "asset_references"("episode_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "asset_references_media_asset_id_entity_type_entity_id_role_key" ON "asset_references"("media_asset_id", "entity_type", "entity_id", "role");

-- CreateIndex
CREATE INDEX "production_deliverables_user_id_updated_at_idx" ON "production_deliverables"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "production_deliverables_project_id_department_status_idx" ON "production_deliverables"("project_id", "department", "status");

-- CreateIndex
CREATE INDEX "production_deliverables_episode_id_updated_at_idx" ON "production_deliverables"("episode_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "production_deliverables_project_id_scope_type_scope_id_deli_key" ON "production_deliverables"("project_id", "scope_type", "scope_id", "deliverable_type", "version");

-- CreateIndex
CREATE INDEX "production_deliverable_dependencies_depends_on_id_idx" ON "production_deliverable_dependencies"("depends_on_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_deliverable_dependencies_deliverable_id_depends__key" ON "production_deliverable_dependencies"("deliverable_id", "depends_on_id");

-- CreateIndex
CREATE INDEX "production_approval_gates_status_updated_at_idx" ON "production_approval_gates"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "production_approval_gates_deliverable_id_gate_key_key" ON "production_approval_gates"("deliverable_id", "gate_key");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_runs_trace_id_key" ON "workflow_runs"("trace_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_runs_span_id_key" ON "workflow_runs"("span_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_runs_active_dedupe_key_key" ON "workflow_runs"("active_dedupe_key");

-- CreateIndex
CREATE INDEX "workflow_runs_user_id_created_at_idx" ON "workflow_runs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "workflow_runs_project_id_status_idx" ON "workflow_runs"("project_id", "status");

-- CreateIndex
CREATE INDEX "workflow_runs_episode_id_created_at_idx" ON "workflow_runs"("episode_id", "created_at");

-- CreateIndex
CREATE INDEX "workflow_runs_workflow_type_target_type_target_id_status_idx" ON "workflow_runs"("workflow_type", "target_type", "target_id", "status");

-- CreateIndex
CREATE INDEX "workflow_runs_lease_expires_at_idx" ON "workflow_runs"("lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_steps_span_id_key" ON "workflow_steps"("span_id");

-- CreateIndex
CREATE INDEX "workflow_steps_run_id_status_idx" ON "workflow_steps"("run_id", "status");

-- CreateIndex
CREATE INDEX "workflow_steps_run_id_step_index_idx" ON "workflow_steps"("run_id", "step_index");

-- CreateIndex
CREATE INDEX "workflow_steps_trace_id_step_index_idx" ON "workflow_steps"("trace_id", "step_index");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_steps_run_id_step_key_key" ON "workflow_steps"("run_id", "step_key");

-- CreateIndex
CREATE INDEX "workflow_artifacts_run_id_artifact_type_idx" ON "workflow_artifacts"("run_id", "artifact_type");

-- CreateIndex
CREATE INDEX "workflow_artifacts_ref_id_idx" ON "workflow_artifacts"("ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_artifacts_run_id_step_id_artifact_type_ref_id_key" ON "workflow_artifacts"("run_id", "step_id", "artifact_type", "ref_id");

-- CreateIndex
CREATE INDEX "workflow_events_run_id_created_at_idx" ON "workflow_events"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "workflow_events_step_id_created_at_idx" ON "workflow_events"("step_id", "created_at");

-- CreateIndex
CREATE INDEX "global_asset_folders_user_id_idx" ON "global_asset_folders"("user_id");

-- CreateIndex
CREATE INDEX "global_characters_user_id_idx" ON "global_characters"("user_id");

-- CreateIndex
CREATE INDEX "global_characters_folder_id_idx" ON "global_characters"("folder_id");

-- CreateIndex
CREATE INDEX "global_character_appearances_character_id_idx" ON "global_character_appearances"("character_id");

-- CreateIndex
CREATE UNIQUE INDEX "global_character_appearances_character_id_appearance_index_key" ON "global_character_appearances"("character_id", "appearance_index");

-- CreateIndex
CREATE INDEX "global_locations_user_id_idx" ON "global_locations"("user_id");

-- CreateIndex
CREATE INDEX "global_locations_folder_id_idx" ON "global_locations"("folder_id");

-- CreateIndex
CREATE INDEX "global_location_images_location_id_idx" ON "global_location_images"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "global_location_images_location_id_image_index_key" ON "global_location_images"("location_id", "image_index");

-- CreateIndex
CREATE INDEX "global_voices_user_id_idx" ON "global_voices"("user_id");

-- CreateIndex
CREATE INDEX "global_voices_folder_id_idx" ON "global_voices"("folder_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_balances_user_id_key" ON "user_balances"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "balance_freezes_idempotency_key_key" ON "balance_freezes"("idempotency_key");

-- CreateIndex
CREATE INDEX "balance_freezes_user_id_idx" ON "balance_freezes"("user_id");

-- CreateIndex
CREATE INDEX "balance_freezes_status_idx" ON "balance_freezes"("status");

-- CreateIndex
CREATE INDEX "balance_freezes_task_id_idx" ON "balance_freezes"("task_id");

-- CreateIndex
CREATE INDEX "balance_transactions_user_id_idx" ON "balance_transactions"("user_id");

-- CreateIndex
CREATE INDEX "balance_transactions_type_idx" ON "balance_transactions"("type");

-- CreateIndex
CREATE INDEX "balance_transactions_created_at_idx" ON "balance_transactions"("created_at");

-- CreateIndex
CREATE INDEX "balance_transactions_freeze_id_idx" ON "balance_transactions"("freeze_id");

-- CreateIndex
CREATE UNIQUE INDEX "balance_transactions_user_id_type_idempotency_key_key" ON "balance_transactions"("user_id", "type", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "usage_costs_idempotency_key_key" ON "usage_costs"("idempotency_key");

-- CreateIndex
CREATE INDEX "usage_costs_api_type_idx" ON "usage_costs"("api_type");

-- CreateIndex
CREATE INDEX "usage_costs_created_at_idx" ON "usage_costs"("created_at");

-- CreateIndex
CREATE INDEX "usage_costs_project_id_idx" ON "usage_costs"("project_id");

-- CreateIndex
CREATE INDEX "usage_costs_user_id_idx" ON "usage_costs"("user_id");

-- CreateIndex
CREATE INDEX "usage_costs_source_type_source_id_idx" ON "usage_costs"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "workflow_checkpoints_run_id_created_at_idx" ON "workflow_checkpoints"("run_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_checkpoints_run_id_step_key_version_key" ON "workflow_checkpoints"("run_id", "step_key", "version");

-- CreateIndex
CREATE INDEX "workflow_step_attempts_run_id_step_id_idx" ON "workflow_step_attempts"("run_id", "step_id");

-- CreateIndex
CREATE INDEX "workflow_step_attempts_step_id_attempt_idx" ON "workflow_step_attempts"("step_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "media_hashes_sha256_key" ON "media_hashes"("sha256");

-- CreateIndex
CREATE INDEX "media_hashes_sha256_idx" ON "media_hashes"("sha256");

-- CreateIndex
CREATE INDEX "model_prices_provider_model_active_idx" ON "model_prices"("provider", "model", "active");

-- CreateIndex
CREATE UNIQUE INDEX "model_prices_provider_model_capability_unit_key" ON "model_prices"("provider", "model", "capability", "unit");

-- AddForeignKey
ALTER TABLE "user_runtime_settings" ADD CONSTRAINT "user_runtime_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "models" ADD CONSTRAINT "models_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_configs" ADD CONSTRAINT "project_configs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_tasks" ADD CONSTRAINT "media_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_tasks" ADD CONSTRAINT "media_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_tasks" ADD CONSTRAINT "media_tasks_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_tasks" ADD CONSTRAINT "media_tasks_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_tasks" ADD CONSTRAINT "media_tasks_workflow_step_id_fkey" FOREIGN KEY ("workflow_step_id") REFERENCES "workflow_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_task_events" ADD CONSTRAINT "media_task_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "media_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "media_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "novel_characters" ADD CONSTRAINT "novel_characters_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_appearances" ADD CONSTRAINT "character_appearances_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "novel_characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_appearances" ADD CONSTRAINT "character_appearances_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "novel_locations" ADD CONSTRAINT "novel_locations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "novel_locations" ADD CONSTRAINT "novel_locations_selected_image_id_fkey" FOREIGN KEY ("selected_image_id") REFERENCES "location_images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "novel_props" ADD CONSTRAINT "novel_props_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_images" ADD CONSTRAINT "location_images_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "novel_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_images" ADD CONSTRAINT "location_images_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storyboards" ADD CONSTRAINT "storyboards_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storyboards" ADD CONSTRAINT "storyboards_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storyboard_panels" ADD CONSTRAINT "storyboard_panels_storyboard_id_fkey" FOREIGN KEY ("storyboard_id") REFERENCES "storyboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storyboard_panels" ADD CONSTRAINT "storyboard_panels_clip_id_fkey" FOREIGN KEY ("clip_id") REFERENCES "story_clips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storyboard_panels" ADD CONSTRAINT "storyboard_panels_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storyboard_panels" ADD CONSTRAINT "storyboard_panels_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storyboard_panels" ADD CONSTRAINT "storyboard_panels_lip_sync_asset_id_fkey" FOREIGN KEY ("lip_sync_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_clips" ADD CONSTRAINT "story_clips_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_clips" ADD CONSTRAINT "story_clips_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_shots" ADD CONSTRAINT "story_shots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_shots" ADD CONSTRAINT "story_shots_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_shots" ADD CONSTRAINT "story_shots_clip_id_fkey" FOREIGN KEY ("clip_id") REFERENCES "story_clips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_shots" ADD CONSTRAINT "story_shots_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_shots" ADD CONSTRAINT "story_shots_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_presets" ADD CONSTRAINT "voice_presets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_presets" ADD CONSTRAINT "voice_presets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_presets" ADD CONSTRAINT "voice_presets_sample_asset_id_fkey" FOREIGN KEY ("sample_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_lines" ADD CONSTRAINT "voice_lines_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_lines" ADD CONSTRAINT "voice_lines_voice_preset_id_fkey" FOREIGN KEY ("voice_preset_id") REFERENCES "voice_presets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_lines" ADD CONSTRAINT "voice_lines_audio_asset_id_fkey" FOREIGN KEY ("audio_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_lines" ADD CONSTRAINT "voice_lines_matched_panel_id_fkey" FOREIGN KEY ("matched_panel_id") REFERENCES "storyboard_panels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_audio_tracks" ADD CONSTRAINT "episode_audio_tracks_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_audio_tracks" ADD CONSTRAINT "episode_audio_tracks_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_projects" ADD CONSTRAINT "editor_projects_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_projects" ADD CONSTRAINT "editor_projects_output_asset_id_fkey" FOREIGN KEY ("output_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_references" ADD CONSTRAINT "asset_references_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_references" ADD CONSTRAINT "asset_references_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_references" ADD CONSTRAINT "asset_references_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_deliverables" ADD CONSTRAINT "production_deliverables_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_deliverables" ADD CONSTRAINT "production_deliverables_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_deliverables" ADD CONSTRAINT "production_deliverables_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_deliverables" ADD CONSTRAINT "production_deliverables_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_deliverable_dependencies" ADD CONSTRAINT "production_deliverable_dependencies_deliverable_id_fkey" FOREIGN KEY ("deliverable_id") REFERENCES "production_deliverables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_deliverable_dependencies" ADD CONSTRAINT "production_deliverable_dependencies_depends_on_id_fkey" FOREIGN KEY ("depends_on_id") REFERENCES "production_deliverables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_approval_gates" ADD CONSTRAINT "production_approval_gates_deliverable_id_fkey" FOREIGN KEY ("deliverable_id") REFERENCES "production_deliverables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_approval_gates" ADD CONSTRAINT "production_approval_gates_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_artifacts" ADD CONSTRAINT "workflow_artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_artifacts" ADD CONSTRAINT "workflow_artifacts_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "workflow_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_asset_folders" ADD CONSTRAINT "global_asset_folders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_characters" ADD CONSTRAINT "global_characters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_characters" ADD CONSTRAINT "global_characters_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "global_asset_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_character_appearances" ADD CONSTRAINT "global_character_appearances_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "global_characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_character_appearances" ADD CONSTRAINT "global_character_appearances_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_locations" ADD CONSTRAINT "global_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_locations" ADD CONSTRAINT "global_locations_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "global_asset_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_location_images" ADD CONSTRAINT "global_location_images_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "global_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_location_images" ADD CONSTRAINT "global_location_images_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_voices" ADD CONSTRAINT "global_voices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_voices" ADD CONSTRAINT "global_voices_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "global_asset_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_balances" ADD CONSTRAINT "user_balances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_freezes" ADD CONSTRAINT "balance_freezes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_transactions" ADD CONSTRAINT "balance_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_costs" ADD CONSTRAINT "usage_costs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_costs" ADD CONSTRAINT "usage_costs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_checkpoints" ADD CONSTRAINT "workflow_checkpoints_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_step_attempts" ADD CONSTRAINT "workflow_step_attempts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_step_attempts" ADD CONSTRAINT "workflow_step_attempts_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "workflow_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
