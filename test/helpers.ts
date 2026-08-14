import { execFileSync, spawnSync } from 'node:child_process';
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
    input: options.stdin ?? '',
  });
}

/** Both streams, for a run that says something without failing. */
export function output(
  store: Fixture,
  args: Array<string>,
  options: RunOptions = {},
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(store.bin, args, {
    encoding: 'utf8',
    cwd: options.at,
    env: baseEnv(store, options.env),
    input: options.stdin ?? '',
  });

  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

/** A run that is expected to be refused, with the reason it gave. */
export function fails(
  store: Fixture,
  args: Array<string>,
  options: RunOptions = {},
): { status: number; stderr: string } {
  try {
    /** Captured rather than inherited, so a refusal under test is not noise in the run. */
    execFileSync(store.bin, args, {
      encoding: 'utf8',
      cwd: options.at,
      env: baseEnv(store, options.env),
      input: options.stdin ?? '',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error: any) {
    return { status: error.status, stderr: String(error.stderr ?? '') };
  }
  throw new Error(`expected \`${args.join(' ')}\` to fail`);
}

export type Entry = {
  /** The filename without `.md`, which is also the instant the entry records. */
  stem: string;
  project?: string;
  summary: string;
  cwd?: string;
  body?: string;
};

/** Entries on disk, as a session would have left them. */
export function seed(store: Fixture, entries: Array<Entry>): void {
  mkdirSync(store.journalDir, { recursive: true });

  for (const entry of entries) {
    const date = `${entry.stem.slice(0, 11)}${entry.stem.slice(11, 13)}:${entry.stem.slice(13, 15)}:${entry.stem.slice(15, 17)}Z`;
    const front = [
      '---',
      `date: ${date}`,
      ...(entry.project ? [`project: ${entry.project}`] : []),
      `summary: "${entry.summary}"`,
      ...(entry.cwd ? [`cwd: ${entry.cwd}`] : []),
      '---',
      '',
      entry.body ?? '',
      '',
    ];
    writeFileSync(join(store.journalDir, `${entry.stem}.md`), front.join('\n'));
  }
}

/**
 * The columns of one listed entry.
 *
 * The project column is padded to the widest name being printed, so the split is
 * on the run of spaces between the columns rather than on a fixed offset. An
 * entry with no project leaves that group empty, which is the point of testing
 * it at all.
 */
export function rows(out: string): Array<{ when: string; project: string; summary: string }> {
  const result: Array<{ when: string; project: string; summary: string }> = [];

  for (const line of out.split('\n')) {
    if (!line) continue;
    const match = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})  (.*?)\s{2,}(.*)$/.exec(line);
    if (match) result.push({ when: match[1], project: match[2], summary: match[3] });
  }

  return result;
}

/** The frontmatter of a written entry, as field to value. */
export function frontmatter(entry: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of entry.split('\n').slice(1)) {
    if (line === '---') break;
    const at = line.indexOf(': ');
    if (at === -1) continue;
    let value = line.slice(at + 2);
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    result[line.slice(0, at)] = value;
  }

  return result;
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
