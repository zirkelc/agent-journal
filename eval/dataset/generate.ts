/**
 * The journal that every case runs against: about three years of entries in
 * a dozen projects, with more entries per day as the use of the journal grows.
 *
 * The entries have no absolute dates. Each one has a day relative to the day
 * of the run (0 is today, -1 is yesterday), or a day of a month relative to
 * the month of the run, and a local time. The runner turns them into files
 * with UTC ids in the time zone of the run. So a case such as "what did we do
 * yesterday" stays correct on every day it runs.
 *
 * The key entries are written by hand: the cases ask about them. The rest is
 * filler, so that the journal has the size and the noise of a real one. A
 * seeded generator gives each filler entry its slot: the day, the time, the
 * project and the agent. The text of the slots is in the content folder, one
 * file for each project, written once by a model (see write.ts) and kept in
 * git, so the journal is the same on each run. The filler must not break the
 * rules below, which keep one right answer for each case, and the build stops
 * when it does.
 *
 * Print the size: `node eval/dataset/generate.ts`.
 */
import { readFileSync } from 'node:fs';

export type Entry = {
  /** The name a case uses for this entry. Filler has none. */
  key?: string;
  /** The day relative to the day of the run, in the local time zone. */
  day: number;
  /** Instead of `day`: a day of a month, relative to the month of the run. */
  at?: { month: number; date: number };
  /** The local time, HH:MM, or `now-N` for N minutes before the run. */
  time: string;
  /** No project means that the work was not in a repository. */
  project?: string;
  /** The working directory, relative to the home directory. */
  dir: string;
  agent: string;
  summary: string;
  body: string;
};

const CLAUDE = 'claude/claude-opus-5-5';
const CODEX = 'codex/gpt-5.5';
const PI = 'pi/claude-sonnet-5-5';

