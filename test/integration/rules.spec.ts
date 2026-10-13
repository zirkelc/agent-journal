import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { RULES_MARK } from '../../adapters/claude-code/hooks/names.ts';
import { GIT_IDENTITY, ROOT } from '../helpers.ts';

const QUESTION =
  'Reply with only the absolute path of the folder where you are told to write journal entries, or NONE.';

/** How long one session may take, a compaction included. */
const SESSION_TIMEOUT_MS = 240_000;

/**
 * What keeps a session to this checkout's plugin: no CLAUDE.md, memory, MCP
 * server, or user settings (with their permissions and installed plugins) of
 * the person who runs the suite. Claude Code keeps its own sign-in.
 */
const ISOLATED_ARGS = ['--setting-sources', 'project,local', '--strict-mcp-config'];
const ISOLATED_ENV = { CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };

/** The folders a run leaves: each setup's temp home, and the transcripts Claude Code filed for it. */
const leftovers = new Set<string>();

afterAll(() => {
  for (const path of leftovers) rmSync(path, { recursive: true, force: true });
});

type Setup = { home: string; work: string; journal: string; env: NodeJS.ProcessEnv };

/**
 * A config of its own pointing at a journal of its own, so a right answer can
 * only come from the rules this checkout made. The session hands the git
 * identity on to the CLI that commits.
 */
function setup(): Setup {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'agent-journal-it-')));
  leftovers.add(home);
  const work = join(home, 'work');
  const journal = join(home, 'journal');
  mkdirSync(work);
  const env = { ...process.env, ...GIT_IDENTITY, ...ISOLATED_ENV, XDG_CONFIG_HOME: join(home, 'config') };
  execFileSync(join(ROOT, 'bin', 'agent-journal'), ['config', 'set', 'journal_dir', journal], { env });
  return { home, work, journal, env };
}

type Ran = { result: string; sessionId: string; debug: string };

let runs = 0;

/** One headless session, or a resumed one, and what it answered. */
function claude(setup: Setup, prompt: string, options: { resume?: string; tools?: Array<string> } = {}): Ran {
  runs += 1;
  const debugFile = join(setup.home, `debug-${runs}.txt`);
  const args = [
    '-p',
    '--output-format',
    'json',
    '--model',
    'haiku',
    '--plugin-dir',
    ROOT,
    '--debug-file',
    debugFile,
    ...ISOLATED_ARGS,
    ...(options.resume ? ['--resume', options.resume] : []),
    ...(options.tools ? ['--allowedTools', ...options.tools] : []),
  ];
  /** On stdin, since `--allowedTools` takes every argument after it as a tool. */
  const ran = spawnSync('claude', args, {
    cwd: setup.work,
    env: setup.env,
    encoding: 'utf8',
    input: prompt,
    timeout: SESSION_TIMEOUT_MS,
  });
  if (ran.status !== 0) throw new Error(`claude exited ${ran.status}: ${ran.stderr || ran.stdout}`);
  const parsed = JSON.parse(ran.stdout) as { result?: string; session_id: string };
  const debug = existsSync(debugFile) ? readFileSync(debugFile, 'utf8') : '';
  /** The folder is named after the setup's own work directory, so it holds this suite's sessions alone. */
  leftovers.add(dirname(transcriptPath(parsed.session_id)));
  return { result: (parsed.result ?? '').trim(), sessionId: parsed.session_id, debug };
}

