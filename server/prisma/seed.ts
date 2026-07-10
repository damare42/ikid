/**
 * CLI seed: initializes the default profile with categories, rules, and
 * settings. No sample transactions — all data comes from your imports.
 * Run `npm run db:reset --prefix server` to wipe and re-seed.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { seedDefaults } from "../src/services/seedDefaults.js";

// Standalone-run fallback (setup.ts normally provides this)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.IKID_DATABASE_URL ??=
  "file:" +
  path.join(
    process.env.IKID_DATA_DIR ?? path.resolve(__dirname, "../../database"),
    "ikid.db",
  );

const prisma = new PrismaClient();

async function main() {
  const result = await seedDefaults(prisma);
  if (result.categories === 0) {
    console.log("Database already initialized — skipping seed.");
  } else {
    console.log(
      `Seeded ${result.categories} categories and ${result.rules} rules. ` +
        "Import a statement (top-left Import button) to get started.",
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
