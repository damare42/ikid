/**
 * Demo-mode DTOs, shared by the Express server and the React client.
 * Dependency-free, like shared/types.ts.
 */

/**
 * The dedicated profile demo data is loaded into by default.
 *
 * It must survive `sanitizeProfileName` unchanged and pass `getDbPath`'s
 * bare-filename check — "demo" is lowercase, alphanumeric, not "." or "..",
 * and contains no separators, so it does.
 */
export const DEMO_PROFILE = "demo";

/** Settings keys that mark a profile as demo-generated. Visible in the DB. */
export const DEMO_MARKER_KEY = "demoProfile";
export const DEMO_SEED_KEY = "demoSeed";
export const DEMO_GENERATED_AT_KEY = "demoGeneratedAt";

/** The seed that ships. Same seed + same anchor date => byte-identical data. */
export const DEMO_SEED = 20260401;

export interface DemoCounts {
  accounts: number;
  transactions: number;
  merchants: number;
  budgets: number;
  goals: number;
  assets: number;
  assetSnapshots: number;
}

/** What a profile currently holds — the input to the load/reset safety guard. */
export interface DemoProfileCounts {
  transactions: number;
  accounts: number;
  assets: number;
  goals: number;
  budgets: number;
  imports: number;
}

/** What `GET /api/demo/status` returns for the *current* profile. */
export interface DemoStatusDTO {
  /** Is the profile serving this request demo data? Drives the UI banner. */
  isDemo: boolean;
  /** Name of the profile this status describes. */
  profile: string;
  seed: number | null;
  /** ISO timestamp the data was generated, or null when not a demo profile. */
  generatedAt: string | null;
  /** Inclusive date range of the generated history (YYYY-MM-DD), if demo. */
  range: { from: string; to: string } | null;
  /** Row counts for the profile serving this request (demo or not). */
  counts: DemoProfileCounts;
  /**
   * Could demo data be written into THIS profile right now? False whenever the
   * profile holds anything real — see `blockedReason` for what to do instead.
   */
  canLoadHere: boolean;
  blockedReason: string | null;
  /** Does the dedicated `demo` profile already exist on disk? */
  demoProfileExists: boolean;
  /** True when accounts are enabled, which disables profile switching. */
  authEnabled: boolean;
}

/**
 * Where to put the demo data.
 * - "demo"    — the dedicated `demo` profile (its own SQLite file). Default.
 * - "current" — the profile serving this request, only if it is empty.
 */
export type DemoTarget = "demo" | "current";

export interface DemoLoadRequest {
  target?: DemoTarget;
}

export interface DemoLoadResultDTO {
  profile: string;
  /** True when the server also made this the active profile (open mode only). */
  activated: boolean;
  seed: number;
  range: { from: string; to: string };
  counts: DemoCounts;
  /** Human-readable next step, safe to show verbatim. */
  note: string;
}
