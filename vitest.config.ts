import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { maxWorkers: 2 },
  resolve: {
    alias: {
      "@": path.resolve(process.cwd()),
    },
  },
});
