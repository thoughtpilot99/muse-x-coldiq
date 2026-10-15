import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      ID_DB_PATH: ":memory:",
      MODEL_API_KEY: "test-muse",
      COLDIQ_API_KEY: "test-coldiq",
      ID_JOBS_ENABLED: "0",
    },
  },
});
