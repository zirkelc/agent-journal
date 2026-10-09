import type { JournalDate, JournalDateUnit } from '../types';
import { SOURCES_PREFIX } from './agent.js';

/**
 * How the pane shows entries: local days and times, project colors, the fields
 * of an entry's frontmatter. Pure, so a view and a test call the same code.
 */

const ID = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
const IDS = /\b\d{4}-\d{2}-\d{2}T\d{6}Z\b/g;

/** The instant an entry id names, or undefined for anything else. */
export function instantOf(id: string): Date | undefined {
  const match = ID.exec(id);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match.map(Number) as Array<number>;
  return new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!, second!));
}

/** One formatter per time zone: the list formats every entry it holds, and making one is the slow part. */
const formats = new Map<string, Intl.DateTimeFormat>();

function dayTimeFormat(timeZone?: string): Intl.DateTimeFormat {
  const key = timeZone ?? '';
  let format = formats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formats.set(key, format);
  }
  return format;
}

/** The local day (YYYY-MM-DD) and time (HH:MM) of an instant, in a time zone. */
export function localDayTime(instant: Date, timeZone?: string): { day: string; time: string } {
  const parts = dayTimeFormat(timeZone).formatToParts(instant);
  const part = (type: string) => parts.find((one) => one.type === type)?.value ?? '';
  return { day: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

/**
 * A filter value as a person reads it: `today`, `last 7 days`, or the local day
 * it names (`Oct 7`), whether it came as a date or as an instant.
 */
export function dayText(value: string, timeZone?: string): string {
  if (value === 'today') return 'today';
  const days = /^(\d+)d$/.exec(value);
  if (days) return `last ${days[1]} days`;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const zone = /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'UTC' : timeZone;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: zone }).format(date);
}

/** A since and an until as one range: `Oct 7`, `Sep 28 – Oct 4`, `since Oct 1`. */
export function rangeText(since: string, until: string, timeZone?: string): string {
  const from = since !== '' ? dayText(since, timeZone) : '';
  const to = until !== '' ? dayText(until, timeZone) : '';
  if (from !== '' && to !== '') return from === to ? from : `${from} – ${to}`;
  if (from !== '') return from === 'today' || from.startsWith('last ') ? from : `since ${from}`;
  if (to !== '') return `until ${to}`;
  return '';
}

export type DateUnit = JournalDateUnit;
export type DateFilter = JournalDate;

export const ALL_DATES: DateFilter = { unit: 'all', value: '' };

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/** The period of one unit a local day falls in. */
export function periodOf(unit: DateUnit, day: string): string {
  if (unit === 'year') return day.slice(0, 4);
  if (unit === 'month') return day.slice(0, 7);
  if (unit === 'day') return day.slice(0, 10);
  return '';
}

/** The last local day of a period: a past year or month is entered at its newest end. */
function lastDayOf(filter: DateFilter): string {
  const [year, month] = filter.value.split('-').map(Number) as Array<number>;
  if (filter.unit === 'year') return `${filter.value}-12-31`;
  if (filter.unit === 'month') {
    const last = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
    return `${filter.value}-${pad(last)}`;
  }
  return filter.value;
}

/**
 * The filter for another unit, around the period shown now: today when today
 * is in it (or nothing is filtered), else the newest day of it, so going from
 * a past year to its months lands on its December.
 */
export function withUnit(filter: DateFilter, unit: DateUnit, today: string): DateFilter {
  if (unit === 'all') return ALL_DATES;
  const anchor = filter.unit === 'all' || today.startsWith(filter.value) ? today : lastDayOf(filter);
  return { unit, value: periodOf(unit, anchor) };
}

/** The period one step before (`-1`) or after (`1`) the one shown, in the same unit. */
export function stepped(filter: DateFilter, by: number): DateFilter {
  const [year, month, day] = filter.value.split('-').map(Number) as Array<number>;
  if (filter.unit === 'year') return { unit: 'year', value: String(year! + by) };
  if (filter.unit === 'month') {
    const at = new Date(Date.UTC(year!, month! - 1 + by, 1));
    return { unit: 'month', value: `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}` };
  }
  if (filter.unit === 'day') {
    const at = new Date(Date.UTC(year!, month! - 1, day! + by));
    return { unit: 'day', value: `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}` };
  }
  return filter;
}

/** Whether a step forward would pass the period today is in, where no entry can be yet. */
export const isLatest = (filter: DateFilter, today: string): boolean =>
  filter.unit === 'all' || filter.value >= periodOf(filter.unit, today);

