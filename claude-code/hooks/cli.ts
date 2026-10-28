/**
 * Everything the mod knows about the CLI's arguments and output. Pure: the calls
 * themselves are made where the engine is, and only the argv and the text pass
 * through here.
 */

import { DEFAULT_LIMIT, isPeriod, MAX_LIMIT, summaryProblem } from '../lib/tools.js';

/** The limits and the output of the journal tools, which the Pi extension shares. */
export {
  capped,
  DEFAULT_LIMIT,
  fitList,
  isCut,
  isPeriod,
  MAX_LIMIT,
  MAX_OUTPUT,
  withNote,
  withOlder,
} from '../lib/tools.js';

/** One line of `list` down a pipe. */
export type Entry = {
  id: string;
  project: string;
  summary: string;
  /** The part of the body line a search matched on, only when there was a text to look for, and empty when the summary matched. */
  line?: string;
};

/** The fields that `list` can count its matches by. */
export const BY_FIELDS = ['project', 'date', 'host', 'user', 'agent'] as const;
export type ByField = (typeof BY_FIELDS)[number];

/** The filters the CLI's query commands take, as the tools and the pane give them. */
export type Filters = {
  /** One local year, month or day: `2026`, `2026-10`, `2026-10-07`, `today` or `yesterday`. */
  date?: string;
  since?: string;
  until?: string;
  project?: string;
  /** The directory of the entries and the directories under it. `*` and `?` match within one name of the path. */
  cwd?: string;
  /** The machine, the account and the agent or model that wrote the entries, each a glob. */
  host?: string;
  user?: string;
  agent?: string;
  limit?: number;
  /** How many of the most recent matches to skip, for the next page. */
  offset?: number;
};

/** What `list` looks for: the filters, the search terms, and the field to count the matches by. */
export type Query = Filters & {
  /** Each term is a regex that must match one line of the entry. */
  terms?: ReadonlyArray<string>;
  /** Whether the terms are plain text rather than regexes. */
  isFixed?: boolean;
  by?: ByField;
};

/** Why a value cannot go to the CLI, as the model or the person reads it. */
export class InputError extends Error {}

const ID = /^\d{4}-\d{2}-\d{2}T\d{6}Z$/;

/** Whether a string is an entry id, the file name without `.md`. */
export const isEntryId = (value: string): boolean => ID.test(value);

/**
 * The CLI parses its own arguments, and a value that starts with `-` would read
 * as a flag. Nothing a filter or a search needs starts with one.
 */
function plain(name: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') throw new InputError(`${name} is empty`);
  if (trimmed.startsWith('-')) throw new InputError(`${name} must not start with "-": ${trimmed}`);
  return trimmed;
}

/** The filters that name who and where, which `read` takes for a period as `list` does, in the order the help lists them. */
const SCOPE_FILTERS = ['project', 'cwd', 'host', 'user', 'agent'] as const;

/** The flags of the filters that name who and where. */
function scopeArgs(filters: Filters): Array<string> {
  return SCOPE_FILTERS.flatMap((name) => {
    const value = filters[name];
    return value === undefined ? [] : [`--${name}`, plain(name, value)];
  });
}

/**
 * The filter flags, in the order the help lists them. `project` `.` is the
 * project of the directory the CLI runs in, so the caller runs it where the
 * session is.
 */
function filterArgs(filters: Filters): Array<string> {
  const args: Array<string> = [];
  if (filters.date !== undefined) args.push('--date', plain('date', filters.date));
  if (filters.since !== undefined) args.push('--since', plain('since', filters.since));
  if (filters.until !== undefined) args.push('--until', plain('until', filters.until));
  return [...args, ...scopeArgs(filters)];
}

/** The offset as the CLI gets it: a whole number, never below 0. A note that names the next offset counts from this one too. */
export const offsetOf = (filters: Filters): number => Math.max(Math.trunc(filters.offset ?? 0), 0);

/** The page flags: the limit, within the cap, and the offset when there is one. */
function pageArgs(filters: Filters, maxLimit: number): Array<string> {
  const args = ['--limit', String(Math.min(Math.max(Math.trunc(filters.limit ?? DEFAULT_LIMIT), 1), maxLimit))];
  const offset = offsetOf(filters);
  if (offset > 0) args.push('--offset', String(offset));
  return args;
}

/**
 * `list` with the terms and the filters. The agent's lists stay within the
 * cap; the pane, which draws only the rows in view, passes a higher one. A
 * count reads every match, so it takes no page: the CLI refuses a limit or an
 * offset with `by`.
 */
export function listArgs(query: Query, maxLimit = MAX_LIMIT): Array<string> {
  const terms = (query.terms ?? []).map((term) => plain('term', term));
  const args = ['list', ...terms, ...(query.isFixed ? ['--fixed'] : []), ...filterArgs(query)];
  if (query.by === undefined) return [...args, ...pageArgs(query, maxLimit)];
  if (!BY_FIELDS.includes(query.by)) throw new InputError(`by must be one of ${BY_FIELDS.join(', ')}: ${query.by}`);
  /** The default offset 0 pages nothing, so a count takes it, as Pi does. */
  if (query.limit !== undefined || (query.offset !== undefined && query.offset !== 0)) {
    throw new InputError('by counts every match, so leave out limit and offset');
  }
  return [...args, '--by', query.by];
}