/** The entries of the last two months that the cases ask about. */
const KEYS: Array<Entry> = [
  // Yesterday. Y1 is on the UTC day before yesterday, and TRAP is today but on yesterday's UTC day.
  {
    key: 'Y1',
    day: -1,
    time: '00:40',
    project: 'nebula',
    dir: 'Developer/nebula',
    agent: CLAUDE,
    summary: 'Moved the nightly reindex job to 01:00 UTC, because it ran at the same time as the backup window.',
    body: 'The reindex and the backup both read the whole events table, and the backup took twice as long when they overlapped. The reindex now starts at 01:00 UTC, after the backup. Nothing else changed in the job.',
  },
  {
    key: 'Y2',
    day: -1,
    time: '10:15',
    project: 'acme-dashboard',
    dir: 'Developer/acme-dashboard',
    agent: CLAUDE,
    summary: 'Fixed the CSV export timeout by streaming the rows instead of building the whole file in memory.',
    body: 'Exports of more than 200,000 rows hit the 30 second gateway timeout. The handler now streams the rows from a cursor, and the first byte goes out after 300 ms. Tested with a 1.2 million row table.',
  },
  {
    key: 'Y3',
    day: -1,
    time: '15:30',
    project: 'billing-api',
    dir: 'Developer/billing-api',
    agent: CODEX,
    summary: 'Added idempotency keys to the refund endpoint, so a client that retries cannot refund twice.',
    body: 'The key comes from the client in a header and is kept for 24 hours. A second request with the same key gets the first response again. The mobile app sends the key from the next release.',
  },
  {
    key: 'Y4',
    day: -1,
    time: '23:20',
    dir: 'dotfiles',
    agent: CLAUDE,
    summary: 'Switched the terminal font to Berkeley Mono and fixed the ligatures inside tmux.',
    body: 'tmux showed the ligatures as separate glyphs. Setting the terminal features for the outer terminal fixed it. The old font is still installed in case the new one causes problems in the editor.',
  },
  {
    key: 'TRAP',
    day: 0,
    time: '01:10',
    project: 'nebula',
    dir: 'Developer/nebula',
    agent: CLAUDE,
    summary: 'Started the migration of the search index to the new shard layout, 3 of 12 shards done.',
    body: 'The new layout splits the index by month instead of by customer. The migration runs shard by shard, so search keeps working. The remaining 9 shards run tonight.',
  },
  // Today, the most recent entry. The runner puts it 20 minutes before the start of the run.
  {
    key: 'LATEST',
    day: 0,
    time: 'now-20',
    project: 'billing-api',
    dir: 'Developer/billing-api',
    agent: PI,
    summary: 'Drafted the rollout plan for the new invoice PDF renderer, behind the flag pdf_v2.',
    body: 'The new renderer goes to 5 percent of the accounts on Monday, then 50 percent on Wednesday, then all on Friday if the error rate stays under 0.1 percent. The rollback is a single flag flip, pdf_v2=false. Finance wants a sample of 20 invoices from each stage.',
  },
  // billing-api in the last 7 days, and one before them.
  {
    key: 'B1',
    day: -3,
    time: '11:00',
    project: 'billing-api',
    dir: 'Developer/billing-api',
    agent: CODEX,
    summary: 'Upgraded the Stripe SDK to v17 and removed the two shims that the old version needed.',
    body: 'v17 changes the error classes, so the retry code now checks the error code and not the class. All tests pass. The shims for the old pagination are gone.',
  },
  {
    key: 'B2',
    day: -5,
    time: '16:45',
    project: 'billing-api',
    dir: 'Developer/billing-api',
    agent: CLAUDE,
    summary:
      'The webhook signature check failed when the server clock was behind, so it now allows 5 minutes of clock skew.',
    body: 'Two servers had a clock that was 90 seconds behind after a restart. The signature check rejected every webhook from them. The tolerance is now 5 minutes, as the provider recommends, and NTP is on again on both servers.',
  },
  {
    key: 'B_OLD',
    day: -9,
    time: '10:00',
    project: 'billing-api',
    dir: 'Developer/billing-api',
    agent: CLAUDE,
    summary: 'Moved the invoices table to partitioned storage, one partition per quarter.',
    body: 'Queries for the current quarter now read one partition. The old quarters stay where they are, and a job moves them one at a time at night.',
  },
  // The README GIFs: one old attempt, and the last work on them.
  {
    key: 'G1',
    day: -40,
    time: '14:20',
    project: 'agent-journal',
    dir: 'Developer/agent-journal',
    agent: CLAUDE,
    summary: 'First attempt at the README GIFs with asciinema, but the result was too blurry to use.',
    body: 'asciinema with agg gives blurry text at the sizes GitHub shows. Tried two fonts and three sizes. Parked it until there is a better tool.',
  },
  {
    key: 'G2',
    day: -12,
    time: '21:05',
    project: 'agent-journal',
    dir: 'Developer/agent-journal',
    agent: CLAUDE,
    summary: 'Recorded the README GIFs again with vhs tapes, one for the light theme and one for the dark theme.',
    body: 'The tapes are in assets/tapes and run with one command. vhs gives sharp text, and the picture element picks the GIF for the theme of the reader. The old asciinema files are removed.',
  },
  // The Redis decision, only in a body, and an entry about Redis that is not the answer.
  {
    key: 'N1',
    day: -50,
    time: '13:30',
    project: 'nebula',
    dir: 'Developer/nebula',
    agent: CLAUDE,
    summary: 'Tuned the cache layer after the latency spikes of last week.',
    body: 'The spikes came from cache misses on the hot keys. We switched the Redis eviction policy from volatile-lru to allkeys-lfu, because the hot keys had no TTL, so volatile-lru never evicted them and evicted the short-lived keys instead. The p99 went from 480 ms to 120 ms. We kept maxmemory at 4 GB.',
  },
  {
    key: 'N2',
    day: -20,
    time: '09:50',
    project: 'nebula',
    dir: 'Developer/nebula',
    agent: CODEX,
    summary: 'The Redis connection pool ran out under load, so the maximum is 50 connections now.',
    body: 'The pool had a maximum of 10, and the batch import opened one connection for each worker. Raised it to 50 and added a metric for the pool size.',
  },
  // nebula: what did not work.
  {
    key: 'F1',
    day: -55,
    time: '15:00',
    project: 'nebula',
    dir: 'Developer/nebula',
    agent: CLAUDE,
    summary: 'Reverted the switch to HTTP/3 for the ingest API, because clients behind old proxies could not connect.',
    body: 'About 4 percent of the clients failed after the switch. The proxies of two large customers drop UDP. HTTP/3 stays off until there is a fallback that works.',
  },
  {
    key: 'F2',
    day: -44,
    time: '17:10',
    project: 'nebula',
    dir: 'Developer/nebula',
    agent: CODEX,
    summary:
      'Abandoned the plan to split the queue by tenant, because moving the tenants between partitions cost too much.',
    body: 'A test with 20 tenants needed 40 minutes to move them after a resize. The single queue with priorities stays.',
  },
  {
    key: 'F3',
    day: -33,
    time: '19:40',
    project: 'nebula',
    dir: 'Developer/nebula',
    agent: CLAUDE,
    summary: 'Rolled back the Postgres 17 upgrade after the query planner got slower on the reports query.',
    body: 'The reports query went from 2 seconds to 41 seconds with the new planner. The database is on 16 again. We will try again with the planner settings from the release notes.',
  },
  {
    key: 'F4',
    day: -26,
    time: '12:15',
    project: 'nebula',
    dir: 'Developer/nebula',
    agent: CLAUDE,
    summary: 'Tried protobuf for the event payloads and ruled it out: the payloads got less than 5 percent smaller.',
    body: 'The payloads are mostly short strings, and compression already removes most of the size. JSON stays, because every consumer can read it without generated code.',
  },
  {
    key: 'F5',
    day: -15,
    time: '18:00',
    project: 'nebula',
    dir: 'Developer/nebula',
    agent: CODEX,
    summary: 'Spent the day on the flaky ingest test, which fails about once in 30 runs.',
    body: 'The test waits for a message that sometimes comes after the timeout. A retry wrapper did not help and was removed again, because it only hid the race. The real fix needs the consumer to report when it is ready.',
  },
  // The busy day: an incident, among many long filler entries.
  {
    key: 'K1',
    day: -21,
    time: '09:05',
    project: 'nebula',
    dir: 'Developer/nebula',
    agent: CLAUDE,
    summary: 'Ingest API outage: every write failed with 503 from 08:40 on.',
    body: 'The load balancer marked every ingest node as down. The nodes themselves were healthy. Started the incident channel and paused the deploys.',
  },
  {
    key: 'K2',
    day: -21,
    time: '10:30',
    project: 'nebula',
    dir: 'Developer/nebula',
    agent: CLAUDE,
    summary:
      'Root cause of the ingest outage: the internal TLS certificate expired, because the renewal cron was turned off in June.',
    body: 'The health checks use the internal certificate, and it expired at 08:39. The renewal cron was turned off during the June migration and never turned on again. A new certificate brought the nodes back at 10:12.',
  },
  {
    key: 'K3',
    day: -21,
    time: '14:00',
    project: 'nebula',
    dir: 'Developer/nebula',
    agent: CLAUDE,
    summary: 'Rotated every internal certificate and added an alert 14 days before any certificate expires.',
    body: 'Found 3 more certificates that would expire within 2 months. All are new now. The alert goes to the on-call channel.',
  },
  {
    key: 'K4',
    day: -21,
    time: '18:30',
    project: 'nebula',
    dir: 'Developer/nebula',
    agent: CLAUDE,
    summary: 'Wrote the postmortem for the ingest outage and set the review for Monday.',
    body: 'The postmortem has the timeline, the root cause and 4 actions. The biggest action is to check every cron that a migration turns off.',
  },
];

