/**
 * What every runner shares: the time zone of the run, the PATH without the CLI,
 * the record of one session, the check for entries outside the journal, and
 * the pool that runs the sessions.
 */
import { existsSync, readdirSync } from 'node:fs';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import type { Case } from './dataset.ts';
import { type grade, ID } from './grade.ts';

/**
 * Time zones east of UTC, so that a local day starts on the UTC date before
 * it. That is what the cases about yesterday test. An entry of today is at
 * 00:30, and the last entry is 20 minutes before the run, so the run takes the
 * first zone where it is now between 03:00 and 22:59. With three zones, that
 * is one at every hour of the day, and the eval can run at any time, also on CI.
 */
const ZONES = ['Europe/Berlin', 'Asia/Dubai', 'Asia/Tokyo'];

export function pickZone(now: Date): string {
  const hourIn = (timeZone: string) =>
    Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now));
  const zone = ZONES.find((timeZone) => hourIn(timeZone) >= 3 && hourIn(timeZone) <= 22);
  if (!zone) throw new Error('No time zone has a time of day between 03:00 and 22:59 now.');
  return zone;
}

/** The host and the user that the config of each session names, and that its entries must record. */
export const HOST = 'eval-host';
export const USER = 'eval-user';

export type Mode = 'tools' | 'files';

export type ToolCall = { name: string; args: unknown; outChars: number; isError: boolean };

export type Record_ = {
  case: string;
  kind: Case['kind'];
  mode: Mode;
  repeat: number;
  model: string;
  timeZone: string;
  score: number;
  checks: ReturnType<typeof grade>['checks'];
  answer: string;
  written: Array<string>;
  toolCalls: Array<ToolCall>;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  durationMs: number;
  /** The calls that a permission check refused. An agent without permission checks has none. */
  refused?: number;
  error?: string;
};

/** PATH without a folder that has the CLI, so that the model without the tools finds no `agent-journal` either. */
export function cleanPath(): string {
  return (process.env.PATH ?? '')
    .split(delimiter)
    .filter((dir) => {
      try {
        return !readdirSync(dir).some((name) => name === 'agent-journal' || name === 'aj');
      } catch {
        return true;
      }
    })
    .join(delimiter);
}

/**
 * The entry files that a session wrote outside the journal folder. The files
 * on disk show every such entry in the folder of the session, however it was
 * written. A write or edit tool can also put one outside that folder, which
 * only its path shows: `pathOf` gives the path of such a call as the tool read
 * it, `~` already as the home of the session.
 */
export function strayEntries(
  run: { base: string; cwd: string; journalDir: string },
  toolCalls: Array<ToolCall>,
  pathOf: (call: ToolCall) => string | undefined,
): Array<string> {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) {
        if (path !== run.journalDir) walk(path);
      } else if (ID.test(item.name)) {
        found.add(path);
      }
    }
  };
  walk(run.base);
  for (const call of toolCalls) {
    if (call.isError) continue;
    const path = pathOf(call);
    if (path === undefined) continue;
    const absolute = resolve(run.cwd, path);
    if (ID.test(basename(absolute)) && dirname(absolute) !== run.journalDir && existsSync(absolute))
      found.add(absolute);
  }
  return [...found].sort();
}

/** Runs the jobs with at most `limit` at a time. */
export async function pool<T>(jobs: Array<() => Promise<T>>, limit: number): Promise<Array<T>> {
  const results: Array<T> = [];
  let index = 0;
  const worker = async () => {
    while (index < jobs.length) {
      const mine = index++;
      results[mine] = await jobs[mine]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

/** A session that passed every scored check needs no look later. One with no scored check proves nothing. */
export function isClean(record: Record_): boolean {
  const isScored = record.checks.some((check) => check.isScored !== false);
  return !record.error && isScored && record.checks.every((check) => check.isPassed);
}
