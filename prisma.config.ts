import "dotenv/config";
import { defineConfig } from "prisma/config";

const defaultDatabaseUrl = "postgresql://cyanyi:cyanyi@localhost:5432/cyanyi";
process.env.DATABASE_URL ??= defaultDatabaseUrl;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url:
      process.env.DATABASE_URL,
  },
});