/** A path as a model replies with it: without quotes or backticks around it, or a slash at its end. */
const pathOf = (reply: string): string =>
  reply
    .trim()
    .replace(/^[`'"]+|[`'"]+$/g, '')
    .replace(/\/+$/, '');

/** Where Claude Code filed a session's transcript, by the directory it ran in. */
function transcriptPath(sessionId: string): string {
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
  for (const project of readdirSync(projects)) {
    const path = join(projects, project, `${sessionId}.jsonl`);
    if (existsSync(path)) return path;
  }
  throw new Error(`no transcript for ${sessionId}`);
}

function transcript(sessionId: string): Array<Record<string, unknown>> {
  return readFileSync(transcriptPath(sessionId), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * The rows that carry the rules, each by how it got there: a hidden row the mod
 * appended (`isMeta`), or context a hook added to a prompt (its attachment type).
 * A compaction summary that only mentions the rules is no such row: only the
 * mark counts.
 */
function rulesRows(sessionId: string): Array<string> {
  return transcript(sessionId)
    .filter((row) => JSON.stringify(row).includes(RULES_MARK))
    .map((row) => {
      const attachment = row.attachment as { type?: string } | undefined;
      if (attachment?.type) return attachment.type;
      return row.isMeta ? 'isMeta' : String(row.type);
    });
}

/** Whether Claude Code seated its built-in guard, which skips a person's mods on prompt.context. */
const isGuarded = (debug: string): boolean => debug.includes('cc-plugin-sec-default@builtin seated');

/** How the rules reach a session: a hidden row from prompt.context, or prompt.submit context under the guard. */
const deliveryOf = (debug: string): string => (isGuarded(debug) ? 'hook_additional_context' : 'isMeta');

/**
 * Real Claude Code sessions with this checkout as their plugin. They run in the
 * integration project only: locally with `pnpm test:integration`, and in CI
 * where a credential is set.
 */
describe('the rules in a real session', () => {
  test(
    `should reach the first prompt once, stay single on the next, and come back after a compaction`,
    () => {
      // Arrange
      const session = setup();

      // Act
      const first = claude(session, QUESTION);
      const afterFirst = rulesRows(first.sessionId);
      claude(session, 'Reply with only the word OK.', { resume: first.sessionId });
      const afterSecond = rulesRows(first.sessionId);
      claude(session, '/compact', { resume: first.sessionId });
      const compacted = claude(session, QUESTION, { resume: first.sessionId });
      const afterCompaction = rulesRows(first.sessionId);

      // Assert
      const delivery = deliveryOf(first.debug);
      expect(pathOf(first.result)).toBe(session.journal);
      expect(afterFirst).toEqual([delivery]);
      expect(afterSecond).toEqual([delivery]);
      expect(pathOf(compacted.result)).toBe(session.journal);
      expect(afterCompaction).toEqual([delivery, delivery]);
    },
    4 * SESSION_TIMEOUT_MS,
  );

  /**
   * CI runs this suite with and without managed settings, and says which it
   * set up, so a guard that does not load where it should fails here instead of
   * the suite quietly testing the other path twice.
   */
  test.skipIf(process.env.AGENT_JOURNAL_EXPECT_GUARD === undefined)(
    `should run with the guard exactly when managed settings were set up`,
    () => {
      // Arrange
      const session = setup();

      // Act
      const ran = claude(session, QUESTION);

      // Assert
      const isExpected = process.env.AGENT_JOURNAL_EXPECT_GUARD === 'true';
      expect(isGuarded(ran.debug)).toBe(isExpected);
      expect(ran.debug.includes('agent-journal: prompt.context bypassed')).toBe(isExpected);
      expect(pathOf(ran.result)).toBe(session.journal);
    },
    SESSION_TIMEOUT_MS,
  );

  test(
    `should commit and push an entry the session writes, with sync on`,
    () => {
      // Arrange
      const session = setup();
      const remote = join(session.home, 'remote.git');
      execFileSync('git', ['init', '-q', '--bare', remote]);
      execFileSync(join(ROOT, 'bin', 'agent-journal'), ['sync', 'init', remote], {
        env: session.env,
        stdio: 'ignore',
      });

      // Act
      claude(
        session,
        'Write a journal entry, following your journal instructions, with the summary "Integration test of the sync." and the body "Written by the integration test."',
        /** A rule's path starts with `//` to be absolute: one with a single `/` is relative to the project. */
        { tools: [`Edit(/${session.journal}/**)`, 'Bash(date:*)'] },
      );

      // Assert
      const subjects = execFileSync('git', ['-C', remote, 'log', '--branches', '--format=%s'], {
        encoding: 'utf8',
      });
      expect(subjects).toMatch(/^journal: \d{4}-\d{2}-\d{2}T\d{6}Z Integration test of the sync\.$/m);
    },
    SESSION_TIMEOUT_MS,
  );
});
