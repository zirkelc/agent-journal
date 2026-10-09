import { defineConfig } from 'vitest/config';

/** The CLI's tests. The journal pane's tests under mods/ run in Claude Code's own test kit. */
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
  },
});
