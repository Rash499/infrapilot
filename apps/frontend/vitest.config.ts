import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const databaseSrcDir = fileURLToPath(new URL("../../packages/database/src", import.meta.url));
const serverCoreSrcDir = fileURLToPath(new URL("../../packages/server-core/src", import.meta.url));
const contractsSrcDir = fileURLToPath(new URL("../../packages/contracts/src", import.meta.url));
const backendSrcDir = fileURLToPath(new URL("../../apps/backend/src", import.meta.url));
const workerSrcDir = fileURLToPath(new URL("../../apps/worker/src", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      { find: /^@\/validators/, replacement: `${contractsSrcDir}/validators` },
      { find: /^@\/types\/api$/, replacement: `${contractsSrcDir}/types/api.ts` },
      { find: /^@\/lib\/permissions$/, replacement: `${contractsSrcDir}/permissions.ts` },
      { find: /^@\/db\//, replacement: `${databaseSrcDir}/` },
      { find: /^@\/services\//, replacement: `${serverCoreSrcDir}/services/` },
      { find: /^@\/lib\/(client\/.*|assets-csv|format)$/, replacement: `${srcDir}/lib/$1` },
      { find: /^@\/lib\//, replacement: `${serverCoreSrcDir}/lib/` },
      { find: /^@\/controllers\//, replacement: `${backendSrcDir}/controllers/` },
      { find: /^@\/routes\//, replacement: `${backendSrcDir}/routes/` },
      { find: /^@\/workers\/probe$/, replacement: `${serverCoreSrcDir}/monitoring/probe.ts` },
      { find: /^@\/workers\//, replacement: `${workerSrcDir}/` },
      { find: /^@\//, replacement: `${srcDir}/` },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 15000,
    clearMocks: true,
  },
});
