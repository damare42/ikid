import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { logger } from "./logger.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Wrap async route handlers so rejections reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

/** Validate and parse a payload with zod, converting failures to 400s. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  try {
    return schema.parse(data);
  } catch (e) {
    if (e instanceof ZodError) {
      const detail = e.errors.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new ApiError(400, `Validation failed — ${detail}`);
    }
    throw e;
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const message = (err as Error)?.message ?? "";
  const code = (err as { code?: string })?.code;
  // Schema drift after an upgrade: missing table/column (P2021/P2022) or a
  // stale generated client (prisma.<newModel> is undefined → TypeError).
  if (
    code === "P2021" ||
    code === "P2022" ||
    (err instanceof TypeError && /reading '(findMany|findUnique|create|update|delete|aggregate|count)/.test(message))
  ) {
    logger.error("Database schema out of date", { message, code });
    res.status(503).json({
      error: "Database schema is out of date — stop and restart the app (npm run dev) to apply the update.",
    });
    return;
  }
  // Database client never generated (fresh clone, interrupted install, or a
  // node_modules wipe). Without this the user just sees "Internal server
  // error" and has no idea the fix is a one-liner.
  if (/did not initialize yet|@prisma\/client.*initialize/i.test(message)) {
    logger.error("Prisma client not generated", { message });
    res.status(503).json({
      error:
        "The database client hasn't been generated yet. Stop the server and run `npm run db:setup` (or just `npm run dev`, which does it for you).",
    });
    return;
  }

  // Engine binary missing or built for the wrong platform — common after
  // copying node_modules between machines or architectures.
  if (/query engine|engines do not seem to be compatible|file too short/i.test(message)) {
    logger.error("Prisma engine unusable", { message });
    res.status(503).json({
      error:
        "The database engine isn't usable on this machine. Reinstall dependencies: `rm -rf node_modules && npm install`, then `npm run db:setup`.",
    });
    return;
  }

  // Data directory missing or unwritable (bad IKID_DATA_DIR, unmounted volume).
  if (code === "ENOENT" || code === "EACCES" || /unable to open the database file/i.test(message)) {
    logger.error("Database file unreachable", { message, code });
    res.status(503).json({
      error:
        "Can't reach the database file. Check the data folder exists and is writable (IKID_DATA_DIR), then restart.",
    });
    return;
  }

  logger.error("Unhandled error", { message });
  res.status(500).json({ error: "Internal server error" });
}
