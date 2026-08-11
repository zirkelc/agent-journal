import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const HOOK = join(ROOT, 'adapters', 'claude-code', 'session-start.sh');

/**
 * Every case gets its own plugin root, so a test can give the core instructions
 * of its own choosing, and its own home, so nothing leaks from the real machine.
 *
 * The core finds INSTRUCTIONS.md relative to the script, so the copy is what
 * makes a custom one possible at all.
 */
export type Fixture = {
  root: string;
  bin: string;
  home: string;
  journalDir: string;
  repo: string;
};

export function fixture(instructions?: string): Fixture {
  /**
   * Canonicalised because git always answers with the real path, and on macOS
   * the temp directory reaches it through a symlink.
   */
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'agent-journal-')));
  const root = join(home, 'plugin');
  const bin = join(root, 'bin', 'agent-journal');
  const repo = join(home, 'repo');

  mkdirSync(join(root, 'bin'), { recursive: true });
  copyFileSync(join(ROOT, 'bin', 'agent-journal'), bin);
  writeFileSync(
    join(root, 'INSTRUCTIONS.md'),
    instructions ?? readFileSync(join(ROOT, 'INSTRUCTIONS.md'), 'utf8'),
  );

  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);

  /** Where the default lands once `HOME` points at the fixture. */
  return { root, bin, home, journalDir: join(home, 'agent-journal'), repo };
}

type RunOptions = {
  cwd?: string;
  /** The directory the process itself is started in, for relative-path cases. */
  at?: string;
  sessionId?: string;
  env?: Record<string, string>;
  stdin?: string;
};

function baseEnv(store: Fixture, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: store.home,
    /** Point config resolution at the fixture, so the developer's own config never leaks in. */
    XDG_CONFIG_HOME: join(store.home, 'config'),
    ...extra,
  };
}

export function run(store: Fixture, args: Array<string>, options: RunOptions = {}): string {
  return execFileSync(store.bin, args, {
    encoding: 'utf8',
    cwd: options.at,
    env: baseEnv(store, options.env),
  });
}

/** The rules as a session would receive them. */
export function context(store: Fixture, options: RunOptions = {}): string {
  const args = ['context', '--cwd', options.cwd ?? store.repo];
  if (options.sessionId !== undefined) args.push('--session-id', options.sessionId);
  return run(store, args, options);
}

function parse(out: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of out.split('\n')) {
    if (!line) continue;
    const at = line.indexOf('=');
    result[line.slice(0, at)] = line.slice(at + 1);
  }
  return result;
}

/** The effective settings, and where each came from. */
export function settings(store: Fixture, options: RunOptions = {}): Record<string, string> {
  return parse(run(store, ['config'], options));
}

/** `config set` / `config unset`, the only supported way to write a setting. */
export function configure(store: Fixture, args: Array<string>, options: RunOptions = {}): string {
  return run(store, ['config', ...args], options);
}

/**
 * The prefilled frontmatter values, as field to value.
 *
 * Matched on the shape a resolved value has, `- \`key\`: \`value\``, rather than
 * by finding the heading above it: the heading is prose and gets reworded, and a
 * test that breaks on rewording is a test of the wording. The list that describes
 * what each field means cannot collide, since a description is a sentence and
 * never a single backticked value.
 */
export function fields(rendered: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of rendered.split('\n')) {
    const match = /^- `(\w+)`: `(.+)`$/.exec(line);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

/** A path as the entries record it, which is how the fixture's home reads. */
export function tilde(store: Fixture, path: string): string {
  return path === store.home ? '~' : path.replace(`${store.home}/`, '~/');
}

/** The Claude Code adapter, run as Claude Code runs it. */
export function hook(store: Fixture, options: RunOptions = {}): Record<string, any> | null {
  const payload =
    options.stdin ??
    JSON.stringify({
      session_id: options.sessionId ?? 'abc-123',
      cwd: options.cwd ?? store.repo,
      hook_event_name: 'SessionStart',
      source: 'startup',
    });

  const out = execFileSync(HOOK, [], {
    encoding: 'utf8',
    input: payload,
    env: baseEnv(store, { CLAUDE_PLUGIN_ROOT: store.root, ...options.env }),
  });

  return out.trim() ? JSON.parse(out) : null;
}
