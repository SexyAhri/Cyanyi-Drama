-- CreateTable
CREATE TABLE `model_prices` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `capability` VARCHAR(191) NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `unit_price` DECIMAL(18, 6) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `model_prices_provider_model_active_idx`(`provider`, `model`, `active`),
    UNIQUE INDEX `model_prices_provider_model_capability_unit_key`(`provider`, `model`, `capability`, `unit`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
