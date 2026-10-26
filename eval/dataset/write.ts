/**
 * Writes the text of the filler: one content file for each project, with one
 * entry for each slot of the schedule. A model writes the entries through Pi,
 * a few at a time and in time order, from the description of the project in
 * the content folder, so that the entries of a project tell one story over
 * the years. Each batch is checked against the rules of the dataset and
 * written again when it breaks one.
 *
 *   node eval/dataset/write.ts [--model anthropic/claude-sonnet-5-5] [--only nebula] [--lanes 16] [--pilot]
 *
 * The content is written once and kept in git; this runs again only when the
 * schedule or a description changes. Each finished batch is kept in a cache
 * folder, so a run that stops can go on where it stopped. `--pilot` writes
 * only the first batch of each project and prints it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { buildSlots, keyEntries, PROJECTS, RULES, type Content, type Slot } from './generate.ts';
import { callPi, CONTENT, jsonArray, pool, problems, spent } from './model.ts';

const { values: options } = parseArgs({
  options: {
    model: { type: 'string', default: 'anthropic/claude-sonnet-5-5' },
    only: { type: 'string' },
    lanes: { type: 'string', default: '16' },
    pilot: { type: 'boolean', default: false },
    cache: { type: 'string', default: 'eval/results/write-cache' },
  },
});

/** The slots of one lane: the lanes of a project run side by side, and the batches of a lane one after the other. */
const LANE_SLOTS = 200;
/** A batch ends at this many slots or this many sentences, whichever comes first. */
const BATCH_SLOTS = 25;
const BATCH_SENTENCES = 360;
const ATTEMPTS = 8;
/** The summaries of the entries before a batch that its prompt shows. */
const CONTEXT = 30;

mkdirSync(options.cache, { recursive: true });

const SYSTEM = `You write synthetic entries for the test dataset of agent-journal, a journal that coding agents write after each piece of work. A model under test will later search these entries to answer questions about past work, so they must read like the real journal of a real developer and their agents over several years.

How a real entry reads:
- The summary is one sentence of about 80 to 180 characters, never more than 200, that stands on its own: what happened and what it means. Not a topic tag. "Fixed the auth bug" is a tag; "Token refresh raced the retry and logged users out, so it is serialized behind a mutex now" is a summary.
- The body says what was done, why, what was found, the numbers, file names, commands and error messages that matter, what is left and what comes next. Past tense for what happened. Plain paragraphs of 2 to 5 sentences; a short list now and then is fine. No headings, no front matter, no Markdown title.
- Entries are about real, specific work that fits the project and its period: a bug and its cause, a feature step, a review, an upgrade, a question that the user asked and its answer, a plan, a failed attempt. Some are small, some are large.
- The work of a project goes on over days and weeks: a topic starts, has several steps over several entries, and ends. Later entries refer back to earlier work where it is natural ("the loader change of last week"). Several sessions on one day can work on different topics.
- Vary the wording. Do not start every summary or body the same way.

Rules:
- Time only in relative words, such as "yesterday", "last week" or "two months ago", or as a time of day. Never a weekday, a month, a year or a date, and never "day -123": the dates of the entries change with each run.
- Keep to the people, the tools and the timeline of the project description. Do not invent other team members.
- The key entries of the project are already written. Do not write them again and do not contradict them; after a key entry, its result is part of the project.
- Before the day of a key entry, its change has not happened. An entry before it may describe the problem that leads to it, discuss options, or plan it, but it never does, tests in production, releases, deploys, switches or finishes that change, and it never refers to it as done. The key entry is the one place where the change happens.
- Some words must not appear, so that each question of the test has one right answer. The prompt lists them.
- Answer with a JSON array only, no text around it.`;

type Lane = { name: string; slots: Array<Slot>; first: number };

function batches(slots: Array<Slot>): Array<Array<Slot>> {
  const result: Array<Array<Slot>> = [];
  let current: Array<Slot> = [];
  let sentences = 0;
  for (const slot of slots) {
    if (current.length > 0 && (current.length >= BATCH_SLOTS || sentences + slot.sentences > BATCH_SENTENCES)) {
      result.push(current);
      current = [];
      sentences = 0;
    }
    current.push(slot);
    sentences += slot.sentences;
  }
  if (current.length > 0) result.push(current);
  return result;
}

