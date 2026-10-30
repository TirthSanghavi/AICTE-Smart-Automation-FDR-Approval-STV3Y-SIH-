import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Hard-guard every vitest invocation (including direct `npx vitest run`)
    // onto the test database so fixtures can never wipe the demo DB.
    env: {
      DATABASE_URL: "file:./test.db",
      FILE_STORE_PATH: ".data/test-uploads",
      DEMO_MODE: "true",
      TEST_CLOCK_ENABLED: "true",
    },
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
