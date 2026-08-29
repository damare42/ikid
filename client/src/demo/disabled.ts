/**
 * What `@demo` resolves to in a normal build.
 *
 * The demo's in-browser API pulls in the data generator, the pure engines and
 * a node:crypto shim — none of which belong in the app people actually install.
 * Relying on dead-code elimination to drop them turned out to be wishful:
 * Vite left the dynamic import reachable and the normal build failed trying to
 * bundle node:crypto. So exclusion is done by resolution instead, which either
 * works or fails loudly at build time.
 *
 * Nothing should ever call this: `api.ts` only reaches for it when the demo
 * flag is set, and when the flag is set this file isn't what gets resolved.
 */

export class DemoHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const wrongBuild = (): never => {
  throw new Error(
    "The in-browser demo API isn't part of this build. Build with VITE_IKID_DEMO=1 (npm run build:demo) to include it.",
  );
};

export const handle = wrongBuild as (method: string, url: string, body: unknown) => Promise<unknown>;
export const ready = wrongBuild as () => Promise<void>;
export const reset = wrongBuild as () => Promise<void>;
