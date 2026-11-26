import { config } from "dotenv";
import path from "node:path";

/**
 * Loads local configuration for scripts that run outside Next.js (the seed and the smoke test),
 * which otherwise would not see any `.env*` file.
 *
 * `.env.local` is read first so it overrides `.env`, and variables already present in the real
 * environment always win, exactly as on the Next.js server. Import this module before anything that
 * reads `process.env` at import time, for example `@/db`.
 */
for (const file of [".env.local", ".env"]) {
  config({ path: path.resolve(__dirname, `../../${file}`), quiet: true });
}
