/**
 * One-time re-hash of existing transactions to dedupe format v2
 * (date · amount · description · merchant · account — no reference number).
 *
 * Without this, transactions imported before the format change keep their old
 * hashes, so re-importing a statement wouldn't recognize them as duplicates.
 * Runs once per profile database (guarded by a Setting) at server startup.
 * Collisions — rows that were distinct only by reference number before — are
 * preserved with a uniqueness suffix so nothing is lost.
 */
import { prisma } from "../lib/prisma.js";
import { transactionHash, HASH_VERSION } from "./dedupe.js";
import { logger } from "../lib/logger.js";

const FLAG_KEY = "dedupeHashVersion";

export async function migrateTransactionHashes(): Promise<number> {
  const flag = await prisma.setting.findUnique({ where: { key: FLAG_KEY } }).catch(() => null);
  if (flag?.value === HASH_VERSION) return 0;

  const txns = await prisma.transaction.findMany({ include: { merchant: true } });
  const used = new Set<string>();
  let changed = 0;

  for (const t of txns) {
    let h = transactionHash({
      date: t.date.toISOString().slice(0, 10),
      amount: t.amount,
      description: t.description,
      merchant: t.merchant?.name ?? null,
      accountId: t.accountId,
    });
    if (used.has(h)) {
      let n = 2;
      while (used.has(`${h}:dup-${n}`)) n++;
      h = `${h}:dup-${n}`;
    }
    used.add(h);
    if (h !== t.hash) {
      try {
        await prisma.transaction.update({ where: { id: t.id }, data: { hash: h } });
      } catch (e: any) {
        if (e?.code === "P2002") {
          // Extremely rare clash with a not-yet-updated row — force uniqueness.
          await prisma.transaction.update({
            where: { id: t.id },
            data: { hash: `${h}:dup-id${t.id}` },
          });
        } else {
          throw e;
        }
      }
      changed++;
    }
  }

  await prisma.setting.upsert({
    where: { key: FLAG_KEY },
    create: { key: FLAG_KEY, value: HASH_VERSION },
    update: { value: HASH_VERSION },
  });
  if (changed > 0) logger.info("Re-hashed transactions for dedupe v2", { changed, total: txns.length });
  return changed;
}
