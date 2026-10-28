/**
 * Compares the runs in one or more results folders: per model and mode, and
 * per case, with the mean of the repeats.
 *
 *   node eval/report.ts eval/results/<run> [eval/results/<run> ...] [--details]
 *
 * `--details` adds the failed checks and the tools that each session used.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Record_ = {
  case: string;
  mode: string;
  model: string;
  score: number;
  checks: Array<{ name: string; isPassed: boolean; isScored?: boolean }>;
  toolCalls: Array<{ name: string; outChars: number; isError: boolean }>;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  durationMs: number;
  refused?: number;
  error?: string;
};

const args = process.argv.slice(2);
const isDetailed = args.includes('--details');
const dirs = args.filter((arg) => !arg.startsWith('--'));
if (dirs.length === 0) throw new Error('usage: node eval/report.ts <results folder>... [--details]');

const all = dirs.flatMap((dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record_),
);
/** A session whose run failed, such as a model call that the provider refused, says nothing about the model, so it does not count. */
const records = all.filter((record) => !record.error);
const failed = all.filter((record) => record.error);

const mean = (values: Array<number>): number => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const unique = (values: Array<string>): Array<string> => [...new Set(values)];
const modelName = (model: string): string =>
  model
    .split('/')
    .at(-1)!
    .replace(/^claude-/, '');
const modes = unique(all.map((record) => record.mode)).sort((a, b) => b.localeCompare(a));
const models = unique(all.map((record) => record.model)).sort();
const cases = unique(all.map((record) => record.case));

type Row = {
  score: number;
  calls: number;
  loads: number;
  refused: number;
  out: number;
  input: number;
  cost: number;
  seconds: number;
  n: number;
};

/** The sample variance, 0 for fewer than two values. */
function variance(values: Array<number>): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
}

/**
 * The standard error of a mean score that only comes from running each case
 * again: the cases are the same in every run, so the spread of the repeats of
 * each case is the noise. The mean gives each session the same weight.
 */
function noiseOf(items: Array<Record_>): number {
  const byCase = new Map<string, Array<number>>();
  for (const item of items) byCase.set(item.case, [...(byCase.get(item.case) ?? []), item.score]);
  const total = items.length;
  let sum = 0;
  for (const scores of byCase.values()) sum += (scores.length / total) ** 2 * (variance(scores) / scores.length);
  return Math.sqrt(sum);
}

/** The half-width of a 95% interval for a standard error. */
const interval = (error: number): string => `±${(1.96 * error).toFixed(2)}`;

function summary(items: Array<Record_>): Row {
  return {
    score: mean(items.map((item) => item.score)),
    calls: mean(items.map((item) => item.toolCalls.length)),
    /** The calls that only load the schema of a deferred tool. */
    loads: mean(items.map((item) => item.toolCalls.filter((call) => call.name === 'ToolSearch').length)),
    refused: mean(items.map((item) => item.refused ?? 0)),
    out: mean(items.map((item) => item.toolCalls.reduce((sum, call) => sum + call.outChars, 0))),
    /** Every token the model read: new, from the cache and written to the cache. */
    input: mean(items.map((item) => item.tokens.input + item.tokens.cacheRead + item.tokens.cacheWrite)),
    cost: mean(items.map((item) => item.cost)),
    seconds: mean(items.map((item) => item.durationMs / 1_000)),
    n: items.length,
  };
}

const number = (value: number): string => Math.round(value).toLocaleString('en-US');

console.log(
  '| model | mode | score | recall | write | tool calls | tool loads | refused calls | tool output chars | input tokens | cost per session | total cost | time | sessions | errors |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const model of models) {
  for (const mode of modes) {
    const items = records.filter((record) => record.model === model && record.mode === mode);
    if (items.length === 0) continue;
    const row = summary(items);
    const recall = summary(items.filter((item) => item.case.startsWith('recall-')));
    const write = summary(items.filter((item) => item.case.startsWith('write-')));
    const total = items.reduce((sum, item) => sum + item.cost, 0);
    console.log(
      `| ${modelName(model)} | ${mode} | **${row.score.toFixed(2)}** ${interval(noiseOf(items))} | ${recall.n > 0 ? recall.score.toFixed(2) : '-'} | ${write.n > 0 ? write.score.toFixed(2) : '-'} | ${row.calls.toFixed(1)} | ${row.loads.toFixed(1)} | ${row.refused.toFixed(1)} | ${number(row.out)} | ${number(row.input)} | $${row.cost.toFixed(3)} | $${total.toFixed(2)} | ${row.seconds.toFixed(0)}s | ${row.n} | ${failed.filter((item) => item.model === model && item.mode === mode).length} |`,
    );
  }
}

