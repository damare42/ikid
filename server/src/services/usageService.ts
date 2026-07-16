/**
 * Usage analytics — local, privacy-preserving product telemetry.
 *
 * Records feature EVENTS only: which page was opened, which action was run,
 * and by which account, with a timestamp. It NEVER records financial data —
 * no amounts, merchants, categories, balances, or transaction contents. This
 * is the "how is the app used / how many users" layer an owner needs to plan
 * a public launch, without betraying the local-first promise (see
 * docs/GO-PUBLIC.md).
 *
 * Storage is an append-only JSON-lines file in the data dir. Appends are
 * cheap and crash-safe; aggregation reads the tail. A hosted version would
 * swap this file for an events table — the interface stays the same.
 */
import fs from "node:fs";
import path from "node:path";
import { DB_DIR } from "../lib/prisma.js";
import { listAccounts } from "./accountService.js";

const EVENTS_FILE = path.join(DB_DIR, "analytics.jsonl");
const EVENT_RE = /^[a-z0-9:._-]{1,48}$/;
const MAX_SCAN = 200_000; // keep aggregation bounded on huge logs

export interface UsageEvent {
  ts: string; // ISO
  user: string;
  event: string; // e.g. "view:retirement", "action:import"
  meta?: string; // tiny, non-financial label (e.g. calc kind)
}

/** Append one event. Never throws — telemetry must not break a request. */
export function recordEvent(user: string, event: string, meta?: string): void {
  try {
    if (!EVENT_RE.test(event)) return;
    const row: UsageEvent = {
      ts: new Date().toISOString(),
      user: user.slice(0, 40),
      event,
      ...(meta ? { meta: String(meta).slice(0, 40) } : {}),
    };
    fs.mkdirSync(DB_DIR, { recursive: true });
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(row) + "\n");
  } catch {
    /* swallow — analytics is best-effort */
  }
}

function readEvents(): UsageEvent[] {
  let raw: string;
  try {
    raw = fs.readFileSync(EVENTS_FILE, "utf-8");
  } catch {
    return [];
  }
  const lines = raw.split("\n").filter(Boolean);
  const slice = lines.length > MAX_SCAN ? lines.slice(-MAX_SCAN) : lines;
  const out: UsageEvent[] = [];
  for (const l of slice) {
    try {
      const e = JSON.parse(l);
      if (e && typeof e.ts === "string" && typeof e.event === "string") out.push(e);
    } catch {
      /* skip a corrupt line */
    }
  }
  return out;
}

const dayKey = (iso: string) => iso.slice(0, 10);

export interface UsageOverview {
  totalUsers: number;
  admins: number;
  disabled: number;
  newUsers7d: number;
  activeUsers7d: number;
  activeUsers30d: number;
  totalEvents: number;
  events7d: number;
  byFeature: { feature: string; count: number }[];
  byDay: { day: string; events: number; users: number }[];
  topUsers: { user: string; events: number; lastActive: string | null }[];
}

/** Pretty-print an event key for the dashboard ("view:retirement" → "Retirement"). */
export function featureLabel(event: string): string {
  const [kind, name = ""] = event.split(":");
  const nice = name.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || kind;
  if (kind === "view") return nice;
  if (kind === "action") return `${nice} (action)`;
  return event;
}

export function overview(days = 30): UsageOverview {
  const events = readEvents();
  const accounts = listAccounts();
  const now = Date.now();
  const DAY = 86_400_000;
  const since7 = now - 7 * DAY;
  const since30 = now - 30 * DAY;

  const featureCounts = new Map<string, number>();
  const perUser = new Map<string, { events: number; last: number }>();
  const dayMap = new Map<string, { events: number; users: Set<string> }>();
  const active7 = new Set<string>();
  const active30 = new Set<string>();
  let events7 = 0;

  for (const e of events) {
    const t = Date.parse(e.ts);
    featureCounts.set(e.event, (featureCounts.get(e.event) ?? 0) + 1);
    const pu = perUser.get(e.user) ?? { events: 0, last: 0 };
    pu.events++;
    pu.last = Math.max(pu.last, t);
    perUser.set(e.user, pu);
    const dk = dayKey(e.ts);
    const d = dayMap.get(dk) ?? { events: 0, users: new Set() };
    d.events++;
    d.users.add(e.user);
    dayMap.set(dk, d);
    if (t >= since7) { active7.add(e.user); events7++; }
    if (t >= since30) active30.add(e.user);
  }

  const newUsers7d = accounts.filter((a) => Date.parse(a.createdAt) >= since7).length;

  // Trailing `days` window of day buckets (fill gaps with zero).
  const byDay: UsageOverview["byDay"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * DAY);
    const key = d.toISOString().slice(0, 10);
    const hit = dayMap.get(key);
    byDay.push({ day: key, events: hit?.events ?? 0, users: hit?.users.size ?? 0 });
  }

  const byFeature = [...featureCounts.entries()]
    .map(([event, count]) => ({ feature: featureLabel(event), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const topUsers = [...perUser.entries()]
    .map(([user, v]) => ({ user, events: v.events, lastActive: v.last ? new Date(v.last).toISOString() : null }))
    .sort((a, b) => b.events - a.events)
    .slice(0, 10);

  return {
    totalUsers: accounts.length,
    admins: accounts.filter((a) => a.role === "admin").length,
    disabled: accounts.filter((a) => a.disabled).length,
    newUsers7d,
    activeUsers7d: active7.size,
    activeUsers30d: active30.size,
    totalEvents: events.length,
    events7d: events7,
    byFeature,
    byDay,
    topUsers,
  };
}

/** Per-user event counts for the admin user table. */
export function eventCountsByUser(): Record<string, { count: number; lastActive: string | null }> {
  const out: Record<string, { count: number; lastActive: string | null }> = {};
  for (const e of readEvents()) {
    const cur = out[e.user] ?? { count: 0, lastActive: null };
    cur.count++;
    if (!cur.lastActive || e.ts > cur.lastActive) cur.lastActive = e.ts;
    out[e.user] = cur;
  }
  return out;
}

export function _eventsFileForTests(): string {
  return EVENTS_FILE;
}
