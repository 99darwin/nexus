import { defineConfig } from "vitest/config";

// node environment only — the chat and feed logic is deliberately
// framework-free so it is testable without a dom shim
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
