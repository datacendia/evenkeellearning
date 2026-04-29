// ─────────────────────────────────────────────────────────────────────────────
// vitest.config.ts
//
// Unit-test configuration. We use the `happy-dom` environment so SubtleCrypto
// and BroadcastChannel-style globals can be polyfilled, and so React hooks
// can be tested without spinning up a real browser.
//
// Tests live in `tests/unit/` and use the `*.test.ts(x)` extension.
// Coverage is generated via the V8 provider; thresholds are deliberately
// modest at this stage and tightened in `vitest.critical.config.ts` once
// targeted areas reach 80%+.
// ─────────────────────────────────────────────────────────────────────────────

import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    globals: false,
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.d.ts", "lib/**/index.ts"],
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 40,
        statements: 50,
      },
    },
  },
});
