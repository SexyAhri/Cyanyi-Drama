import { prisma } from "@/lib/server/prisma";

const PRESERVED_TABLES = new Set([
  "_prisma_migrations",
  "channels",
  "models",
  "users",
]);

async function main() {
  const execute = process.argv.includes("--execute");
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, displayName: true },
  });
  if (!admins.length) throw new Error("RESET_ABORTED_NO_ADMIN_ACCOUNT");

  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;
  const resetTables = tables
    .map(({ tablename }) => tablename)
    .filter((table) => !PRESERVED_TABLES.has(table));

  console.log(
    JSON.stringify(
      {
        mode: execute ? "execute" : "preview",
        preservedAdmins: admins,
        preservedTables: [...PRESERVED_TABLES].sort(),
        resetTables,
      },
      null,
      2,
    ),
  );
  if (!execute) {
    console.log("Preview only. Re-run with --execute to reset business data.");
    return;
  }

  const primaryAdminId = admins[0].id;
  await prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`
        UPDATE "channels" AS channel
        SET "user_id" = ${primaryAdminId}
        WHERE NOT EXISTS (
          SELECT 1
          FROM "users" AS owner
          WHERE owner."id" = channel."user_id"
            AND owner."role" = 'ADMIN'::"UserRole"
        )
      `;

      if (resetTables.length) {
        const tableList = resetTables.map(quoteIdentifier).join(", ");
        await transaction.$executeRawUnsafe(
          `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`,
        );
      }

      await transaction.user.deleteMany({ where: { role: { not: "ADMIN" } } });
    },
    { timeout: 120_000 },
  );

  const [adminCount, channelCount, modelCount] = await Promise.all([
    prisma.user.count({ where: { role: "ADMIN" } }),
    prisma.channel.count(),
    prisma.providerModel.count(),
  ]);
  console.log(
    JSON.stringify(
      { complete: true, adminCount, channelCount, modelCount },
      null,
      2,
    ),
  );
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
