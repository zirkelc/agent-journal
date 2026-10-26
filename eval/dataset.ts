/**
 * The dataset of the eval, for any harness: the journal and the cases, and
 * how to turn the journal into files on a given day.
 *
 * A runner for a harness materializes the journal into a fresh home
 * directory, starts a session in the case's directory, sends the messages,
 * and gives the grader the final answer and the files the session wrote.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEntries, type Entry } from './dataset/generate.ts';

export type { Entry };

const HERE = dirname(fileURLToPath(import.meta.url));

export type Expect = {
  /** Each is a regex, ignoring case, that the answer must match. One check each. */
  all?: Array<string>;
  /** Regexes that the answer must not match. One check for all of them. */
  none?: Array<string>;
  /** The answer must name the local day of this entry, or of each of these entries. One check each. */
  date_of?: string | Array<string>;
  /** The answer must give the number of entries of each project in these local days. One check each project. */
  counts?: { from: number; to: number };
  /** The answer must say that nothing was found. */
  negative?: boolean;
  /** How many entries the session must write. */
  entries?: { min: number; max: number };
  /** The project the entries must have, or null for none. */
  project?: string | null;
  /** Regexes that the body of one of the new entries must match. */
  body?: Array<string>;
};

export type Case = {
  id: string;
  kind: 'recall' | 'write';
  dir: string;
  git: boolean;
  messages: Array<string>;
  expect: Expect;
  why: string;
};

/** The key entries and the filler, with the text of the filler from the content files. The same on each run. */
export function loadEntries(): Array<Entry> {
  return buildEntries();
}

export function loadCases(): Array<Case> {
  return (JSON.parse(readFileSync(join(HERE, 'dataset', 'cases.json'), 'utf8')) as { cases: Array<Case> }).cases;
}

/** One entry as a file: its id, its local start of day, and where it is. */
export type Placed = { entry: Entry; id: string; date: Date; day: Date };

/** The start of a local day, relative to `now`. Uses the time zone of the process. */
export function localDay(now: Date, offset: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
}

/** The UTC id of an instant, as the journal names its files. */
export const idOf = (date: Date): string =>
  date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replaceAll(':', '');

/** The instant of an entry on the day of `now`, in the time zone of the process. */
export function instantOf(entry: Entry, now: Date): Date {
  const minutesAgo = /^now-(\d+)$/.exec(entry.time);
  if (minutesAgo) return new Date(Math.floor((now.getTime() - Number(minutesAgo[1]) * 60_000) / 1_000) * 1_000);
  const [hours, minutes] = entry.time.split(':').map(Number) as [number, number];
  if (entry.at) return new Date(now.getFullYear(), now.getMonth() + entry.at.month, entry.at.date, hours, minutes);
  const day = localDay(now, entry.day);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes);
}

/**
 * Places every entry relative to `now`. Two entries at the same instant get
 * one second between them, since the id is the instant.
 */
export function place(entries: Array<Entry>, now: Date): Array<Placed> {
  const taken = new Set<string>();
  return entries.map((entry) => {
    let date = instantOf(entry, now);
    while (taken.has(idOf(date))) date = new Date(date.getTime() + 1_000);
    taken.add(idOf(date));
    return { entry, id: idOf(date), date, day: localDay(date, 0) };
  });
}

/** The text of an entry file, in the format that the CLI writes. */
export function render(placed: Placed, home: { host: string; user: string }, index: number): string {
  const { entry, date } = placed;
  const lines = [
    '---',
    `date: ${date.toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
    ...(entry.project ? [`project: ${entry.project}`] : []),
    `summary: "${entry.summary}"`,
    `cwd: ~/${entry.dir}`,
    `host: "${home.host}"`,
    `user: "${home.user}"`,
    `agent: ${entry.agent}`,
    `session_id: ${sessionIdOf(index)}`,
    '---',
    '',
    entry.body,
    '',
  ];
  return lines.join('\n');
}

/** A stable session id that looks like a real one. */
function sessionIdOf(index: number): string {
  const hex = (index * 2_654_435_761).toString(16).padStart(8, '0').slice(-8);
  return `${hex}-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

/** Writes the journal into `dir`, and gives back where each entry went. */
export function materialize(
  dir: string,
  now: Date,
  home: { host: string; user: string },
  entries = loadEntries(),
): Array<Placed> {
  mkdirSync(dir, { recursive: true });
  const placed = place(entries, now).filter((item) => item.date.getTime() < now.getTime());
  placed.forEach((item, index) => writeFileSync(join(dir, `${item.id}.md`), render(item, home, index)));
  return placed;
}

const LONG_DAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });

/** A message with `{day:KEY}` filled in, as in "Saturday, October 3", and `{month:KEY}`, as in "June 2025". */
export function fill(message: string, placed: Array<Placed>): string {
  return message
    .replaceAll(/\{day:(\w+)\}/g, (_, key: string) => LONG_DAY.format(keyed(placed, key).day))
    .replaceAll(/\{month:(\w+)\}/g, (_, key: string) => MONTH.format(keyed(placed, key).day));
}

export function keyed(placed: Array<Placed>, key: string): Placed {
  const found = placed.find((item) => item.entry.key === key);
  if (!found) throw new Error(`No entry with the key ${key}`);
  return found;
}
