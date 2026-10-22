import { execFileSync } from 'node:child_process';
import { accessSync, constants, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  /** The plugin folder. An install copies this folder alone, so every path in the manifest is relative to it. */
  dir: string;
  manifest: string;
} & (
  | {
      /** The agent runs a shell command at session start. */
      kind: 'command';
      /** The only variable that agent substitutes, and so the only one a path may use. */
      rootVar: string;
      /**
       * Whether the hook command wraps the path in double quotes, so a plugin root
       * with a space in it stays one word when the shell runs it.
       */
      quoted: boolean;
    }
  | {
      /** The agent loads a hooks module, which runs inside it and needs no command. */
      kind: 'module';
    }
);

const AGENTS: Array<Agent> = [
  {
    name: 'Claude Code',
    dir: 'claude-code',
    manifest: join('claude-code', '.claude-plugin', 'plugin.json'),
    kind: 'module',
  },
  {
    name: 'Codex',
    dir: 'codex',
    manifest: join('codex', '.codex-plugin', 'plugin.json'),
    kind: 'command',
    rootVar: 'PLUGIN_ROOT',
    quoted: false,
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

/**
 * Claude Code takes an update only when the version string changes, so the
 * manifests and the package must name the same one, or a release reaches one
 * agent and not the other.
 */
test(`should give every manifest and the package the same version`, () => {
  // Arrange
  const versions = [...AGENTS.map((agent) => read(agent.manifest).version), read('package.json').version];

  // Act
  const distinct = new Set(versions);

  // Assert
  expect(distinct.size).toBe(1);
});

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
    expect(statSync(join(ROOT, agent.dir, plugin.hooks)).isFile()).toBe(true);
    /**
     * The settings are one `config set` away and every agent has a shell, so
     * neither plugin carries a command for it. A skill comes back when there is
     * something worth a skill.
     */
    expect(plugin.commands).toBeUndefined();
    expect(plugin.skills).toBeUndefined();
  });
});

const COMMAND_AGENTS = AGENTS.flatMap((agent) => (agent.kind === 'command' ? [agent] : []));

