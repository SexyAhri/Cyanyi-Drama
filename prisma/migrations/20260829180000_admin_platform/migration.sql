-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ChannelScope" AS ENUM ('USER', 'SYSTEM');

-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "scope" "ChannelScope" NOT NULL DEFAULT 'SYSTEM';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "external_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "provider_user_id" VARCHAR(191) NOT NULL,
    "username" TEXT,
    "profile_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_flows" (
    "id" TEXT NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "intent" VARCHAR(32) NOT NULL DEFAULT 'login',
    "redirect_path" VARCHAR(512) NOT NULL DEFAULT '/chat',
    "anonymous_user_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'global',
    "registration_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_auth_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_verification_enabled" BOOLEAN NOT NULL DEFAULT false,
    "smtp_host" TEXT,
    "smtp_port" INTEGER NOT NULL DEFAULT 465,
    "smtp_secure" BOOLEAN NOT NULL DEFAULT true,
    "smtp_username" TEXT,
    "smtp_password_encrypted" TEXT,
    "smtp_from" TEXT,
    "github_enabled" BOOLEAN NOT NULL DEFAULT false,
    "github_client_id" TEXT,
    "github_client_secret_encrypted" TEXT,
    "linuxdo_enabled" BOOLEAN NOT NULL DEFAULT false,
    "linuxdo_client_id" TEXT,
    "linuxdo_client_secret_encrypted" TEXT,
    "linuxdo_minimum_trust_level" INTEGER NOT NULL DEFAULT 0,
    "epay_enabled" BOOLEAN NOT NULL DEFAULT false,
    "epay_gateway_url" TEXT,
    "epay_merchant_id" TEXT,
    "epay_merchant_key_encrypted" TEXT,
    "epay_methods" JSONB,
    "epay_minimum_amount" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "epay_credit_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "trade_no" VARCHAR(64) NOT NULL,
    "provider" VARCHAR(32) NOT NULL DEFAULT 'epay',
    "payment_method" VARCHAR(32) NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "credit_amount" DECIMAL(18,6) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "provider_trade_no" VARCHAR(191),
    "notify_payload" JSONB,
    "expires_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_identities_user_id_idx" ON "external_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_identities_provider_provider_user_id_key" ON "external_identities"("provider", "provider_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_identities_user_id_provider_key" ON "external_identities"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "auth_flows_token_hash_key" ON "auth_flows"("token_hash");

-- CreateIndex
CREATE INDEX "auth_flows_provider_expires_at_idx" ON "auth_flows"("provider", "expires_at");

-- CreateIndex
CREATE INDEX "auth_flows_expires_at_consumed_at_idx" ON "auth_flows"("expires_at", "consumed_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_trade_no_key" ON "payment_orders"("trade_no");

-- CreateIndex
CREATE INDEX "payment_orders_user_id_created_at_idx" ON "payment_orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_orders_status_created_at_idx" ON "payment_orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "channels_scope_enabled_idx" ON "channels"("scope", "enabled");

-- AddForeignKey
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Promote the development owner and expose the existing shared providers as
-- system channels. The application still enforces administrator-only writes.
UPDATE "users" SET "role" = 'ADMIN' WHERE "email" = 'admin@example.com';
UPDATE "channels" SET "scope" = 'SYSTEM', "enabled" = true;

INSERT INTO "system_settings" ("id", "updated_at")
VALUES ('global', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
