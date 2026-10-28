/**
 * What the journal tools of Claude Code and Pi share: the limits of a call,
 * the switch that turns the tools off, and how a CLI answer becomes a tool's
 * answer. This file in `shared/lib/` is the one to edit. Each plugin
 * folder carries a copy, because an install copies only the plugin folder and
 * a hooks module may import only files inside it. Pure: no import, so both
 * runtimes load it as it is.
 */

/** How many lines a query asks for when the caller does not say. */
export const DEFAULT_LIMIT = 50;

/** The most lines a query asks for, so one call cannot fill the agent's context. */
export const MAX_LIMIT = 200;

/** The most characters of one CLI answer handed on, for the same reason. */
export const MAX_OUTPUT = 40_000;

/** The most characters of a summary, as the CLI counts them. */
const MAX_SUMMARY = 200;

/**
 * The environment variable that turns the tools off: `off`, `0` or `false`.
 * Without the tools, the model writes and reads the entries as files.
 */
export const TOOLS_ENV = 'AGENT_JOURNAL_TOOLS';

/** Whether the journal tools are on for this value of TOOLS_ENV. They are on unless it turns them off. */
export const isToolsOn = (value: string | undefined): boolean =>
  !['off', '0', 'false'].includes(value?.trim().toLowerCase() ?? '');

/** A period that `read` takes: one local year, month or day, or `today` or `yesterday`. */
const PERIOD = /^(today|yesterday|\d{4}(-\d{2}(-\d{2})?)?)$/;

/** Whether a value is a period that `read` takes, rather than an entry id. */
export const isPeriod = (value: string): boolean => PERIOD.test(value.trim());

/**
 * Why the CLI would refuse a summary, or undefined when it takes it. The CLI
 * checks this too, but only after it keeps a draft folder for each refusal,
 * and a model that retries makes many.
 */
export function summaryProblem(summary: string): string | undefined {
  const length = [...summary].length;
  if (summary === '') return 'summary is empty';
  if (length > MAX_SUMMARY) return `summary is ${length} characters, and the limit is ${MAX_SUMMARY}`;
  if (/["\n\r]/.test(summary)) return 'summary cannot contain a double quote or a newline';
  return undefined;
}

/** CLI output as a tool hands it on: whole when it fits, cut with a note when not. */
export function capped(text: string): string {
  if (text.length <= MAX_OUTPUT) return text;
  return `${text.slice(0, MAX_OUTPUT)}\n… cut at ${MAX_OUTPUT} characters; narrow the filters to see the rest.`;
}

/**
 * The output of a CLI run, with the note on stderr that says which older
 * matches the limit left out. The note names the flag of the CLI, and the
 * model calls a tool, so it names the parameter instead.
 */
export function withNote(stdout: string, stderr: string): string {
  const note = stderr.trim().replace(/--offset (\d+) for older ones/, 'call again with offset $1 for older ones');
  return [stdout.trim(), note].filter((part) => part !== '').join('\n');
}

/** The last line of a list that the limit cut, as the tool gives it. */
const CUT_NOTE = /^matches (\d+) to (\d+), counted from the newest; call again with offset (\d+) for older ones$/;

/** Whether a list, as the tool gives it, left older matches out. */
export const isCut = (text: string): boolean => CUT_NOTE.test(text.split('\n').at(-1) ?? '');

/**
 * A cut list whose last line also says how many older matches it left out and
 * the day of the oldest, from the counts of the same list by date. A model that
 * sees only "for older ones" often answers from the newest page alone. The
 * longer note can push the list past MAX_OUTPUT, so the oldest lines go until
 * it fits. The text stays as it is when the counts do not give both.
 */
export function withOlder(text: string, counts: string): string {
  const lines = text.split('\n');
  const found = CUT_NOTE.exec(lines.at(-1) ?? '');
  if (!found) return text;
  const from = Number(found[1]);
  const total = Number(/^total\t(\d+)$/m.exec(counts)?.[1]);
  const oldest = counts
    .split('\n')
    .map((row) => /^\d+\t(\d{4}-\d{2}-\d{2})$/.exec(row)?.[1])
    .filter((day) => day !== undefined)
    .sort()[0];
  if (!Number.isFinite(total) || !oldest) return text;
  const note = (shown: number) => {
    const next = from - 1 + shown;
    const older = total - next;
    const left =
      older === 1
        ? `1 older match, back to ${oldest}, is not in this result: call again with offset ${next} before you answer about it.`
        : `${older} older matches, back to ${oldest}, are not in this result: call again with offset ${next} before you answer about them.`;
    return `matches ${from} to ${next} of ${total}, counted from the newest. ${left}`;
  };
  const rows = lines.slice(0, -1);
  if (total - (from - 1 + rows.length) <= 0) return text;
  while (rows.length > 0 && [...rows, note(rows.length)].join('\n').length > MAX_OUTPUT) rows.shift();
  return [...rows, note(rows.length)].join('\n');
}

/**
 * A list that is longer than MAX_OUTPUT, cut at whole lines. The list is
 * oldest first, so the oldest lines go, and the note says which offset gives
 * them, as the note of the CLI does for the limit. Undefined when the list fits.
 */
export function fitList(stdout: string, stderr: string, offset = 0): string | undefined {
  if (withNote(stdout, stderr).length <= MAX_OUTPUT) return undefined;
  const lines = stdout.trim().split('\n');
  const note = (shown: number) =>
    `matches ${offset + 1} to ${offset + shown}, counted from the newest; call again with offset ${offset + shown} for older ones`;
  let size = note(lines.length).length;
  let kept = 0;
  while (kept < lines.length && size + lines[lines.length - 1 - kept]!.length + 1 <= MAX_OUTPUT) {
    size += lines[lines.length - 1 - kept]!.length + 1;
    kept++;
  }
  return [...lines.slice(lines.length - kept), note(kept)].join('\n');
}