/**
 * `read` for `latest`, one or more entry ids (each whole or a prefix that
 * matches one entry), or one period. Only a period takes the filters and a
 * page: the CLI refuses them with anything else, so they are left out there.
 */
export function readArgs(which: ReadonlyArray<string>, filters: Filters = {}): Array<string> {
  if (which.length === 0) {
    throw new InputError(
      'which is missing. The read tool takes which, a list: ["latest"], one or more entry ids, or one period such as ["2026-10"]. A period also takes project, cwd, host, user, agent, limit and offset.',
    );
  }
  const args = ['read', ...which.map((item) => plain('which', item))];
  if (which.length !== 1 || !isPeriod(which[0]!)) return args;
  args.push(...scopeArgs(filters));
  if (filters.limit !== undefined) args.push('--limit', String(Math.max(Math.trunc(filters.limit), 1)));
  const offset = offsetOf(filters);
  if (offset > 0) args.push('--offset', String(offset));
  return args;
}

/** The flags that name a session to `context` and `write`: where it works, its id, and the agent and model in it. */
function sessionArgs(cwd: string, sessionId: string | undefined, agent: string | undefined): Array<string> {
  const args = ['--cwd', cwd];
  if (sessionId) args.push('--session-id', sessionId);
  if (agent) args.push('--agent', agent);
  return args;
}

/**
 * `context`, the rules for writing the journal, for the session they are given
 * to. With a tool prefix, the variant that writes and reads through the tools
 * of that name instead of files.
 */
export const contextArgs = (
  cwd: string,
  sessionId: string | undefined,
  agent: string | undefined,
  toolPrefix?: string,
): Array<string> => ['context', ...sessionArgs(cwd, sessionId, agent), ...(toolPrefix ? ['--tools', toolPrefix] : [])];

/**
 * `write` of one entry from its summary and body, for the session that writes
 * it. The CLI sets the date, the id and the project of the directory itself.
 * It does not sync: the caller does that on its own, so a push never holds up
 * the write.
 */
export function writeArgs(
  summary: string,
  body: string,
  cwd: string,
  sessionId: string | undefined,
  agent: string | undefined,
): Array<string> {
  const line = summary.trim();
  const problem = summaryProblem(line);
  if (problem) throw new InputError(problem);
  return ['write', `--summary=${line}`, `--body=${body.trim()}`, ...sessionArgs(cwd, sessionId, agent), '--no-sync'];
}

/** The id of the entry `write` made, from the path it prints. */
export function writtenIdOf(stdout: string): string | undefined {
  const name = stdout.trim().split('\n').at(-1)?.split('/').pop() ?? '';
  const id = name.replace(/\.md$/, '');
  return ID.test(id) ? id : undefined;
}

/** `context --recall`, the text a reader of the journal is given, for the session the question comes from. */
export const recallArgs = (cwd: string, sessionId: string | undefined, agent: string | undefined): Array<string> => [
  'context',
  '--recall',
  ...sessionArgs(cwd, sessionId, agent),
];

/** `config`, for the journal directory. */
export const configArgs = (): Array<string> => ['config'];

/**
 * `sync`, which commits the journal folder, pulls and pushes it when the config
 * turns it on. Without `isPull`, it pulls only when the push is rejected.
 */
export const syncArgs = (isPull = true): Array<string> => (isPull ? ['sync'] : ['sync', '--no-pull']);

/** What `sync` prints when the config leaves it off. */
export const SYNC_OFF = 'sync is off';

/** The exit code of a `sync` that committed but could not pull or push. */
export const SYNC_REMOTE_FAILED = 3;

/** The journal directory from `config`'s `key=value` lines. */
export function journalDirOf(stdout: string): string | undefined {
  const match = /^journal_dir=(.+)$/m.exec(stdout);
  return match?.[1];
}

/** Whether `config`'s lines turn sync on. */
export const isSyncOnOf = (stdout: string): boolean => /^sync=git$/m.test(stdout);

/**
 * The entries of `list` down a pipe: id, project and summary, one tab apart,
 * and the matching line as a fourth column when there was a text to look for.
 */
export function entriesOf(stdout: string): Array<Entry> {
  const entries: Array<Entry> = [];
  for (const text of stdout.split('\n')) {
    const [id = '', project = '', summary = '', line] = text.split('\t');
    if (!ID.test(id)) continue;
    entries.push({ id, project, summary, ...(line !== undefined ? { line } : {}) });
  }
  return entries;
}

/**
 * Text from outside as the drawing takes it: control and format characters
 * removed, since the render tree refuses them, and tabs as spaces.
 */
export const sanitize = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.replaceAll('\t', '  ').replace(/[\p{Cc}\p{Cf}]/gu, ''))
    .join('\n');
