import { execFileSync } from 'node:child_process';
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ROOT } from './helpers.js';

/**
 * The manifest is only read by Claude Code, at install time, on someone else's
 * machine. Nothing here runs it, so a path that has moved or a mode that was
 * lost in a commit is invisible until an install fails. These cases are that
 * missing feedback.
 */
const MANIFEST = join(ROOT, '.claude-plugin', 'plugin.json');

function manifest(): Record<string, any> {
  return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

/** A path the manifest gives, which is relative to the plugin root. */
function resolve(path: string): string {
  return join(ROOT, path);
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

describe('the plugin manifest', () => {
  test(`should be valid JSON with the fields a marketplace lists it by`, () => {
    // Arrange, Act
    const plugin = manifest();

    // Assert
    expect(plugin.name).toBe('agent-journal');
    expect(typeof plugin.version).toBe('string');
    expect(typeof plugin.description).toBe('string');
    expect(plugin.license).toBe('MIT');
  });

  test(`should point at files that exist`, () => {
    // Arrange
    const plugin = manifest();

    // Act
    const paths = [plugin.hooks, ...(plugin.commands ?? [])];

    // Assert
    expect(paths.length).toBe(2);
    for (const path of paths) {
      expect(statSync(resolve(path)).isFile()).toBe(true);
    }
  });

  test(`should describe every command it ships`, () => {
    // Arrange
    const plugin = manifest();

    // Assert
    for (const path of plugin.commands ?? []) {
      const front = readFileSync(resolve(path), 'utf8');
      expect(front.startsWith('---\n')).toBe(true);
      expect(front).toMatch(/^description: \S/m);
    }
  });
});

describe('the hooks it registers', () => {
  test(`should name a script that exists and can be run`, () => {
    // Arrange
    const hooks = JSON.parse(readFileSync(resolve(manifest().hooks), 'utf8'));

    // Act
    const commands = Object.values<Array<any>>(hooks.hooks)
      .flat()
      .flatMap((matcher) => matcher.hooks)
      .map((hook) => hook.command);

    // Assert
    expect(commands.length).toBe(1);
    for (const command of commands) {
      /** The only variable Claude Code substitutes, and the only one a path may use. */
      expect(command.startsWith('${CLAUDE_PLUGIN_ROOT}/')).toBe(true);

      const script = join(ROOT, command.replace('${CLAUDE_PLUGIN_ROOT}/', ''));
      expect(statSync(script).isFile()).toBe(true);
      expect(isExecutable(script)).toBe(true);
    }
  });

  test(`should fire on the events that begin a context`, () => {
    // Arrange
    const hooks = JSON.parse(readFileSync(resolve(manifest().hooks), 'utf8'));

    // Act
    const sessionStart = hooks.hooks.SessionStart;

    // Assert
    expect(Object.keys(hooks.hooks).length).toBe(1);
    expect(sessionStart.length).toBe(1);
    /**
     * `resume` is deliberately absent: a resumed session still carries the
     * instruction it was given, so injecting it again would only spend context.
     */
    expect(sessionStart[0].matcher).toBe('startup|clear|compact');
  });
});

describe('the core the plugin ships', () => {
  test(`should be executable, since the hook runs it directly`, () => {
    // Assert
    expect(isExecutable(join(ROOT, 'bin', 'agent-journal'))).toBe(true);
    expect(isExecutable(join(ROOT, 'install.sh'))).toBe(true);
  });

  test(`should be accepted by Claude Code itself`, (context) => {
    // Arrange, Act
    let output: string;
    try {
      output = execFileSync('claude', ['plugin', 'validate', ROOT], { encoding: 'utf8' });
    } catch (error: any) {
      /** Not installed, which is the normal state in CI. The cases above are what run there. */
      if (error.code === 'ENOENT') return context.skip();
      throw error;
    }

    // Assert
    expect(output.toLowerCase()).not.toContain('error');
  });
});
