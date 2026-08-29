/**
 * The parts that genuinely cannot work in a web page, answered honestly.
 *
 * The rule here: never fake success, and never fail silently. A visitor who
 * clicks "Backup database" should be told why nothing happened, because the
 * reason — there is no server and no database file — is the product's central
 * claim, not an apology.
 */
import { DemoHttpError, route } from "./router.js";
import { db, reset } from "./store.js";
import { allTxns } from "./data.js";

const CANNOT = (what: string, why: string) => () => {
  throw new DemoHttpError(400, `${what} isn't available in the demo — ${why} Install ikid and it works normally.`);
};

// ---------- auth: the demo is deliberately signed out of nothing ----------

route("GET /api/auth/status", () => ({
  enabled: false,
  current: "demo",
  signedIn: true,
  isAdmin: false,
  allowSignups: false,
  profiles: [{ name: "demo", protected: false }],
}));

route("POST /api/auth/login", CANNOT("Signing in", "there are no accounts here; the demo is a single sample profile."));
route("POST /api/auth/signup", CANNOT("Creating an account", "accounts live on your own machine."));
route("POST /api/auth/logout", () => ({ ok: true }));
route("POST /api/auth/set-password", CANNOT("Setting a password", "there is no server here to hold one."));
route("POST /api/auth/remove-password", CANNOT("Changing the password", "there is no server here to hold one."));

// ---------- profiles ----------

route("GET /api/profiles", () => ({
  active: "demo",
  profiles: [{ name: "demo", id: "demo0000", active: true, size: 0 }],
}));
route("POST /api/profiles", CANNOT("Creating a profile", "each profile is a separate database file on your computer."));
route("POST /api/profiles/rename", CANNOT("Renaming", "the demo profile is regenerated on every reload."));
route("POST /api/profiles/activate", CANNOT("Switching profiles", "the demo only has one."));

// ---------- admin / analytics collection ----------

route("GET /api/admin/overview", () => {
  throw new DemoHttpError(403, "The admin area belongs to whoever runs the install. There's nobody to administer here.");
});
route("GET /api/admin/users", () => {
  throw new DemoHttpError(403, "No accounts exist in the demo.");
});
route("GET /api/admin/config", () => ({ allowSignups: false }));
// Usage tracking is a local file on a real install; here it goes nowhere,
// which is the correct behaviour rather than a stub.
route("POST /api/track", () => ({ ok: true }));

// ---------- database file operations ----------

route("POST /api/settings/backup", CANNOT("Backing up", "there is no database file in a web page."));
route("GET /api/settings/backups", () => []);
route("POST /api/settings/restore", CANNOT("Restoring", "there is no database file in a web page."));
route("POST /api/settings/restore-upload", CANNOT("Restoring", "there is no database file in a web page."));

/**
 * The JSON export is the one data operation that *should* work — it proves the
 * no-lock-in claim, and everything it needs is already in memory.
 */
route("GET /api/settings/export.json", () => ({
  format: "ikid-export",
  version: 1,
  exportedAt: new Date().toISOString(),
  profile: "demo",
  note: "Generated sample data from the ikid demo — not anybody's real finances.",
  counts: { transactions: allTxns().length, accounts: db().account.length },
  data: {
    accounts: db().account.map((a) => ({ name: a.name, type: a.type, currency: a.currency ?? "USD" })),
    categories: db().category.map((c) => ({ name: c.name, type: c.type, color: c.color })),
    merchants: db().merchant.map((m) => ({ name: m.name })),
    transactions: allTxns().map((t) => ({
      date: String(t.date instanceof Date ? t.date.toISOString().slice(0, 10) : t.date).slice(0, 10),
      description: t.description,
      amount: t.amount,
      hash: t.hash,
      isTransfer: Boolean(t.isTransfer),
      cleared: Boolean(t.cleared),
    })),
  },
}));

route("POST /api/settings/import.json", CANNOT("Importing", "the demo regenerates itself on reload, so an import wouldn't survive."));

// ---------- statement import ----------

route("POST /api/imports/preview", CANNOT(
  "Importing a statement",
  "the demo is pre-filled with two years of generated history so you can see the result without uploading anything.",
));
route("POST /api/imports/commit", CANNOT("Importing a statement", "the demo comes pre-filled."));

// ---------- demo self-management ----------

route("GET /api/demo/status", () => ({
  isDemo: true,
  profile: "demo",
  seed: 20260101,
  generatedAt: new Date().toISOString(),
  range: null,
  authEnabled: false,
  canLoadHere: false,
  blockedReason: "You're already in the demo.",
  counts: { transactions: allTxns().length },
}));

route("POST /api/demo/reset", async () => {
  await reset();
  return { ok: true, counts: { transactions: allTxns().length } };
});

route("POST /api/demo/load", () => {
  throw new DemoHttpError(400, "You're already in the demo.");
});
