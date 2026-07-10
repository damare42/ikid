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
  logger.error("Unhandled error", { message: (err as Error)?.message });
  res.status(500).json({ error: "Internal server error" });
}
