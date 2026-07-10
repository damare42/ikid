/**
 * Seeds a database with the essentials: default categories, categorization
 * rules, and settings. Used by both `prisma/seed.ts` (CLI) and profile
 * creation at runtime. Skips when categories already exist.
 */
import type { PrismaClient } from "@prisma/client";
import { DEFAULT_CATEGORIES, DEFAULT_RULES } from "./defaults.js";

export async function seedDefaults(client: PrismaClient): Promise<{ categories: number; rules: number }> {
  const existing = await client.category.count();
  if (existing > 0) return { categories: 0, rules: 0 };

  for (const c of DEFAULT_CATEGORIES) {
    await client.category.upsert({ where: { name: c.name }, update: {}, create: c });
  }
  const categories = await client.category.findMany();
  const catByName = new Map(categories.map((c) => [c.name, c]));

  let rules = 0;
  for (const [keyword, catName] of DEFAULT_RULES) {
    const cat = catByName.get(catName);
    if (!cat) continue;
    await client.rule.upsert({
      where: { keyword_categoryId: { keyword, categoryId: cat.id } },
      update: {},
      create: { keyword, categoryId: cat.id, source: "default" },
    });
    rules++;
  }

  await client.setting.createMany({
    data: [
      { key: "currency", value: "USD" },
      { key: "dateFormat", value: "MM/DD/YYYY" },
      { key: "theme", value: "system" },
    ],
  });

  return { categories: categories.length, rules };
}
