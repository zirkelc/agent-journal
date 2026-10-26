/**
 * Grades one session of a case, for any harness. It sees only what a user
 * would see: the last answer, and the entry files that the session wrote.
 *
 * Each case gives some checks, and the score is the share of checks that
 * passed. The grader does not judge the style of an answer, only whether it
 * has the facts.
 */
import { type Case, keyed, localDay, type Placed } from './dataset.ts';

/** A check with `isScored` false is reported, but does not count for the score. */
export type Check = { name: string; isPassed: boolean; isScored?: boolean; detail?: string };

export type Session = {
  /** The last answer of the agent, after the last message. */
  answer: string;
  /** The entry files that the session wrote: the file name and the text. */
  written: Array<{ name: string; text: string }>;
  /** When the session started and ended. */
  start: Date;
  end: Date;
  /** What the new entries must record. */
  expected: { cwd: string; host: string; user: string; agent: string; sessionId: string };
};

const matches = (pattern: string, text: string): boolean => new RegExp(pattern, 'i').test(text);

const MONTHS = new Intl.DateTimeFormat('en-US', { month: 'long' });
const SHORT_MONTHS = new Intl.DateTimeFormat('en-US', { month: 'short' });

/** The ways an answer can name a local day. */
function dayPatterns(day: Date, now: Date): Array<RegExp> {
  const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  const date = day.getDate();
  const months = `(${MONTHS.format(day)}|${SHORT_MONTHS.format(day)}\\.?)`;
  const daysAgo = Math.round((localDay(now, 0).getTime() - day.getTime()) / 86_400_000);
  return [
    new RegExp(iso),
    new RegExp(`${months}\\s+${date}(st|nd|rd|th)?\\b`, 'i'),
    new RegExp(`\\b${date}(st|nd|rd|th)?\\s+(of\\s+)?${months}`, 'i'),
    new RegExp(`\\b${daysAgo} days ago\\b`, 'i'),
  ];
}

/** The frontmatter of an entry, without quotes around the values. */
export function frontmatter(text: string): Record<string, string> {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const match = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (match) fields[match[1]!] = match[2]!.replace(/^"(.*)"$/, '$1');
  }
  return fields;
}

const ID = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})Z\.md$/;

function recallChecks(test: Case, session: Session, placed: Array<Placed>): Array<Check> {
  const { answer } = session;
  const checks: Array<Check> = [];
  const expect = test.expect;
  for (const pattern of expect.all ?? []) checks.push({ name: `says ${pattern}`, isPassed: matches(pattern, answer) });
  if (expect.none) {
    const found = expect.none.filter((pattern) => matches(pattern, answer));
    checks.push({
      name: `does not say ${expect.none.join(', ')}`,
      isPassed: found.length === 0,
      detail: found.join(', '),
    });
  }
  if (expect.date_of) {
    const { day } = keyed(placed, expect.date_of);
    checks.push({
      name: `names the day of ${expect.date_of}`,
      isPassed: dayPatterns(day, session.start).some((pattern) => pattern.test(answer)),
      detail: day.toDateString(),
    });
  }
  if (expect.counts) {
    const from = localDay(session.start, expect.counts.from).getTime();
    const to = localDay(session.start, expect.counts.to + 1).getTime();
    const counts = new Map<string, number>();
    for (const item of placed) {
      if (!item.entry.project || item.date.getTime() < from || item.date.getTime() >= to) continue;
      counts.set(item.entry.project, (counts.get(item.entry.project) ?? 0) + 1);
    }
    const lines = answer.split('\n');
    for (const [project, count] of counts) {
      const isPassed = lines.some(
        (line) => line.includes(project) && new RegExp(`(^|[^\\d])${count}([^\\d]|$)`).test(line),
      );
      checks.push({ name: `${project}: ${count}`, isPassed });
    }
  }
  if (expect.negative) {
    checks.push({
      name: 'says that nothing matches',
      isPassed: /\b(no|not|never|nothing|none|didn't|don't|couldn't)\b/i.test(answer.slice(0, 400)),
    });
  }
  return checks;
}

function writeChecks(test: Case, session: Session): Array<Check> {
  const expect = test.expect;
  const { written, expected } = session;
  const checks: Array<Check> = [];
  const range = expect.entries ?? { min: 1, max: 1 };
  checks.push({
    name: `writes ${range.min} to ${range.max} entries`,
    isPassed: written.length >= range.min && written.length <= range.max,
    detail: String(written.length),
  });
  if (written.length === 0) return checks;
  /** Every entry must have every field right, so each field is one check over all entries. */
  const every = (name: string, test: (file: { name: string; text: string }) => boolean) =>
    checks.push({ name, isPassed: written.every(test) });
  const fieldsOf = (text: string) => frontmatter(text);
  every('file name is a UTC id', (file) => ID.test(file.name));
  every('date is the instant of the file name', (file) => {
    const match = ID.exec(file.name);
    return Boolean(match) && fieldsOf(file.text).date === `${match![1]}T${match![2]}:${match![3]}:${match![4]}Z`;
  });
  every('date is within the session', (file) => {
    const date = new Date(fieldsOf(file.text).date ?? '');
    return date.getTime() >= session.start.getTime() - 1_000 && date.getTime() <= session.end.getTime() + 1_000;
  });
  if (expect.project !== undefined) {
    every(expect.project === null ? 'has no project' : `project is ${expect.project}`, (file) =>
      expect.project === null ? !('project' in fieldsOf(file.text)) : fieldsOf(file.text).project === expect.project,
    );
  }
  every(`cwd is ${expected.cwd}`, (file) => fieldsOf(file.text).cwd === expected.cwd);
  every(`host is ${expected.host}`, (file) => fieldsOf(file.text).host === expected.host);
  every(`user is ${expected.user}`, (file) => fieldsOf(file.text).user === expected.user);
  every(`agent is ${expected.agent}`, (file) => fieldsOf(file.text).agent === expected.agent);
  every('session_id is the session', (file) => fieldsOf(file.text).session_id === expected.sessionId);
  every('summary is one line of at most 200 characters', (file) => {
    const summary = fieldsOf(file.text).summary ?? '';
    return summary.length > 0 && summary.length <= 200;
  });
  for (const pattern of expect.body ?? []) {
    checks.push({ name: `an entry says ${pattern}`, isPassed: written.some((file) => matches(pattern, file.text)) });
  }
  return checks;
}

export function grade(test: Case, session: Session, placed: Array<Placed>): { score: number; checks: Array<Check> } {
  const checks = test.kind === 'recall' ? recallChecks(test, session, placed) : writeChecks(test, session);
  /** A question about the journal is no reason for an entry. This says nothing about the recall, so it has no score. */
  if (test.kind === 'recall') {
    checks.push({
      name: 'writes no entry',
      isPassed: session.written.length === 0,
      isScored: false,
      detail: String(session.written.length),
    });
  }
  const scored = checks.filter((check) => check.isScored !== false);
  const passed = scored.filter((check) => check.isPassed).length;
  return { score: scored.length === 0 ? 0 : passed / scored.length, checks };
}
