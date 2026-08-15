/**
 * Error-handler contract. These are the failures a real user hits on a fresh
 * clone, a bad copy of node_modules, or a broken data volume — each must
 * produce an actionable 503, not a bare "Internal server error".
 */
import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { ApiError, errorHandler } from "../lib/errors.js";

/** Minimal Response double capturing status + json payload. */
function mockRes() {
  const out: { status: number; body: any } = { status: 0, body: null };
  const res = {
    status(code: number) { out.status = code; return this; },
    json(body: any) { out.body = body; return this; },
  } as unknown as Response;
  return { res, out };
}

const req = {} as Request;
const next = vi.fn();

describe("errorHandler", () => {
  it("passes ApiError through with its own status and message", () => {
    const { res, out } = mockRes();
    errorHandler(new ApiError(404, "Account not found"), req, res, next);
    expect(out.status).toBe(404);
    expect(out.body.error).toBe("Account not found");
  });

  it("explains an ungenerated Prisma client (fresh clone)", () => {
    const { res, out } = mockRes();
    const err = new Error('@prisma/client did not initialize yet. Please run "prisma generate"');
    errorHandler(err, req, res, next);
    expect(out.status).toBe(503);
    expect(out.body.error).toMatch(/db:setup|npm run dev/);
  });

  it("explains an unusable engine binary (wrong platform / partial copy)", () => {
    const { res, out } = mockRes();
    const err = new Error(
      "Unable to require libquery_engine.so.node. The Prisma engines do not seem to be compatible with your system.",
    );
    errorHandler(err, req, res, next);
    expect(out.status).toBe(503);
    expect(out.body.error).toMatch(/npm install/);
  });

  it("explains an unreachable database file", () => {
    const { res, out } = mockRes();
    const err = Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
    errorHandler(err, req, res, next);
    expect(out.status).toBe(503);
    expect(out.body.error).toMatch(/data folder|IKID_DATA_DIR/);
  });

  it("explains schema drift after an upgrade (P2021)", () => {
    const { res, out } = mockRes();
    const err = Object.assign(new Error("table does not exist"), { code: "P2021" });
    errorHandler(err, req, res, next);
    expect(out.status).toBe(503);
    expect(out.body.error).toMatch(/out of date|restart/i);
  });

  it("still hides genuinely unexpected errors behind a generic 500", () => {
    const { res, out } = mockRes();
    // Must not leak internals (stack traces, file paths, secrets) to the client.
    errorHandler(new Error("connect ECONNREFUSED 10.0.0.5:5432 secret-token=abc"), req, res, next);
    expect(out.status).toBe(500);
    expect(out.body.error).toBe("Internal server error");
    expect(JSON.stringify(out.body)).not.toMatch(/secret-token/);
  });
});
