-- Preserve existing usage rows; allow standalone model requests and fractional duration units.
ALTER TABLE "usage_costs" ALTER COLUMN "project_id" DROP NOT NULL;
ALTER TABLE "usage_costs" ALTER COLUMN "quantity" TYPE DECIMAL(18,6) USING "quantity"::DECIMAL(18,6);
