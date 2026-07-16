import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = path.join(os.tmpdir(), `ik-usage-${process.pid}-${Date.now()}`);
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, "profiles.json"), JSON.stringify({ active: "ikid", ids: {} }));
fs.writeFileSync(path.join(TMP, "ikid.db"), "");
process.env.IKID_DATA_DIR = TMP;

const usage = await import("../services/usageService.js");

const FILE = usage._eventsFileForTests();
beforeEach(() => { try { fs.unlinkSync(FILE); } catch { /* noop */ } });
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

function seed(events: { user: string; event: string; daysAgo: number }[]) {
  const lines = events.map((e) => JSON.stringify({
    ts: new Date(Date.now() - e.daysAgo * 86_400_000).toISOString(),
    user: e.user,
    event: e.event,
  }));
  fs.writeFileSync(FILE, lines.join("\n") + "\n");
}

describe("recordEvent", () => {
  it("appends valid events and rejects malformed keys / financial-looking junk", () => {
    usage.recordEvent("ikid", "view:retirement");
    usage.recordEvent("ikid", "action:import", "csv");
    usage.recordEvent("ikid", "bad event with spaces $4000"); // rejected
    const lines = fs.readFileSync(FILE, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0].event).toBe("view:retirement");
    expect(parsed[1].meta).toBe("csv");
    // never stores anything but ts/user/event/meta
    expect(Object.keys(parsed[1]).sort()).toEqual(["event", "meta", "ts", "user"]);
  });
});

describe("overview aggregation", () => {
  it("counts features, active users, and day buckets", () => {
    seed([
      { user: "ikid", event: "view:dashboard", daysAgo: 0 },
      { user: "ikid", event: "view:retirement", daysAgo: 0 },
      { user: "ikid", event: "view:retirement", daysAgo: 1 },
      { user: "partner", event: "view:retirement", daysAgo: 2 },
      { user: "partner", event: "view:dashboard", daysAgo: 20 },
      { user: "old", event: "view:dashboard", daysAgo: 100 },
    ]);
    const o = usage.overview(30);
    expect(o.totalEvents).toBe(6);
    // Retirement was opened 3 times
    expect(o.byFeature.find((f) => f.feature === "Retirement")?.count).toBe(3);
    // active in last 7 days: ikid + partner (partner @2d), not "old"
    expect(o.activeUsers7d).toBe(2);
    expect(o.activeUsers30d).toBe(2); // "old" is 100d out
    // 30 day buckets returned
    expect(o.byDay).toHaveLength(30);
    expect(o.byDay.at(-1)!.events).toBe(2); // today
  });

  it("labels action events distinctly and ranks top users", () => {
    seed([
      { user: "ikid", event: "action:import", daysAgo: 0 },
      { user: "ikid", event: "action:simulate", daysAgo: 0 },
      { user: "partner", event: "view:dashboard", daysAgo: 0 },
    ]);
    const o = usage.overview();
    expect(o.byFeature.some((f) => f.feature === "Import (action)")).toBe(true);
    expect(o.topUsers[0].user).toBe("ikid");
    expect(o.topUsers[0].events).toBe(2);
  });
});

describe("eventCountsByUser", () => {
  it("tallies per user with last-active", () => {
    seed([
      { user: "ikid", event: "view:dashboard", daysAgo: 3 },
      { user: "ikid", event: "view:goals", daysAgo: 1 },
    ]);
    const c = usage.eventCountsByUser();
    expect(c.ikid.count).toBe(2);
    expect(c.ikid.lastActive).not.toBeNull();
  });
});