function forbidden(slot: Slot): Array<string> {
  return RULES.filter((rule) => !rule.isAllowed?.(slot)).map((rule) => rule.words);
}

/**
 * The prompt for the slots of a batch that are still open. `done` has the
 * entries of the batch that are already written, by their index.
 */
function prompt(
  name: string,
  batch: Array<Slot>,
  before: Array<string>,
  isLaneStart: boolean,
  done: Map<number, Content>,
  feedback: Array<string>,
): string {
  const project = PROJECTS.find((item) => item.name === name)!;
  const keys = keyEntries().filter((entry) => (entry.project ?? 'dotfiles') === name);
  const from = batch[0]!.day;
  const to = batch.at(-1)!.day;
  const near = keys.filter((entry) => entry.day >= from - 14 && entry.day <= to + 14);
  const common = forbidden(batch[0]!).filter((words) => batch.every((slot) => forbidden(slot).includes(words)));
  const open = batch.map((slot, index) => ({ slot, index })).filter(({ index }) => !done.has(index));
  const lines = open.map(({ slot, index }) => {
    const extra = forbidden(slot).filter((words) => !common.includes(words));
    return `slot ${index + 1}: day ${slot.day}, ${slot.time}, about ${slot.sentences} sentences${extra.length > 0 ? `; must also not name: ${extra.join('; ')}` : ''}`;
  });
  const written = [...done].sort(([a], [b]) => a - b).map(([index, item]) => `slot ${index + 1}: ${item.summary}`);
  const branches = project.branches
    ? `Set "branch" to one of ${project.branches.join(', ')} only when the session works on the topic of that branch in its period; leave it out otherwise.`
    : 'Leave "branch" out.';
  return [
    readFileSync(new URL(`${name}.md`, CONTENT), 'utf8').trim(),
    '# The key entries of this project, already written',
    keys
      .map(
        (entry) =>
          `- day ${entry.day}, ${entry.time}: ${entry.summary}${entry.day > from ? ' (not yet happened at the start of this batch: before its day, its change is not done)' : ''}`,
      )
      .join('\n') || '(none)',
    ...(near.length > 0
      ? [
          'Close to this batch, in full:',
          near.map((entry) => `- day ${entry.day}: ${entry.summary}\n  ${entry.body}`).join('\n'),
        ]
      : []),
    '# What came just before',
    before.length > 0
      ? `The summaries of the last entries of this project before this batch, oldest first:\n${before.join('\n')}`
      : isLaneStart && from > project.from
        ? 'Earlier entries of this project exist but are not shown. Continue the timeline of the description from this point.'
        : 'These are the first entries of the project.',
    ...(written.length > 0 ? ['# Already written in this batch', written.join('\n')] : []),
    '# Write these entries',
    `Days are relative to today (day -1 is yesterday). One entry for each of these ${open.length} slots:\n${lines.join('\n')}`,
    `In all of these entries, never name: ${common.join('; ')}.`,
    ...(feedback.length > 0
      ? [`Your last answer had these problems:\n${feedback.map((item) => `- ${item}`).join('\n')}`]
      : []),
    `Answer with a JSON array of ${open.length} objects, one for each slot above, in its order: {"slot": <its number>, "summary": "...", "body": "...", "branch": "..."}. ${branches}`,
  ].join('\n\n');
}

