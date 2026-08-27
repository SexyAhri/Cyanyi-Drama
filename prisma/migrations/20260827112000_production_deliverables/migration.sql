-- M8.1 versioned production deliverables, dependencies, and approval gates.
CREATE TABLE `production_deliverables` (
  `id` VARCHAR(191) NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `project_id` VARCHAR(191) NOT NULL,
  `episode_id` VARCHAR(191) NULL,
  `scope_type` VARCHAR(32) NOT NULL,
  `scope_id` VARCHAR(191) NOT NULL,
  `department` VARCHAR(64) NOT NULL,
  `deliverable_type` VARCHAR(96) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `version` INTEGER NOT NULL DEFAULT 1,
  `payload` JSON NOT NULL,
  `source_refs` JSON NULL,
  `prompt_trace` JSON NULL,
  `cost` DECIMAL(18, 6) NOT NULL DEFAULT 0,
  `dependency_hash` VARCHAR(191) NOT NULL,
  `approved_by_user_id` VARCHAR(191) NULL,
  `submitted_at` DATETIME(3) NULL,
  `approved_at` DATETIME(3) NULL,
  `locked_at` DATETIME(3) NULL,
  `superseded_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `production_deliverables_scope_version_key` (`project_id`, `scope_type`, `scope_id`, `deliverable_type`, `version`),
  INDEX `production_deliverables_user_id_updated_at_idx` (`user_id`, `updated_at`),
  INDEX `production_deliverables_project_department_status_idx` (`project_id`, `department`, `status`),
  INDEX `production_deliverables_episode_id_updated_at_idx` (`episode_id`, `updated_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `production_deliverable_dependencies` (
  `id` VARCHAR(191) NOT NULL,
  `deliverable_id` VARCHAR(191) NOT NULL,
  `depends_on_id` VARCHAR(191) NOT NULL,
  `required_version` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `production_deliverable_dependencies_pair_key` (`deliverable_id`, `depends_on_id`),
  INDEX `production_deliverable_dependencies_depends_on_id_idx` (`depends_on_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `production_approval_gates` (
  `id` VARCHAR(191) NOT NULL,
  `deliverable_id` VARCHAR(191) NOT NULL,
  `gate_key` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `decided_by_user_id` VARCHAR(191) NULL,
  `note` TEXT NULL,
  `decided_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `production_approval_gates_deliverable_gate_key` (`deliverable_id`, `gate_key`),
  INDEX `production_approval_gates_status_updated_at_idx` (`status`, `updated_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `production_deliverables`
  ADD CONSTRAINT `production_deliverables_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `production_deliverables_project_id_fkey`
    FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `production_deliverables_episode_id_fkey`
    FOREIGN KEY (`episode_id`) REFERENCES `episodes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `production_deliverable_dependencies`
  ADD CONSTRAINT `production_deliverable_dependencies_deliverable_id_fkey`
    FOREIGN KEY (`deliverable_id`) REFERENCES `production_deliverables` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `production_deliverable_dependencies_depends_on_id_fkey`
    FOREIGN KEY (`depends_on_id`) REFERENCES `production_deliverables` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `production_approval_gates`
  ADD CONSTRAINT `production_approval_gates_deliverable_id_fkey`
    FOREIGN KEY (`deliverable_id`) REFERENCES `production_deliverables` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
