/**
 * Finds filler entries that tell a key change before its day, and writes
 * them again. A key entry is the one place where its change happens: an
 * entry before it may plan the change, but never do it. The writer sees the
 * key entries and sometimes writes the work toward one all the way to the
 * result, which gives a case two answers.
 *
 *   node eval/dataset/check.ts [--model anthropic/claude-sonnet-5-5] [--only acme-dashboard] [--lanes 8] [--dry]
 *
 * A model reads the filler of each project with its key entries and names
 * the entries that do a key change too early. Each of them is written again
 * from its neighbours, and the content file is updated. `--dry` only lists
 * them. Run it after write.ts, and again until it finds nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { buildSlots, dayOf, keyEntries, PROJECTS, readContent, RULES, type Content, type Slot } from './generate.ts';
import { callPi, CONTENT, jsonArray, pool, problems, spent } from './model.ts';

const { values: options } = parseArgs({
  options: {
    model: { type: 'string', default: 'anthropic/claude-sonnet-5-5' },
    only: { type: 'string' },
    lanes: { type: 'string', default: '8' },
    dry: { type: 'boolean', default: false },
  },
});

const CHUNK = 40;
const ATTEMPTS = 4;

type Key = { key: string; day: number; summary: string; body: string };
type Item = { index: number; slot: Slot; content: Content };
type Conflict = { item: Item; keys: Array<Key>; why: string };

const JUDGE = `You check a synthetic developer journal for one kind of mistake. Each project has key entries: each records a change on its day, and that day is the one place where the change happens. A filler entry before that day may describe the problem that leads to the change, discuss options, plan it or prepare it. It is a mistake when a filler entry before the day does the change itself, releases, deploys, enables, switches to or finishes it, or refers to it as already done. Work on the same topic that is not that change is not a mistake. Answer with a JSON array only.`;

function judgePrompt(keys: Array<Key>, items: Array<Item>): string {
  return [
    '# Key entries',
    keys.map((key) => `[${key.key}] day ${key.day}: ${key.summary}\n${key.body}`).join('\n\n'),
    '# Filler entries',
    items
      .map((item) => `<entry ${item.index}> day ${item.slot.day}: ${item.content.summary}\n${item.content.body}`)
      .join('\n\n'),
    '# Task',
    'List each filler entry that does or assumes a key change before the day of that key entry. Answer with a JSON array, empty when there is none: [{"entry": <number>, "keys": ["<key name>"], "why": "<one sentence>"}].',
  ].join('\n\n');
}

async function judge(keys: Array<Key>, items: Array<Item>): Promise<Array<Conflict>> {
  const open = keys.filter((key) => key.day > items[0]!.slot.day);
  if (open.length === 0) return [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const found = jsonArray<{ entry: number; keys: Array<string>; why: string }>(
        await callPi(options.model, JUDGE, judgePrompt(open, items)),
      );
      return found.flatMap(({ entry, keys: names, why }) => {
        const item = items.find((candidate) => candidate.index === Number(entry));
        /** Only a key that is still to come at the day of the entry counts. */
        const late = open.filter((key) => names?.includes(key.key) && item && key.day > item.slot.day);
        return item && late.length > 0 ? [{ item, keys: late, why }] : [];
      });
    } catch (error) {
      console.log(`  judge attempt ${attempt} failed: ${(error as Error).message}`);
    }
  }
  throw new Error('the judge gave no valid answer');
}

const REWRITE = `You rewrite one entry of a synthetic developer journal that tells a change before its day. Keep the project, the people, the period and about the same length, and keep the style: a summary of one sentence that stands on its own, and a body of plain paragraphs in the past tense with specific details. At the day of the entry, the change of the named key entry has not happened: the new entry may plan it, prepare it or investigate the problem, or be about other work of that period, but it must not do, release, deploy, enable or finish the change, and must not refer to it as done. Time only in relative words, never a weekday, a month, a year or a day number. Answer with a JSON array of one object only.`;

