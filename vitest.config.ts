import { defineConfig } from 'vitest/config';

/**
 * The CLI's tests. The journal pane's tests under mods/ run in Claude Code's own test kit.
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
          include: ['test/**/*.spec.ts'],
          exclude: ['test/integration/**'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.spec.ts'],
        },
      },
    ],
  },
});
