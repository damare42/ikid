import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { asyncHandler, parse, ApiError } from "../lib/errors.js";
import { importRepo } from "../repositories/index.js";
import { prisma } from "../lib/prisma.js";
import { previewCsv, previewPdf, commitImport } from "../services/importService.js";

export const importsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

importsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await importRepo.all());
  }),
);

/** Step 1: upload a file, get back parsed rows for review/correction. */
importsRouter.post(
  "/preview",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, "No file uploaded (field name: file)");
    const accountId = req.body.accountId ? Number(req.body.accountId) : null;
    const name = req.file.originalname;
    const lower = name.toLowerCase();
    if (lower.endsWith(".csv") || req.file.mimetype === "text/csv") {
      res.json(await previewCsv(name, req.file.buffer.toString("utf-8"), accountId));
    } else if (lower.endsWith(".pdf") || req.file.mimetype === "application/pdf") {
      res.json(await previewPdf(name, req.file.buffer, accountId));
    } else {
      throw new ApiError(400, `Unsupported file type: ${name}. Upload a .csv or .pdf statement.`);
    }
  }),
);

const commitSchema = z.object({
  filename: z.string(),
  fileType: z.string(),
  accountId: z.number().nullable().optional(),
  rows: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      description: z.string().min(1),
      amount: z.number(),
      balance: z.number().nullable().optional(),
      refNumber: z.string().nullable().optional(),
      merchant: z.string().optional(),
      categoryId: z.number().nullable().optional(),
      skip: z.boolean().optional(),
      learn: z.boolean().optional(),
      force: z.boolean().optional(),
    }),
  ),
});

/** Step 2: commit the (possibly corrected) rows. */
importsRouter.post(
  "/commit",
  asyncHandler(async (req, res) => {
    const body = parse(commitSchema, req.body);
    const result = await commitImport(body.filename, body.fileType, body.rows, body.accountId ?? null);
    res.json(result);
  }),
);

/** Rename an import's file label (cosmetic — doesn't touch transactions). */
importsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ filename: z.string().trim().min(1).max(200) }), req.body);
    res.json(await importRepo.rename(Number(req.params.id), body.filename));
  }),
);

/** Assign all of an import's transactions to an account (null = unassign). */
importsRouter.post(
  "/:id/assign-account",
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ accountId: z.number().nullable() }), req.body);
    if (body.accountId != null) {
      const account = await prisma.account.findUnique({ where: { id: body.accountId } });
      if (!account) throw new ApiError(404, "Account not found");
    }
    const updated = await importRepo.assignAccount(Number(req.params.id), body.accountId);
    res.json({ updated });
  }),
);

/** Undo an import and all transactions it created. */
importsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await importRepo.undo(Number(req.params.id));
    res.json({ ok: true });
  }),
);