/** The entries of the years before that the cases ask about. */
const OLD_KEYS: Array<Entry> = [
  // The login of acme-dashboard over three years.
  {
    key: 'A1',
    day: -1010,
    time: '11:20',
    project: 'acme-dashboard',
    dir: 'Developer/acme-dashboard',
    agent: 'claude/claude-opus-4-1',
    summary:
      'Replaced the cookie login of the dashboard with JWT access tokens, so that the mobile app can call the same API.',
    body: 'The dashboard and the mobile app now get a JWT from the same login endpoint. The token lives 30 days and is checked without a database call. The old cookie login stays for one release for the users who are still logged in.',
  },
  {
    key: 'A2',
    day: -640,
    time: '16:05',
    project: 'acme-dashboard',
    dir: 'Developer/acme-dashboard',
    agent: 'claude/claude-opus-4-5',
    summary:
      'Short-lived access tokens with refresh token rotation now, because a stolen token stayed valid for 30 days.',
    body: 'Access tokens live 15 minutes. Each refresh gives a new refresh token and makes the old one invalid, and a reuse of an old one logs out every device of that user. The security review asked for it after the laptop theft in support.',
  },
  {
    key: 'A3',
    day: -300,
    time: '10:40',
    project: 'acme-dashboard',
    dir: 'Developer/acme-dashboard',
    agent: 'claude/claude-opus-5',
    summary:
      'Moved the login back from JWT to server-side sessions, because logging a user out at once needed a deny list anyway.',
    body: 'Every request checked the deny list, so the JWT saved no database call any more. The sessions are rows in the database now, with an id in a secure cookie. The mobile app sends the same id in a header. About 300 lines of token code are gone.',
  },
  // The analytics store, decided long ago. The summary does not name the database.
  {
    key: 'C1',
    day: -700,
    time: '17:30',
    project: 'nebula',
    dir: 'Developer/nebula',
    agent: 'claude/claude-opus-4-5',
    summary: 'Picked the store for the analytics events after a week of benchmarks with the real event stream.',
    body: 'ClickHouse won over TimescaleDB. With the same 90 days of events, ClickHouse kept them in 38 GB and TimescaleDB in 410 GB, and the dashboard queries ran 6 to 20 times faster. TimescaleDB was better at the few joins we need, but we can do those in the API. The team knows SQL, so both were fine for the queries.',
  },
  {
    key: 'C2',
    day: -200,
    time: '14:10',
    project: 'nebula',
    dir: 'Developer/nebula',
    agent: CLAUDE,
    summary: 'The analytics store keeps the raw events for 13 months now, and older events only as daily rollups.',
    body: 'The disk grew by 40 GB a month. The rollups keep what the dashboards need. The raw events of a month go away on the first day of the 14th month.',
  },
  // spellbee: the first entry of the project, and the last one.
  {
    key: 'S1',
    day: -820,
    time: '20:15',
    project: 'spellbee',
    dir: 'Developer/spellbee',
    agent: 'claude/claude-opus-4-1',
    summary: 'Set up spellbee, a small spelling game for kids, as a static site with one page and a word list.',
    body: 'The idea came from the school homework: the kids get 10 words a week. The game reads them aloud with the speech API of the browser, and the kid types them. No backend for now, the word list is a JSON file.',
  },
  {
    key: 'S_END',
    day: -150,
    time: '19:00',
    project: 'spellbee',
    dir: 'Developer/spellbee',
    agent: CLAUDE,
    summary:
      'Archived spellbee: the kids use the school app now, so the repository is read-only and the site stays up as it is.',
    body: 'Moved the domain to the static hosting of the archive account. Nothing runs that needs care.',
  },
  // billing-api, three things in one month more than a year ago.
  {
    key: 'M1',
    day: 0,
    at: { month: -16, date: 4 },
    time: '10:30',
    project: 'billing-api',
    dir: 'Developer/billing-api',
    agent: 'codex/gpt-5',
    summary:
      'Moved the transactional emails of billing-api to Postmark, because the old provider put a third of them into spam.',
    body: 'The receipts and the payment reminders go through Postmark now, with a separate stream for each. The bounce rate went from 31 to 2 percent in the first week.',
  },
  {
    key: 'M2',
    day: 0,
    at: { month: -16, date: 13 },
    time: '15:45',
    project: 'billing-api',
    dir: 'Developer/billing-api',
    agent: 'claude/claude-opus-4-5',
    summary: 'Added SEPA direct debit as a payment method for the customers in the EU.',
    body: 'The mandate is signed in the checkout. A debit takes up to 5 work days, so the account stays active while it is pending, and a failed debit starts the reminder emails.',
  },
  {
    key: 'M3',
    day: 0,
    at: { month: -16, date: 22 },
    time: '11:10',
    project: 'billing-api',
    dir: 'Developer/billing-api',
    agent: 'claude/claude-opus-4-5',
    summary: 'Fixed the currency rounding of the totals: each line now rounds half to even, as the accountants asked.',
    body: 'The totals were 1 cent off on about 1 in 400 bills, because each line rounded half up and the sum of the lines did not match the tax report. The accountants use half to even, so we do too.',
  },
];

