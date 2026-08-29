/**
 * Entry point for the in-browser API.
 *
 * Importing this file registers every handler as a side effect, which is why
 * the modules are imported for effect rather than for their exports. `api.ts`
 * imports this lazily, so a normal (non-demo) build never pulls any of it in.
 */
import "./core.js";
import "./analytics.js";
import "./planning.js";
import "./stubs.js";

export { handle, DemoHttpError } from "./router.js";
export { ready, reset } from "./store.js";
