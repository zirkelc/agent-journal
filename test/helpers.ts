import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Git reads these to decide which repository it is in, ahead of the directory it
 * is given. A test run started by a git hook inherits them, and every git call
 * here, in the tests and in the CLI under test, would then act on the
 * developer's own repository. Removed once, for every test file.
 */
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) {
  delete process.env[key];
}

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * The session-start adapter the shell tests drive. Claude Code takes the rules
 * through its hooks module instead, so the shell path is Codex's, and with it
 * everything the adapters share in `common.sh`.
 */
export const HOOK = join(ROOT, 'adapters', 'codex', 'session-start.sh');

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

  /**
   * The adapters and the `install` command are reached from the plugin root, so
   * a fixture that omits them is a fixture where those paths silently do
   * nothing. They are copied rather than symlinked so a case is free to replace
   * one.
   */
  mkdirSync(join(root, 'adapters'), { recursive: true });
  copyFileSync(join(ROOT, 'adapters', 'common.sh'), join(root, 'adapters', 'common.sh'));
  mkdirSync(join(root, 'lib'), { recursive: true });
  copyFileSync(join(ROOT, 'lib', 'install.sh'), join(root, 'lib', 'install.sh'));
  mkdirSync(join(root, 'templates'), { recursive: true });
  writeFileSync(
    join(root, 'templates', 'INSTRUCTIONS.md'),
    instructions ?? readFileSync(join(ROOT, 'templates', 'INSTRUCTIONS.md'), 'utf8'),
  );
  copyFileSync(join(ROOT, 'templates', 'RECALL.md'), join(root, 'templates', 'RECALL.md'));

  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);

  /** Where the default lands once `HOME` points at the fixture. */
  return { root, bin, home, journalDir: join(home, 'agent-journal'), repo };
}

/**
 * A linked worktree of the fixture repository, on a branch of its own. It needs
 * a commit to branch from, so an empty one is made first, which also lets a test
 * call this more than once.
 */
export function worktree(store: Fixture, name: string): string {
  const git = (...args: Array<string>) =>
    execFileSync('git', ['-C', store.repo, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    });
  git('commit', '-q', '--allow-empty', '-m', 'seed');
  const tree = join(store.home, name);
  git('worktree', 'add', '-q', '-b', name, tree);
  return tree;
}

type RunOptions = {
  cwd?: string;
  /** The directory the process itself is started in, for relative-path cases. */
  at?: string;
  sessionId?: string;
  env?: Record<string, string | undefined>;
  stdin?: string;
};

function baseEnv(store: Fixture, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    /**
     * Filters take local days, so a case that does not name a zone runs in UTC
     * rather than in whatever zone the machine running the tests is in.
     */
    TZ: 'UTC',
    HOME: store.home,
    /**
     * Stops git looking above the fixture, so a temp directory inside some
     * checkout still counts as outside a repository.
     */
    GIT_CEILING_DIRECTORIES: store.home,
    /** Point config resolution at the fixture, so the developer's own config never leaks in. */
    XDG_CONFIG_HOME: join(store.home, 'config'),
    ...extra,
  };
  /** A key given as `undefined` is removed, so a case can run without it. */
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  return env;
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

/**
 * A run with a terminal on its standard streams, for the layout a person sees.
 * `script` provides the pseudo-terminal, and BSD (macOS) and util-linux take
 * its arguments in a different order. The terminal turns newlines into CRLF and
 * BSD echoes the end of input as `^D`, so both are removed.
 *
 * The pseudo-terminal has no size of its own, so `stty` gives it one, which is
 * where the CLI reads the width from. `COLUMNS` is removed, because it would
 * win over that size, and `TERM` is fixed, because a CI runner may have none.
 */
export function terminal(
  store: Fixture,
  args: Array<string>,
  options: RunOptions & { stdoutTo?: string; cols?: number } = {},
): string {
  const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
  let command = `stty cols ${options.cols ?? 200}; ${[store.bin, ...args].map(quote).join(' ')}`;
  if (options.stdoutTo) command += ` > ${quote(options.stdoutTo)}`;

  const argv =
    process.platform === 'darwin' ? ['-q', '/dev/null', 'sh', '-c', command] : ['-qec', command, '/dev/null'];

  /** Not checked for status, because a refusal is laid out like anything else. */
  const result = spawnSync('script', argv, {
    encoding: 'utf8',
    cwd: options.at,
    env: { ...baseEnv(store, { TERM: 'xterm', ...options.env }), COLUMNS: options.env?.COLUMNS },
    /** BSD `script` refuses a socket on stdin, which is what a pipe is here. */
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return result.stdout.replace(/^\^D\x08\x08/, '').replaceAll('\r', '');
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
 * Down a pipe, which is how the tests run it, the columns are separated by one
 * tab each. An entry with no project leaves that field empty, which is the point
 * of testing it at all. A line with no tab is a message rather than an entry and
 * is skipped, but a line with the wrong number of fields is a broken entry, so
 * it throws rather than disappearing from the count.
 */
export function rows(out: string): Array<{ id: string; project: string; summary: string }> {
  const result: Array<{ id: string; project: string; summary: string }> = [];

  for (const line of out.split('\n')) {
    if (!line.includes('\t')) continue;
    const fields = line.split('\t');
    if (fields.length !== 3) throw new Error(`expected 3 fields, got ${fields.length}: ${JSON.stringify(line)}`);
    result.push({ id: fields[0], project: fields[1], summary: fields[2] });
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

/** The text a reader of the journal is given, `context --recall`. */
export function recall(store: Fixture, options: RunOptions = {}): string {
  const args = ['context', '--recall', '--cwd', options.cwd ?? store.repo];
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

/** The Codex adapter, run as Codex runs it. */
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
    cwd: options.at,
    input: payload,
    env: baseEnv(store, { PLUGIN_ROOT: store.root, ...options.env }),
  });

  return out.trim() ? JSON.parse(out) : null;
}
