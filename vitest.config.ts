import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts", "hooks/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    pool: "threads",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