/** A period as the pane names it: `2026`, `October 2026`, `Wednesday 2026-10-07`. */
export function periodText(filter: DateFilter): string {
  const [year, month] = filter.value.split('-').map(Number) as Array<number>;
  if (filter.unit === 'year') return filter.value;
  if (filter.unit === 'month') {
    const name = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(year!, month! - 1, 1)),
    );
    return `${name} ${year}`;
  }
  if (filter.unit === 'day') {
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(
      new Date(`${filter.value}T12:00:00Z`),
    );
    return `${weekday} ${filter.value}`;
  }
  return 'All dates';
}

/** A day as the list's heading reads: Today, Yesterday, or the weekday and the date. */
export function dayHeading(day: string, now: Date, timeZone?: string): string {
  const today = localDayTime(now, timeZone).day;
  const yesterday = localDayTime(new Date(now.getTime() - 86_400_000), timeZone).day;
  const [year, month, date] = day.split('-').map(Number) as Array<number>;
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year!, month! - 1, date!)),
  );
  if (day === today) return `Today, ${weekday} ${day}`;
  if (day === yesterday) return `Yesterday, ${weekday} ${day}`;
  return `${weekday} ${day}`;
}

/**
 * The colors a project gets, as the color of its name and as the ground under
 * it alike: mid tones that read as text on a dark terminal and carry its text
 * as a ground, none of them red, which the pane keeps for errors.
 */
export const PROJECT_COLORS: ReadonlyArray<string> = [
  '#3b82f6',
  '#16a34a',
  '#ca8a04',
  '#9333ea',
  '#db2777',
  '#0891b2',
  '#ea580c',
  '#65a30d',
  '#6366f1',
  '#64748b',
];

/** The same project always gets the same color: FNV-1a over its name. */
export function colorOf(project: string): string {
  let hash = 0x811c9dc5;
  for (const char of project) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return PROJECT_COLORS[hash % PROJECT_COLORS.length]!;
}

/** A text cut to a width, with an ellipsis when it was longer. */
export function fit(text: string, width: number): string {
  if (width <= 0) return '';
  const chars = [...text];
  return chars.length <= width ? text : `${chars.slice(0, Math.max(width - 1, 0)).join('')}…`;
}

/** A text cut or padded to exactly a width, for a column. */
export const column = (text: string, width: number): string => fit(text, width).padEnd(width, ' ');

/** The fields of an entry's frontmatter, and its body. */
export type ParsedEntry = { fields: Record<string, string>; body: string };

/** Splits an entry into its frontmatter fields and its body. Quoted values lose their quotes. */
export function parseEntry(text: string): ParsedEntry {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return { fields: {}, body: text.trim() };
  const end = lines.indexOf('---', 1);
  if (end === -1) return { fields: {}, body: text.trim() };
  const fields: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([a-z_]+):\s?(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2]!.trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    fields[match[1]!] = value;
  }
  return {
    fields,
    body: lines
      .slice(end + 1)
      .join('\n')
      .trim(),
  };
}

/** One entry as `read` returns it, as a list row has it: its id, project and summary. */
export function entryOfText(text: string): Array<{ id: string; project: string; summary: string }> {
  const { fields } = parseEntry(text);
  const instant = fields.date ? new Date(fields.date) : undefined;
  if (!instant || Number.isNaN(instant.getTime())) return [];
  const id = instant.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const shaped = `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T${id.slice(9, 15)}Z`;
  return [{ id: shaped, project: fields.project ?? '', summary: fields.summary ?? '' }];
}

/** An answer split into the text to show and the entries its last `Sources:` line names. */
export type SplitAnswer = { text: string; ids: Array<string> };

/**
 * Takes the `Sources:` line off the end of an answer and returns its ids. An
 * answer without one keeps its text, and its sources are the ids the text names.
 */
export function splitSources(answer: string, prefix = SOURCES_PREFIX): SplitAnswer {
  const lines = answer.trimEnd().split('\n');
  const at = lines.findLastIndex((line) =>
    line
      .trim()
      .replace(/^[*_]+/, '')
      .startsWith(prefix),
  );
  if (at === -1) return { text: answer.trim(), ids: entryIdsIn(answer) };
  const ids = entryIdsIn(lines.slice(at).join('\n'));
  return { text: lines.slice(0, at).join('\n').trim(), ids: ids.length > 0 ? ids : entryIdsIn(answer) };
}

/** Every entry id a text names, once each, in order. */
export const entryIdsIn = (text: string): Array<string> => [...new Set(text.match(IDS) ?? [])];

/** The most characters one Markdown element draws. */
export const MARKDOWN_MAX = 10_000;

/** Markdown cut to what one element draws, tab and newline its only control characters. */
export const markdownOf = (text: string): string =>
  fit(
    text.replace(/[\p{Cc}\p{Cf}]/gu, (char) => (char === '\n' || char === '\t' ? char : '')),
    MARKDOWN_MAX,
  );
