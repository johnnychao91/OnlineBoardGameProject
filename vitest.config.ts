import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  include: ['src/**/*.test.ts'],
  // Integration files each run real servers and durable JSON writes. Avoid
  // competing for the deployment host's CPU and disk while its service is live.
  // Concurrent rooms and socket operations inside each test still run together.
  fileParallelism: false,
  testTimeout: 15000,
} });
