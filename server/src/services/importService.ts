/**
 * File-import pipeline: parse CSV/PDF -> preview rows (with suggested
 * categories + duplicate flags) -> commit corrected rows to the database.
 */
import Papa from "papaparse";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { transactionRepo, merchantRepo, ruleRepo, importRepo, categoryRepo } from "../repositories/index.js";
import { categorize, extractMerchant, isTransferDescription } from "./categorization.js";
import { transactionHash } from "./dedupe.js";
import { detectColumns, parsePdfText, rowFromCsv, type RawRow } from "./parsers.js";
import { TRANSFER_KEYWORDS } from "./defaults.js";
import type { ImportPreview, ParsedRow } from "../../../shared/types.js";

async function toPreviewRows(raw: RawRow[], accountId: number | null): Promise<ParsedRow[]> {
  const rules = await ruleRepo.all();
  const hashes = raw
    .filter((r) => r.problems.length === 0)
    .map((r) => transactionHash({ date: r.date, amount: r.amount, description: r.description, refNumber: r.refNumber, accountId }));
  const existing = new Set((await transactionRepo.findByHashes(hashes)).map((t) => t.hash));

  // also flag duplicates within the same file
  const seenInFile = new Set<string>();

  return raw.map((r) => {
    const valid = r.problems.length === 0;
    let duplicate = false;
    if (valid) {
      const h = transactionHash({ date: r.date, amount: r.amount, description: r.description, refNumber: r.refNumber, accountId });
      duplicate = existing.has(h) || seenInFile.has(h);
      seenInFile.add(h);
    }
    const matched = valid ? categorize(r.description, rules) : null;
    const matchedCat = matched ? rules.find((x) => x.id === matched.id)?.category : null;
    return {
      date: r.date,
      description: r.description,
      amount: r.amount,
      balance: r.balance,
      type: r.type,
      refNumber: r.refNumber,
      merchant: valid ? extractMerchant(r.description) : "",
      suggestedCategoryId: matchedCat?.id ?? null,
      suggestedCategoryName: matchedCat?.name ?? null,
      duplicate,
      valid,
      problems: r.problems,
    };
  });
}

export async function previewCsv(
  filename: string,
  content: string,
  accountId: number | null,
): Promise<ImportPreview> {
  const parsed = Papa.parse<Record<string, any>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (!parsed.meta.fields || parsed.meta.fields.length < 2) {
    throw new ApiError(400, "Could not read CSV headers. Is the file a valid CSV export?");
  }
  const cols = detectColumns(parsed.meta.fields);
  if (!cols.date || (!cols.amount && !cols.debit && !cols.credit)) {
    throw new ApiError(
      400,
      `Could not detect required columns. Found headers: ${parsed.meta.fields.join(", ")}. Need at least a date column and an amount (or debit/credit) column.`,
    );
  }
  const raw = parsed.data.map((rec) => rowFromCsv(rec, cols));
  const rows = await toPreviewRows(raw, accountId);
  return {
    fileType: "csv",
    filename,
    detectedColumns: cols,
    rows,
    totalRows: rows.length,
    duplicates: rows.filter((r) => r.duplicate).length,
  };
}

export async function previewPdf(
  filename: string,
  buffer: Buffer,
  accountId: number | null,
): Promise<ImportPreview> {
  // pdf-parse is CJS; import lazily to keep startup fast.
  const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
  let text: string;
  try {
    const result = await pdfParse(buffer);
    text = result.text;
  } catch (e) {
    logger.error("PDF parse failed", { message: (e as Error).message });
    throw new ApiError(400, "Could not read this PDF. It may be scanned/image-only.");
  }
  const raw = parsePdfText(text);
  if (raw.length === 0) {
    throw new ApiError(
      400,
      "No transactions found in this PDF. Ikid looks for lines like 'MM/DD DESCRIPTION $AMOUNT'. Try the CSV export from your bank instead.",
    );
  }
  const rows = await toPreviewRows(raw, accountId);
  return {
    fileType: "pdf",
    filename,
    detectedColumns: { date: "auto", description: "auto", amount: "auto", balance: "auto" },
    rows,
    totalRows: rows.length,
    duplicates: rows.filter((r) => r.duplicate).length,
  };
}

export interface CommitRow {
  date: string;
  description: string;
  amount: number;
  balance?: number | null;
  refNumber?: string | null;
  merchant?: string;
  categoryId?: number | null;
  skip?: boolean;
  /** True when the user manually chose this category — saves a learned rule. */
  learn?: boolean;
}

export async function commitImport(
  filename: string,
  fileType: string,
  rows: CommitRow[],
  accountId: number | null,
) {
  const unknown = await categoryRepo.byName("Unknown");
  const categories = await categoryRepo.all();
  const transferCatIds = new Set(categories.filter((c) => c.type === "transfer").map((c) => c.id));
  const imp = await importRepo.create({ filename, fileType, accountId });

  let created = 0;
  let duplicates = 0;
  for (const r of rows) {
    if (r.skip) continue;
    const hash = transactionHash({
      date: r.date, amount: r.amount, description: r.description,
      refNumber: r.refNumber, accountId,
    });
    const merchantName = r.merchant?.trim() || extractMerchant(r.description);
    const merchant = await merchantRepo.upsertByName(merchantName);

    // Learn from manual corrections made in the review screen.
    if (r.learn && r.categoryId) {
      await ruleRepo.create({
        keyword: merchantName.toUpperCase(),
        categoryId: r.categoryId,
        priority: 5,
        source: "learned",
      });
    }
    try {
      await prisma.transaction.create({
        data: {
          date: new Date(r.date),
          description: r.description,
          amount: r.amount,
          balance: r.balance ?? null,
          type: r.amount >= 0 ? "credit" : "debit",
          refNumber: r.refNumber ?? null,
          hash,
          isTransfer:
            isTransferDescription(r.description, TRANSFER_KEYWORDS) ||
            (r.categoryId != null && transferCatIds.has(r.categoryId)),
          categoryId: r.categoryId ?? unknown?.id ?? null,
          merchantId: merchant.id,
          accountId,
          importId: imp.id,
        },
      });
      created++;
    } catch (e: any) {
      if (e?.code === "P2002") duplicates++; // unique hash violation
      else throw e;
    }
  }
  await importRepo.finish(imp.id, created, duplicates);
  logger.info("Import committed", { filename, created, duplicates });
  return { importId: imp.id, created, duplicates };
}