function rewritePrompt(name: string, conflict: Conflict, all: Array<Item>, feedback: Array<string>): string {
  const { item } = conflict;
  const near = all.filter((other) => Math.abs(other.index - item.index) <= 6 && other.index !== item.index);
  const forbidden = RULES.filter((rule) => !rule.isAllowed?.(item.slot)).map((rule) => rule.words);
  return [
    readFileSync(new URL(`${name}.md`, CONTENT), 'utf8').trim(),
    '# The key entry that this entry tells too early',
    conflict.keys.map((key) => `[${key.key}] day ${key.day}: ${key.summary}\n${key.body}`).join('\n\n'),
    `Why it is a mistake: ${conflict.why}`,
    '# The entries around it, oldest first',
    near.map((other) => `- day ${other.slot.day}: ${other.content.summary}`).join('\n'),
    '# The entry to rewrite',
    `day ${item.slot.day}, ${item.slot.time}, about ${item.slot.sentences} sentences\n${item.content.summary}\n${item.content.body}`,
    `Never name: ${forbidden.join('; ')}.`,
    ...(feedback.length > 0
      ? [`Your last answer had these problems:\n${feedback.map((line) => `- ${line}`).join('\n')}`]
      : []),
    'Answer with [{"summary": "...", "body": "..."}].',
  ].join('\n\n');
}

async function rewrite(name: string, conflict: Conflict, all: Array<Item>): Promise<Content> {
  let feedback: Array<string> = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const [reply] = jsonArray<Content>(
        await callPi(options.model, REWRITE, rewritePrompt(name, conflict, all, feedback)),
      );
      const content: Content = {
        summary: reply?.summary?.trim(),
        body: reply?.body?.trim(),
        ...(conflict.item.content.branch ? { branch: conflict.item.content.branch } : {}),
      } as Content;
      feedback = problems(conflict.item.slot, content, 'The entry');
      if (feedback.length === 0) return content;
    } catch (error) {
      feedback = [`The answer was not a valid JSON array (${(error as Error).message}).`];
    }
  }
  throw new Error(`${name} entry ${conflict.item.index}: no valid rewrite after ${ATTEMPTS} attempts`);
}

const now = new Date();
const names = PROJECTS.map((project) => project.name).filter((name) => !options.only || name === options.only);
let total = 0;
for (const name of names) {
  const keys: Array<Key> = keyEntries()
    .filter((entry) => (entry.project ?? 'dotfiles') === name)
    .map((entry) => ({ key: entry.key!, day: dayOf(entry, now), summary: entry.summary, body: entry.body }));
  if (keys.length === 0) continue;
  const slots = buildSlots().filter((slot) => slot.name === name);
  const texts = readContent(name);
  const last = Math.max(...keys.map((key) => key.day));
  const items: Array<Item> = slots.map((slot, index) => ({ index, slot, content: texts[index]! }));
  const checked = items.filter((item) => item.slot.day < last);
  const chunks = Array.from({ length: Math.ceil(checked.length / CHUNK) }, (_, index) =>
    checked.slice(index * CHUNK, (index + 1) * CHUNK),
  );
  const conflicts = (
    await pool(
      chunks.map((chunk) => () => judge(keys, chunk)),
      Number(options.lanes),
    )
  ).flat();
  total += conflicts.length;
  console.log(`\n${name}: ${conflicts.length} entries tell a key change too early ($${spent.cost.toFixed(2)} so far)`);
  for (const conflict of conflicts) {
    console.log(
      `  ${conflict.item.slot.day} [${conflict.keys.map((key) => key.key).join(', ')}] ${conflict.item.content.summary.slice(0, 120)}`,
    );
    console.log(`     ${conflict.why}`);
  }
  if (options.dry || conflicts.length === 0) continue;
  const rewritten = await pool(
    conflicts.map((conflict) => () => rewrite(name, conflict, items)),
    Number(options.lanes),
  );
  conflicts.forEach((conflict, index) => (texts[conflict.item.index] = rewritten[index]!));
  writeFileSync(new URL(`${name}.jsonl`, CONTENT), `${texts.map((item) => JSON.stringify(item)).join('\n')}\n`);
  console.log(`${name}: ${conflicts.length} entries written again`);
}
console.log(`\nDone: ${total} entries, $${spent.cost.toFixed(2)}`);
