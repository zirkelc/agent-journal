import { defineConfig } from 'vitest/config';

/**
 * The CLI's tests. The Claude Code plugin's tests under claude-code/ run in Claude Code's own test kit.
 *
 * `unit` runs the CLI in temp folders and is fast and free. `integration` runs real Claude Code
 * sessions, which cost model usage and take seconds each, so it runs only when asked for by name.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          globalSetup: ['test/setup.ts'],
          include: ['test/**/*.spec.ts'],
          exclude: ['test/integration/**'],
        },
      },
      {
        /**
         * The spec imports a constant from the mod, whose tsconfig extends one
         * that Claude Code writes when it loads the mod, so a fresh checkout has
         * none. A tsconfig given as a string keeps Vite from looking one up.
         */
        esbuild: { tsconfigRaw: '{}' },
        test: {
          name: 'integration',
          globalSetup: ['test/setup.ts'],
          include: ['test/integration/**/*.spec.ts'],
        },
      },
    ],
  },
});