/** A slot of the filler: when and where an entry is, without its text. */
export type Slot = Omit<Entry, 'key' | 'summary' | 'body' | 'at'> & {
  /** The name of the content file that has its text. */
  name: string;
  /** About how many sentences its body has. */
  sentences: number;
};

/** The text of one filler entry, as the content file has it. */
export type Content = {
  summary: string;
  body: string;
  /** The worktree that the session ran in, one of the branches of its project. */
  branch?: string;
};

/**
 * What the filler must not say, so that each case still has one right
 * answer. A rule applies to every slot that it does not allow.
 */
export type Rule = {
  pattern: RegExp;
  /** The words of the rule, for the writer of the content. */
  words: string;
  isAllowed?: (slot: Slot) => boolean;
  why: string;
};

export const RULES: Array<Rule> = [
  {
    pattern: /kubernetes|\bk8s\b|\bk3s\b|autoscal/i,
    words: 'Kubernetes, k8s, k3s, autoscaling',
    why: 'Nothing in the journal is about Kubernetes autoscaling.',
  },
  {
    pattern: /evict|allkeys|volatile-lru/i,
    words: 'eviction, an eviction policy, allkeys or volatile-lru',
    why: 'One entry has the decision about the Redis eviction policy.',
  },
  {
    pattern: /\bjwt|json web token/i,
    words: 'JWT, JSON web tokens',
    isAllowed: (slot) => slot.project === 'acme-dashboard' && slot.day >= -1010,
    why: 'acme-dashboard switched to JWT on day -1010, and no project used JWT before.',
  },
  {
    pattern: /clickhouse/i,
    words: 'ClickHouse',
    isAllowed: (slot) => slot.project === 'nebula' && slot.day >= -710,
    why: 'nebula picked ClickHouse on day -700, after a week of benchmarks.',
  },
  {
    pattern: /timescale/i,
    words: 'TimescaleDB',
    isAllowed: (slot) => slot.project === 'nebula' && slot.day >= -710 && slot.day < -700,
    why: 'TimescaleDB was only the other side of the benchmarks.',
  },
  {
    pattern: /\bgifs?\b|\bvhs\b|asciinema/i,
    words: 'GIF, vhs, asciinema',
    isAllowed: (slot) => slot.project === 'agent-journal' && slot.day < -12,
    why: 'The README GIFs of agent-journal were last recorded on day -12.',
  },
  {
    pattern: /\btapes?\b/i,
    words: 'tape, tapes',
    isAllowed: (slot) => slot.project !== 'agent-journal' || slot.day < -12,
    why: 'The README GIFs of agent-journal were last recorded on day -12, from vhs tapes.',
  },
  {
    pattern: /http\/3|protobuf|retry wrapper/i,
    words: 'HTTP/3, protobuf, a retry wrapper',
    why: 'Each is one of the failed attempts that a case asks about.',
  },
  {
    pattern:
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december)\b|\b20[12]\d\b/i,
    words: 'names of weekdays or months, and years such as 2024',
    why: 'The entries move to other dates on each run, so a weekday, a month or a year in the text would be wrong.',
  },
];

