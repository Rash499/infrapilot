import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const rootSrcDir = fileURLToPath(new URL("../../src", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      { find: /^@\/validators/, replacement: `${rootSrcDir}/validators` },
      { find: /^@\/db$/, replacement: `${rootSrcDir}/db` },
      { find: /^@\/(db|services|controllers|routes|workers)\//, replacement: `${rootSrcDir}/$1/` },
      { find: /^@\/(lib\/(auth|env|http|logger|mailer|permissions|security|ssrf|load-env))/, replacement: `${rootSrcDir}/$1` },
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