console.log(
  '\nThe interval after a score is the 95% interval of the noise from running each case again, from the spread of the repeats. It says nothing about other cases.',
);

/** The difference of two modes per model, when both ran on the same cases. */
if (modes.includes('tools') && modes.includes('files')) {
  console.log(`\nDifference tools − files:\n`);
  console.log('| model | score | recall | write |');
  console.log('|---|---|---|---|');
  for (const model of models) {
    const of = (mode: string, kind?: string) =>
      records.filter(
        (record) => record.model === model && record.mode === mode && (!kind || record.case.startsWith(`${kind}-`)),
      );
    const cell = (kind?: string) => {
      const [tools, files] = [of('tools', kind), of('files', kind)];
      if (tools.length === 0 || files.length === 0) return '-';
      const difference = summary(tools).score - summary(files).score;
      const error = Math.sqrt(noiseOf(tools) ** 2 + noiseOf(files) ** 2);
      return `${difference >= 0 ? '+' : ''}${difference.toFixed(2)} ${interval(error)}`;
    };
    console.log(`| ${modelName(model)} | ${cell()} | ${cell('recall')} | ${cell('write')} |`);
  }
}

/** A mean with its spread over the repeats: the standard deviation, when there is one. */
const withSpread = (items: Array<Record_>): string => {
  const scores = items.map((item) => item.score);
  const deviation = Math.sqrt(variance(scores));
  return deviation === 0 ? mean(scores).toFixed(2) : `${mean(scores).toFixed(2)} (sd ${deviation.toFixed(2)})`;
};

const columns = models.flatMap((model) => modes.map((mode) => `${modelName(model)} ${mode}`));
console.log(`\nScore per case, with the standard deviation of the repeats:\n`);
console.log(`| case | ${columns.join(' | ')} |`);
console.log(`|---|${columns.map(() => '---').join('|')}|`);
for (const name of cases) {
  const cells = models.flatMap((model) =>
    modes.map((mode) => {
      const items = records.filter((record) => record.case === name && record.model === model && record.mode === mode);
      return items.length === 0 ? '' : withSpread(items);
    }),
  );
  console.log(`| ${name} | ${cells.join(' | ')} |`);
}

console.log(`\nCost per case:\n`);
console.log(`| case | ${columns.join(' | ')} |`);
console.log(`|---|${columns.map(() => '---').join('|')}|`);
for (const name of cases) {
  const cells = models.flatMap((model) =>
    modes.map((mode) => {
      const items = records.filter((record) => record.case === name && record.model === model && record.mode === mode);
      return items.length === 0 ? '' : `$${summary(items).cost.toFixed(3)}`;
    }),
  );
  console.log(`| ${name} | ${cells.join(' | ')} |`);
}

if (isDetailed) {
  console.log('\nFailed checks:\n');
  for (const record of failed)
    console.log(`- ${modelName(record.model)} ${record.case} ${record.mode}: error: ${record.error}`);
  for (const record of records) {
    const failed = record.checks.filter((check) => !check.isPassed).map((check) => check.name);
    if (failed.length > 0) {
      console.log(`- ${modelName(record.model)} ${record.case} ${record.mode}: ${failed.join('; ')}`);
    }
  }

  console.log('\nTools used:\n');
  for (const record of records) {
    const calls = record.toolCalls.map((call) => `${call.name}${call.isError ? '!' : ''}`).join(', ');
    console.log(`- ${modelName(record.model)} ${record.case} ${record.mode}: ${calls || 'none'}`);
  }
}
