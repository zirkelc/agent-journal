import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GIT_IDENTITY, ROOT, tempDir } from '../helpers.ts';

/** How long one session may take, a compaction included. */
export const SESSION_TIMEOUT_MS = 240_000;

/**
 * What keeps a session to this checkout's plugin: no CLAUDE.md, memory, MCP
 * server, or user settings (with their permissions and installed plugins) of
 * the person who runs the suite. Claude Code keeps its own sign-in.
 */
export const ISOLATED_ARGS = ['--setting-sources', 'project,local', '--strict-mcp-config'];
export const ISOLATED_ENV = { CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };

/** The folders a run leaves: each setup's temp home, and the transcripts Claude Code filed for it. */
export const leftovers = new Set<string>();

export function removeLeftovers(): void {
  for (const path of leftovers) rmSync(path, { recursive: true, force: true });
}

export type Setup = { home: string; work: string; journal: string; env: NodeJS.ProcessEnv };

/**
 * A config of its own pointing at a journal of its own, so a right answer can
 * only come from the rules this checkout made. The session hands the git
 * identity on to the CLI that commits.
 */
export function setup(): Setup {
  const home = tempDir('it-');
  leftovers.add(home);
  const work = join(home, 'work');
  const journal = join(home, 'journal');
  mkdirSync(work);
  const env = { ...process.env, ...GIT_IDENTITY, ...ISOLATED_ENV, XDG_CONFIG_HOME: join(home, 'config') };
  execFileSync(join(ROOT, 'bin', 'agent-journal'), ['config', 'set', 'journal_dir', journal], { env });
  return { home, work, journal, env };
}
