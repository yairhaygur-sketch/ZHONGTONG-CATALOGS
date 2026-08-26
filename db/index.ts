import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * The D1 handle for the current request.
 *
 * The binding is read from the global the worker sets per request rather than
 * from `cloudflare:workers`; that module has no Node implementation and a static
 * import of it fails the prerender step of `vinext build`.
 */
export function getDb() {
  const database = globalThis.__ZT_SITE_ENV__?.DB;
  if (!database) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(database, { schema });
}