describe.each(COMMAND_AGENTS)('the $name hook command', (agent) => {
  test(`should name a hook script that exists and can be run`, () => {
    // Arrange
    const hooks = read(join(agent.dir, read(agent.manifest).hooks));

    // Act
    const commands = Object.values<Array<any>>(hooks.hooks)
      .flat()
      .flatMap((matcher) => matcher.hooks)
      .map((hook) => hook.command);

    // Assert
    expect(commands.length).toBe(1);
    const quote = agent.quoted ? '"' : '';
    const prefix = `${quote}\${${agent.rootVar}}/`;
    for (const command of commands) {
      expect(command.startsWith(prefix)).toBe(true);
      expect(command.endsWith(quote)).toBe(true);

      const script = join(ROOT, agent.dir, command.slice(prefix.length, command.length - quote.length));
      expect(statSync(script).isFile()).toBe(true);
      expect(isExecutable(script)).toBe(true);
    }
  });

  test(`should fire on the events that begin a context`, () => {
    // Arrange
    const hooks = read(join(agent.dir, read(agent.manifest).hooks));

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

/**
 * The files at the root that each plugin folder carries a copy of, and where the
 * copy goes. The CLI goes to `scripts/`, because Claude Code puts a plugin's
 * `bin/` on the Bash tool's `PATH`, and claude.ai and Cowork refuse to install a
 * plugin that has one.
 */
const SHARED: Array<{ source: string; copy: string }> = [
  { source: 'bin', copy: 'scripts' },
  { source: 'templates', copy: 'templates' },
  { source: 'LICENSE', copy: 'LICENSE' },
];

/** Every file under `item` in `dir`, relative to `item`, or `''` when `item` is a file. */
function filesUnder(dir: string, item: string): Array<string> {
  const path = join(ROOT, dir, item);
  if (!statSync(path, { throwIfNoEntry: false })) return [];
  if (statSync(path).isFile()) return [''];
  return readdirSync(path, { recursive: true, encoding: 'utf8' }).filter((entry) =>
    statSync(join(path, entry)).isFile(),
  );
}

/** Each shared file at the root, with the path of its copy in `dir`. */
function sharedPairs(dir: string): Array<{ source: string; copy: string }> {
  return SHARED.flatMap((item) =>
    filesUnder('.', item.source).map((rest) => ({
      source: join(item.source, rest),
      copy: join(dir, item.copy, rest),
    })),
  );
}

/**
 * An install copies only the plugin folder, so each one carries the shared core.
 * The pre-commit hook makes the copies, and these cases catch a commit made
 * without it.
 */
describe.each(AGENTS)('the shared core in the $name plugin', (agent) => {
  test(`should hold a copy of each shared file and nothing else`, () => {
    // Arrange
    const expected = sharedPairs(agent.dir)
      .map((pair) => pair.copy)
      .sort();

    // Act
    const copied = SHARED.flatMap((item) =>
      filesUnder(agent.dir, item.copy).map((rest) => join(agent.dir, item.copy, rest)),
    ).sort();

    // Assert
    expect(copied).toEqual(expected);
  });

  test(`should hold the same content and modes as the root`, () => {
    // Arrange
    const pairs = sharedPairs(agent.dir);

    // Act
    const differ = pairs.filter((pair) => {
      const source = join(ROOT, pair.source);
      const copy = join(ROOT, pair.copy);
      return !readFileSync(copy).equals(readFileSync(source)) || isExecutable(copy) !== isExecutable(source);
    });

    // Assert
    expect(differ).toEqual([]);
  });

  test(`should have no bin folder`, () => {
    // Act
    const bin = statSync(join(ROOT, agent.dir, 'bin'), { throwIfNoEntry: false });

    // Assert
    expect(bin).toBeUndefined();
  });
});

describe('the Claude Code hooks module', () => {
  /**
   * Claude Code runs the plugin as one hooks module: it puts the rules into each
   * conversation's context itself, so there is no shell command to run at
   * session start, and the journal pane lives in the same module.
   */
  test(`should load one module and no command hook`, () => {
    // Arrange
    const plugin = read(join('claude-code', '.claude-plugin', 'plugin.json'));
    const hooks = read(join('claude-code', plugin.hooks));

    // Act
    const modules: Array<string> = hooks.modules;

    // Assert
    expect(hooks.hooks).toBeUndefined();
    expect(modules.length).toBe(1);
    expect(statSync(join(ROOT, 'claude-code', dirname(plugin.hooks), modules[0]!)).isFile()).toBe(true);
    expect(statSync(join(ROOT, 'claude-code', plugin.types)).isFile()).toBe(true);
  });
});

describe('the Codex marketplace', () => {
  test(`should offer the Codex plugin folder as the plugin it holds`, () => {
    // Arrange, Act
    const market = read(join('.agents', 'plugins', 'marketplace.json'));

    // Assert
    expect(market.name).toBe('zirkelc');
    expect(market.plugins.length).toBe(1);
    const [entry] = market.plugins;
    expect(entry.name).toBe('agent-journal');
    /** The folder that holds `.codex-plugin/plugin.json`. */
    expect(entry.source).toEqual({ source: 'local', path: './codex' });
  });
});

describe('the Codex adapter', () => {
  test(`should name itself and the session`, () => {
    // Arrange, Act
    const out = execFileSync(join(ROOT, 'codex', 'session-start.sh'), {
      encoding: 'utf8',
      input: JSON.stringify({ session_id: 'shared-1', cwd: ROOT, source: 'startup' }),
      env: { ...process.env, PLUGIN_ROOT: join(ROOT, 'codex') },
    });
    const rendered = JSON.parse(out).hookSpecificOutput;

    // Assert
    expect(rendered.hookEventName).toBe('SessionStart');
    expect(rendered.additionalContext).toContain('`agent`: `codex`');
    expect(rendered.additionalContext).toContain('shared-1');
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
      output = execFileSync('claude', ['plugin', 'validate', join(ROOT, 'claude-code')], { encoding: 'utf8' });
    } catch (error: any) {
      /** Not installed, which is the normal state in CI. The cases above are what run there. */
      if (error.code === 'ENOENT') return context.skip();
      throw error;
    }

    // Assert
    expect(output.toLowerCase()).not.toContain('error');
  });
});
