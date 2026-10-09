/**
 * Everything the mod knows about the CLI's arguments and output. Pure: the calls
 * themselves are made where the engine is, and only the argv and the text pass
 * through here.
 */

/** One line of `list` or `search` down a pipe. */
export type Entry = {
  id: string;
  project: string;
  summary: string;
};

/** The filters the CLI's query commands take, as the tools and the pane give them. */
export type Filters = {
  /** One local year, month or day: `2026`, `2026-10`, `2026-10-07`. */
  date?: string;
  since?: string;
  until?: string;
  project?: string;
  limit?: number;
  /** How many of the most recent matches to skip, for the next page. */
  offset?: number;
};

/** Why a value cannot go to the CLI, as the model or the person reads it. */
export class InputError extends Error {}

const ID = /^\d{4}-\d{2}-\d{2}T\d{6}Z$/;

/** The most lines a query asks for, so one call cannot fill the agent's context. */
export const MAX_LIMIT = 200;

/** The most characters of one CLI answer handed on, for the same reason. */
export const MAX_OUTPUT = 40_000;

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

/**
 * The filter flags, in the order the help lists them. `project` `.` is the
 * project of the directory the CLI runs in, so the caller runs it where the
 * session is; `--cwd` would filter by directory instead.
 */
function filterArgs(filters: Filters, maxLimit = MAX_LIMIT): Array<string> {
  const args: Array<string> = [];
  if (filters.date !== undefined) args.push('--date', plain('date', filters.date));
  if (filters.since !== undefined) args.push('--since', plain('since', filters.since));
  if (filters.until !== undefined) args.push('--until', plain('until', filters.until));
  if (filters.project !== undefined) args.push('--project', plain('project', filters.project));
  const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 50), 1), maxLimit);
  args.push('--limit', String(limit));
  const offset = Math.max(Math.trunc(filters.offset ?? 0), 0);
  if (offset > 0) args.push('--offset', String(offset));
  return args;
}

/**
 * `list` with the filters. The agent's lists stay within the cap; the pane,
 * which draws only the rows in view, passes a higher one.
 */
export const listArgs = (filters: Filters, maxLimit = MAX_LIMIT): Array<string> => [
  'list',
  ...filterArgs(filters, maxLimit),
];

/** `search` for one text with the filters. */
export const searchArgs = (text: string, filters: Filters): Array<string> => [
  'search',
  plain('text', text),
  ...filterArgs(filters),
];

/**
 * `read` for one entry id. The CLI also takes a shorter prefix, but one that
 * matches several entries is an error there, and `list` with a date gives a
 * day's entries, so only a whole id passes.
 */
export function readArgs(id: string): Array<string> {
  const value = id.trim();
  if (!ID.test(value)) throw new InputError(`not an entry id: ${value}`);
  return ['read', value];
}

/** The flags that name a session to `context`: where it works, its id, and the agent and model in it. */
function sessionArgs(cwd: string, sessionId: string | undefined, agent: string | undefined): Array<string> {
  const args = ['--cwd', cwd];
  if (sessionId) args.push('--session-id', sessionId);
  if (agent) args.push('--agent', agent);
  return args;
}

/** `context`, the rules for writing the journal, for the session they are given to. */
export const contextArgs = (cwd: string, sessionId: string | undefined, agent: string | undefined): Array<string> => [
  'context',
  ...sessionArgs(cwd, sessionId, agent),
];

/** `context --recall`, the text a reader of the journal is given, for the session the question comes from. */
export const recallArgs = (cwd: string, sessionId: string | undefined, agent: string | undefined): Array<string> => [
  'context',
  '--recall',
  ...sessionArgs(cwd, sessionId, agent),
];

/** `config`, for the journal directory. */
export const configArgs = (): Array<string> => ['config'];

/** The journal directory from `config`'s `key=value` lines. */
export function journalDirOf(stdout: string): string | undefined {
  const match = /^journal_dir=(.+)$/m.exec(stdout);
  return match?.[1];
}

/** The entries of `list` or `search` down a pipe: id, project and summary, one tab apart. */
export function entriesOf(stdout: string): Array<Entry> {
  const entries: Array<Entry> = [];
  for (const line of stdout.split('\n')) {
    const [id = '', project = '', ...rest] = line.split('\t');
    if (!ID.test(id)) continue;
    entries.push({ id, project, summary: rest.join(' ') });
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

/** CLI output as a tool hands it on: whole when it fits, cut with a note when not. */
export function capped(text: string): string {
  if (text.length <= MAX_OUTPUT) return text;
  return `${text.slice(0, MAX_OUTPUT)}\n… cut at ${MAX_OUTPUT} characters; narrow the filters to see the rest.`;
}