/** Writes one batch, and asks again for the slots that are missing or wrong, until all are right. */
async function writeBatch(
  name: string,
  batch: Array<Slot>,
  first: number,
  before: Array<string>,
  isLaneStart: boolean,
) {
  const file = join(options.cache, `${name}-${String(first).padStart(5, '0')}-${batch.length}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Array<Content>;
  const done = new Map<number, Content>();
  let feedback: Array<string> = [];
  for (let attempt = 1; attempt <= ATTEMPTS && done.size < batch.length; attempt++) {
    let text: string;
    try {
      text = await callPi(options.model, SYSTEM, prompt(name, batch, before, isLaneStart, done, feedback));
    } catch (error) {
      console.log(`  ${name} #${first} attempt ${attempt} failed: ${(error as Error).message}`);
      continue;
    }
    feedback = [];
    let items: Array<Content & { slot: number }>;
    try {
      items = jsonArray<Content & { slot: number }>(text).map(({ slot, summary, body, branch }) => ({
        slot: Number(slot),
        summary: summary?.trim(),
        body: body?.trim(),
        ...(branch ? { branch } : {}),
      }));
    } catch (error) {
      feedback = [`The answer was not a valid JSON array (${(error as Error).message}).`];
      continue;
    }
    for (const { slot, ...item } of items) {
      const index = slot - 1;
      if (!batch[index] || done.has(index)) continue;
      const found = problems(batch[index], item, `Slot ${slot}`);
      if (found.length === 0) done.set(index, item);
      else feedback.push(...found);
    }
    const missing = batch.map((_, index) => index).filter((index) => !done.has(index));
    if (missing.length > 0) {
      console.log(
        `  ${name} #${first} attempt ${attempt}: ${missing.length} of ${batch.length} slots still open. ${feedback.join(' ')}`,
      );
    }
  }
  if (done.size < batch.length) throw new Error(`${name} #${first}: slots still open after ${ATTEMPTS} attempts`);
  const items = batch.map((_, index) => done.get(index)!);
  writeFileSync(file, JSON.stringify(items, null, 1));
  return items;
}

/** The entries of a lane, or null when a batch failed; the other lanes go on, and a new run continues from the cache. */
async function runLane(lane: Lane): Promise<Array<Content> | null> {
  try {
    return await writeLane(lane);
  } catch (error) {
    console.log(`${lane.name} lane at ${lane.first} stopped: ${(error as Error).message}`);
    return null;
  }
}

async function writeLane(lane: Lane): Promise<Array<Content>> {
  const written: Array<Content> = [];
  const summaries: Array<string> = [];
  let index = lane.first;
  const all = batches(lane.slots);
  for (const [number, batch] of (options.pilot ? all.slice(0, 1) : all).entries()) {
    const items = await writeBatch(lane.name, batch, index, summaries.slice(-CONTEXT), number === 0);
    items.forEach((item, offset) =>
      summaries.push(`- day ${batch[offset]!.day}, ${batch[offset]!.time}: ${item.summary}`),
    );
    written.push(...items);
    index += batch.length;
    console.log(`${lane.name} ${index}/${lane.first + lane.slots.length} written, $${spent.cost.toFixed(2)} so far`);
  }
  return written;
}

const names = PROJECTS.map((project) => project.name).filter((name) => !options.only || name === options.only);
const planned: Array<Lane> = names.flatMap((name) => {
  const slots = buildSlots().filter((slot) => slot.name === name);
  const count = Math.max(1, Math.round(slots.length / LANE_SLOTS));
  const size = Math.ceil(slots.length / count);
  return Array.from({ length: count }, (_, index) => ({
    name,
    slots: slots.slice(index * size, (index + 1) * size),
    first: index * size,
  })).filter((lane) => lane.slots.length > 0);
});
/** A pilot writes only the start of each project. */
const lanes = options.pilot ? planned.filter((lane) => lane.first === 0) : planned;

console.log(`${lanes.length} lanes, ${options.model}, cache in ${options.cache}`);
/** The biggest lanes first, so the run does not wait for one long lane at the end. */
const order = lanes.map((lane, index) => ({ lane, index })).sort((a, b) => b.lane.slots.length - a.lane.slots.length);
const results = await pool(
  order.map(
    ({ lane }) =>
      () =>
        runLane(lane),
  ),
  Number(options.lanes),
);
const byLane = new Map(order.map(({ lane }, index) => [lane, results[index]!]));

if (options.pilot) {
  for (const lane of lanes.filter((item) => item.first === 0)) {
    console.log(`\n## ${lane.name}\n`);
    for (const item of (byLane.get(lane) ?? []).slice(0, 3)) console.log(`${item.summary}\n${item.body}\n`);
  }
} else {
  for (const name of names) {
    const own = lanes.filter((lane) => lane.name === name).map((lane) => byLane.get(lane));
    if (own.some((items) => !items)) {
      process.exitCode = 1;
      console.log(`${name}: not complete, run again to continue`);
      continue;
    }
    const items = own.flatMap((lane) => lane!);
    writeFileSync(new URL(`${name}.jsonl`, CONTENT), `${items.map((item) => JSON.stringify(item)).join('\n')}\n`);
  }
}
console.log(`\nDone: $${spent.cost.toFixed(2)}, ${spent.input} input tokens, ${spent.output} output tokens`);
