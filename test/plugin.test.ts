import { execFileSync } from 'node:child_process';
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ROOT } from './helpers.js';

/**
 * A manifest is only read by its agent, at install time, on someone else's
 * machine. Nothing here runs it, so a path that has moved or a mode that was
 * lost in a commit is invisible until an install fails. These cases are that
 * missing feedback.
 */
type Agent = {
  name: string;
  manifest: string;
  /** The only variable that agent substitutes, and so the only one a path may use. */
  rootVar: string;
};

const AGENTS: Array<Agent> = [
  {
    name: 'Claude Code',
    manifest: join('.claude-plugin', 'plugin.json'),
    rootVar: 'CLAUDE_PLUGIN_ROOT',
  },
  {
    name: 'Codex',
    manifest: join('.codex-plugin', 'plugin.json'),
    rootVar: 'PLUGIN_ROOT',
  },
];

function read(path: string): Record<string, any> {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

describe.each(AGENTS)('the $name plugin', (agent) => {
  test(`should be valid JSON with the fields a marketplace lists it by`, () => {
    // Arrange, Act
    const plugin = read(agent.manifest);

    // Assert
    expect(plugin.name).toBe('agent-journal');
    expect(typeof plugin.version).toBe('string');
    expect(typeof plugin.description).toBe('string');
    expect(plugin.license).toBe('MIT');
  });

  test(`should ship a hook and nothing else`, () => {
    // Arrange
    const plugin = read(agent.manifest);

    // Assert
    expect(statSync(join(ROOT, plugin.hooks)).isFile()).toBe(true);
    /**
     * The settings are one `config set` away and every agent has a shell, so
     * neither plugin carries a command for it. A skill comes back when there is
     * something worth a skill.
     */
    expect(plugin.commands).toBeUndefined();
    expect(plugin.skills).toBeUndefined();
  });

  test(`should name a hook script that exists and can be run`, () => {
    // Arrange
    const hooks = read(read(agent.manifest).hooks);

    // Act
    const commands = Object.values<Array<any>>(hooks.hooks)
      .flat()
      .flatMap((matcher) => matcher.hooks)
      .map((hook) => hook.command);

    // Assert
    expect(commands.length).toBe(1);
    for (const command of commands) {
      expect(command.startsWith(`\${${agent.rootVar}}/`)).toBe(true);

      const script = join(ROOT, command.replace(`\${${agent.rootVar}}/`, ''));
      expect(statSync(script).isFile()).toBe(true);
      expect(isExecutable(script)).toBe(true);
    }
  });

  test(`should fire on the events that begin a context`, () => {
    // Arrange
    const hooks = read(read(agent.manifest).hooks);

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

describe('the Codex marketplace', () => {
  test(`should offer this repository as the plugin it holds`, () => {
    // Arrange, Act
    const market = read(join('.agents', 'plugins', 'marketplace.json'));

    // Assert
    expect(market.name).toBe('zirkelc');
    expect(market.plugins.length).toBe(1);
    const [entry] = market.plugins;
    expect(entry.name).toBe('agent-journal');
    /** The repository root, which is where `.codex-plugin/plugin.json` is. */
    expect(entry.source).toEqual({ source: 'local', path: './' });
  });
});

describe('the two adapters', () => {
  function deliver(directory: string): string {
    return execFileSync(join(ROOT, 'adapters', directory, 'session-start.sh'), {
      encoding: 'utf8',
      input: JSON.stringify({ session_id: 'shared-1', cwd: ROOT, source: 'startup' }),
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, PLUGIN_ROOT: ROOT },
    });
  }

  /**
   * They share `common.sh`, so the same payload has to come out the same apart
   * from the one thing each is meant to answer differently. Comparing the rest
   * is what stops one drifting when the other is fixed.
   */
  test(`should encode the same session identically but for the agent it names`, () => {
    // Arrange
    const claude = deliver('claude-code');
    const codex = deliver('codex');

    // Act
    const withoutAgent = (rendered: string) => rendered.replaceAll(/agent`?: `?\w+/g, 'agent: X');

    // Assert
    expect(withoutAgent(claude)).toBe(withoutAgent(codex));
    expect(claude).not.toBe(codex);
  });

  test(`should each name themselves`, () => {
    // Arrange, Act
    const rendered = (out: string) => JSON.parse(out).hookSpecificOutput;

    // Assert
    expect(rendered(deliver('claude-code')).hookEventName).toBe('SessionStart');
    expect(rendered(deliver('claude-code')).additionalContext).toContain('`agent`: `claude`');
    expect(rendered(deliver('codex')).additionalContext).toContain('`agent`: `codex`');
    expect(rendered(deliver('codex')).additionalContext).toContain('shared-1');
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
