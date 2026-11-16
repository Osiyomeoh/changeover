import { defineConfig } from 'vitest/config';

// Unit tests cover pure models only, so they run without the IWSDK Vite plugin
// (which would try to start or attach to the dev runtime).
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