/** The rules that a slot breaks with this text. */
export function brokenRules(slot: Slot, text: string): Array<Rule> {
  return RULES.filter((rule) => rule.pattern.test(text) && !rule.isAllowed?.(slot));
}

/** A small seeded generator (mulberry32), so the schedule is the same each time. */
function rng(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export type Project = {
  project?: string;
  /** The name of its content file and of its description, in the content folder. */
  name: string;
  dir: string;
  weight: number;
  /** The first and the last day with filler. */
  from: number;
  to: number;
  /** The branches of its worktrees. */
  branches?: Array<string>;
};

export const PROJECTS: Array<Project> = [
  {
    project: 'nebula',
    name: 'nebula',
    dir: 'Developer/nebula',
    weight: 6,
    from: -1095,
    to: -2,
    branches: ['ingest-batching', 'search-v2', 'audit-export', 'rate-limits', 'schema-registry', 'loader-retry'],
  },
  {
    project: 'acme-dashboard',
    name: 'acme-dashboard',
    dir: 'Developer/acme-dashboard',
    weight: 3,
    from: -1095,
    to: -2,
    branches: ['new-charts', 'table-v3', 'onboarding'],
  },
  { project: 'billing-api', name: 'billing-api', dir: 'Developer/billing-api', weight: 2, from: -900, to: -2 },
  { project: 'agent-journal', name: 'agent-journal', dir: 'Developer/agent-journal', weight: 2, from: -220, to: -2 },
  { project: 'spellbee', name: 'spellbee', dir: 'Developer/spellbee', weight: 2, from: -819, to: -151 },
  { project: 'homelab', name: 'homelab', dir: 'homelab', weight: 1, from: -1050, to: -2 },
  { project: 'chunkdown', name: 'chunkdown', dir: 'Developer/oss/chunkdown', weight: 1, from: -520, to: -2 },
  { project: 'ai-retry', name: 'ai-retry', dir: 'Developer/oss/ai-retry', weight: 1, from: -330, to: -2 },
  { project: 'blog', name: 'blog', dir: 'Developer/blog', weight: 1, from: -1095, to: -380 },
  { name: 'dotfiles', dir: 'dotfiles', weight: 1, from: -1095, to: -2 },
];

/** Entries per work day, by how long ago the day is: the use of the journal grows. */
function rate(day: number): [number, number] {
  if (day < -730) return [1, 5];
  if (day < -365) return [3, 9];
  if (day < -180) return [5, 14];
  return [8, 26];
}

/** The agents that wrote entries in each period, as their models were then. */
function agents(day: number): Array<string> {
  if (day < -730) return ['claude/claude-opus-4-1', 'claude/claude-opus-4-1', 'codex/gpt-5'];
  if (day < -365) return ['claude/claude-opus-4-5', 'claude/claude-opus-4-5', 'codex/gpt-5'];
  if (day < -180) return ['claude/claude-opus-5', 'claude/claude-opus-5', 'codex/gpt-5.5'];
  return [CLAUDE, CLAUDE, CLAUDE, CODEX, PI];
}

const time = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const order = <ITEM extends { day: number; time: string }>(a: ITEM, b: ITEM) =>
  a.day - b.day || a.time.localeCompare(b.time);

let slots: Array<Slot> | null = null;

/**
 * The slots of the filler from three years ago to the day before yesterday,
 * in time order. Yesterday and today have only key entries. The same on each
 * call, because the seed is fixed: a change here moves the text of the
 * content files to other slots.
 */
export function buildSlots(): Array<Slot> {
  if (slots) return slots;
  const random = rng(20_261_026);
  const pick = <T>(items: ReadonlyArray<T>): T => items[Math.floor(random() * items.length)]!;
  const between = (low: number, high: number): number => low + Math.floor(random() * (high - low + 1));

  function weighted(projects: Array<Project>): Project {
    const total = projects.reduce((sum, item) => sum + item.weight, 0);
    let roll = random() * total;
    for (const item of projects) {
      roll -= item.weight;
      if (roll <= 0) return item;
    }
    return projects.at(-1)!;
  }

  const made: Array<Slot> = [];
  for (let day = -1095; day <= -2; day++) {
    const isBusy = day === -21;
    /** About two days in seven have no work. */
    if (!isBusy && random() < 0.28) continue;
    const [low, high] = rate(day);
    const count = isBusy ? 36 : between(low, high);
    for (let index = 0; index < count; index++) {
      /** billing-api has no filler in its last 10 days, so a case knows every entry of those days. */
      const projects = PROJECTS.filter(
        (item) =>
          day >= item.from &&
          day <= item.to &&
          (isBusy ? item.project === 'nebula' : !(day >= -10 && item.project === 'billing-api')),
      );
      const project = weighted(projects);
      /** Work days from 08:00 to 22:59, so no filler is near midnight. */
      const minutes = 8 * 60 + Math.floor(random() * 15 * 60);
      made.push({
        day,
        time: time(minutes),
        ...(project.project ? { project: project.project } : {}),
        name: project.name,
        dir: project.dir,
        agent: pick(agents(day)),
        sentences: isBusy ? between(24, 36) : between(8, 22),
      });
    }
  }
  slots = made.sort(order);
  return slots;
}

/** The entries that the cases ask about, written by hand. */
export function keyEntries(): Array<Entry> {
  return [...KEYS, ...OLD_KEYS];
}

const CONTENT = new URL('content/', import.meta.url);

/** The text of every filler entry of one content file, in time order. */
export function readContent(name: string): Array<Content> {
  return readFileSync(new URL(`${name}.jsonl`, CONTENT), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Content);
}

let built: Array<Entry> | null = null;

/**
 * Every entry, the key entries and the filler, in the order of their days.
 * The n-th slot of a project gets the n-th line of its content file.
 */
export function buildEntries(): Array<Entry> {
  if (built) return built;
  const filler: Array<Entry> = [];
  for (const project of PROJECTS) {
    const own = buildSlots().filter((slot) => slot.name === project.name);
    const texts = readContent(project.name);
    if (texts.length !== own.length) {
      throw new Error(`content/${project.name}.jsonl has ${texts.length} entries, but the schedule has ${own.length}`);
    }
    own.forEach(({ name: _name, sentences: _sentences, ...slot }, index) => {
      const { summary, body, branch } = texts[index]!;
      const broken = brokenRules(own[index]!, `${summary}\n${body}`);
      if (broken.length > 0) {
        throw new Error(`content/${project.name}.jsonl line ${index + 1} names ${broken[0]!.words}: ${broken[0]!.why}`);
      }
      if (branch && !project.branches?.includes(branch)) {
        throw new Error(`content/${project.name}.jsonl line ${index + 1} has the unknown branch "${branch}"`);
      }
      filler.push({ ...slot, ...(branch ? { dir: `${project.dir}.worktrees/${branch}` } : {}), summary, body });
    });
  }
  built = [...KEYS, ...OLD_KEYS, ...filler].sort(order);
  return built;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const entries = buildEntries();
  const chars = entries.reduce((sum, entry) => sum + entry.summary.length + entry.body.length, 0);
  console.log(
    `${entries.length} entries, ${KEYS.length + OLD_KEYS.length} of them key entries, ${(chars / 1e6).toFixed(1)} million characters of text`,
  );
}
