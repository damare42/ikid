import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parse, ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import {
  buildProfile, runScenario, statsAnswer, ollamaChat, ollamaStatus, fallbackReply,
} from "../services/plannerService.js";
import { parseWindowMonths } from "../services/scenarios.js";

export const plannerRouter = Router();

plannerRouter.get(
  "/status",
  asyncHandler(async (_req, res) => {
    const [profile, ollama] = await Promise.all([buildProfile(), ollamaStatus()]);
    res.json({ profile, ollama });
  }),
);

// ---------- saved conversations ----------

/** Convert "table missing" Prisma errors into an actionable message. */
function friendlyDbError(e: unknown): never {
  const msg = (e as any)?.message ?? "";
  if ((e as any)?.code === "P2021" || /does not exist/i.test(msg)) {
    throw new ApiError(
      500,
      "The conversations table doesn't exist in this database yet. Stop the app and run `npm run dev` again — the schema updates automatically on startup.",
    );
  }
  throw e as Error;
}

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  title: z.string().nullable().optional(),
  source: z.string().optional(),
  chart: z.any().nullable().optional(),
});

plannerRouter.get(
  "/conversations",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.conversation
      .findMany({ orderBy: { updatedAt: "desc" } })
      .catch(friendlyDbError);
    res.json(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        updatedAt: r.updatedAt,
        messageCount: (() => {
          try {
            return JSON.parse(r.messages).length;
          } catch {
            return 0;
          }
        })(),
      })),
    );
  }),
);

plannerRouter.get(
  "/conversations/:id",
  asyncHandler(async (req, res) => {
    const row = await prisma.conversation.findUnique({ where: { id: Number(req.params.id) } });
    if (!row) throw new ApiError(404, "Conversation not found");
    res.json({ id: row.id, title: row.title, messages: JSON.parse(row.messages) });
  }),
);

plannerRouter.post(
  "/conversations",
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({ title: z.string().min(1).max(120), messages: z.array(messageSchema).min(1) }),
      req.body,
    );
    const row = await prisma.conversation
      .create({ data: { title: body.title, messages: JSON.stringify(body.messages) } })
      .catch(friendlyDbError);
    res.json({ id: row.id, title: row.title });
  }),
);

plannerRouter.patch(
  "/conversations/:id",
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({ title: z.string().min(1).max(120).optional(), messages: z.array(messageSchema).optional() }),
      req.body,
    );
    const row = await prisma.conversation
      .update({
        where: { id: Number(req.params.id) },
        data: {
          ...(body.title && { title: body.title }),
          ...(body.messages && { messages: JSON.stringify(body.messages) }),
        },
      })
      .catch(friendlyDbError);
    res.json({ id: row.id, title: row.title });
  }),
);

plannerRouter.delete(
  "/conversations/:id",
  asyncHandler(async (req, res) => {
    await prisma.conversation.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  }),
);

const chatSchema = z.object({
  message: z.string().min(1),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .default([]),
});

plannerRouter.post(
  "/chat",
  asyncHandler(async (req, res) => {
    const body = parse(chatSchema, req.body);
    // Respect an explicit averaging window ("use the last six months…").
    const windowMonths = parseWindowMonths(body.message) ?? 12;
    const profile = await buildProfile(windowMonths);

    // 0) Plain data questions get real totals straight from the database.
    const stats = await statsAnswer(body.message);
    if (stats) {
      res.json({
        source: "engine",
        title: stats.title,
        reply: stats.lines.join("\n"),
        lines: stats.lines,
        chart: null,
      });
      return;
    }

    // 1) Deterministic engine — exact math, returned immediately.
    //    (No LLM round-trip here: engine answers must stay instant.)
    const scenario = runScenario(profile, body.message);
    if (scenario) {
      res.json({
        source: "engine",
        title: scenario.title,
        reply: scenario.lines.join("\n"),
        lines: scenario.lines,
        chart: scenario.chart ?? null,
      });
      return;
    }

    // 2) Freeform questions only: local LLM (slower, but nothing else can answer).
    const history = [...body.history, { role: "user" as const, content: body.message }];
    const llmReply = await ollamaChat(history, profile, null);
    if (llmReply) {
      res.json({ source: "ollama", title: null, reply: llmReply, lines: [], chart: null });
      return;
    }
    const status = await ollamaStatus();
    res.json({
      source: "fallback",
      title: null,
      reply: fallbackReply(profile, status.reason),
      lines: [],
      chart: null,
    });
  }),
);
