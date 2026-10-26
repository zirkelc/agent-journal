/**
 * Runs the cases in Pi, once with the journal tools and once without them, and
 * writes one JSON record per session into the results folder.
 *
 *   node eval/pi/run.ts [--modes tools,files] [--cases id,id] [--repeat N]
 *                       [--model provider/id] [--jobs N] [--out DIR]
 *
 * Each session gets its own home directory with a fresh copy of the journal,
 * its own config and its own Pi agent folder, so nothing from this machine
 * gets in, and nothing gets out to the real journal. Only the credentials come
 * from the real Pi agent folder, through a link to its auth.json.
 *
 * Pi runs in RPC mode, which counts as a session with a UI, so the extension
 * gives its rules as it does in the terminal.
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { type Case, fill, loadCases, materialize, type Placed } from '../dataset.ts';
import { grade, ID, type Session } from '../grade.ts';

/**
 * Time zones east of UTC, so that a local day starts on the UTC date before
 * it. That is what the cases about yesterday test. Two entries of today are at
 * 01:10, and the last entry is 20 minutes before the run, so the run takes the
 * first zone where it is now between 03:00 and 22:59. With three zones, that
 * is one at every hour of the day, and the eval can run at any time, also on CI.
 */
const ZONES = ['Europe/Berlin', 'Asia/Dubai', 'Asia/Tokyo'];

export function pickZone(now: Date): string {
  const hourIn = (timeZone: string) =>
    Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now));
  const zone = ZONES.find((timeZone) => hourIn(timeZone) >= 3 && hourIn(timeZone) <= 22);
  if (!zone) throw new Error('No time zone has a time of day between 03:00 and 22:59 now.');
  return zone;
}

/** The time zone of every session and of the grader, so that both see the same local days. */
const TZ = pickZone(new Date());
process.env.TZ = TZ;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PI = join(ROOT, 'node_modules', '.bin', 'pi');
const EXTENSION = join(ROOT, 'pi', 'extensions', 'agent-journal.ts');
const HOST = 'eval-host';
const USER = 'eval-user';
/** How long one message may take before the session counts as stuck. */
const MESSAGE_TIMEOUT_MS = 5 * 60_000;

export type Mode = 'tools' | 'files';

type ToolCall = { name: string; args: unknown; outChars: number; isError: boolean };

export type Record_ = {
  case: string;
  kind: Case['kind'];
  mode: Mode;
  repeat: number;
  model: string;
  timeZone: string;
  score: number;
  checks: ReturnType<typeof grade>['checks'];
  answer: string;
  written: Array<string>;
  toolCalls: Array<ToolCall>;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  durationMs: number;
  error?: string;
};

const { values } = parseArgs({
  options: {
    modes: { type: 'string', default: 'tools,files' },
    cases: { type: 'string' },
    repeat: { type: 'string', default: '1' },
    model: { type: 'string', default: 'anthropic/claude-sonnet-5-5' },
    jobs: { type: 'string', default: '4' },
    out: { type: 'string' },
  },
});

/** PATH without a folder that has the CLI, so that the model without the tools finds no `agent-journal` either. */
function cleanPath(): string {
  return (process.env.PATH ?? '')
    .split(delimiter)
    .filter((dir) => {
      try {
        return !readdirSync(dir).some((name) => name === 'agent-journal' || name === 'aj');
      } catch {
        return true;
      }
    })
    .join(delimiter);
}

/** A home directory with the journal, the config and the case's working directory. */
function prepare(test: Case, now: Date) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'aj-eval-')));
  const home = join(base, 'home');
  const journalDir = join(home, 'agent-journal');
  const placed = materialize(journalDir, now, { host: HOST, user: USER });
  const config = join(home, '.config', 'agent-journal');
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, 'config'), `journal_dir=${journalDir}\nhost=${HOST}\nuser=${USER}\n`);
  const cwd = join(home, test.dir);
  mkdirSync(cwd, { recursive: true });
  if (test.git) {
    execFileSync('git', ['init', '-q', '-b', 'main', cwd]);
    writeFileSync(join(cwd, 'README.md'), `# ${test.dir.split('/').at(-1)}\n`);
  }
  const agentDir = join(base, 'pi-agent');
  mkdirSync(agentDir, { recursive: true });
  const realAgentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
  symlinkSync(join(realAgentDir, 'auth.json'), join(agentDir, 'auth.json'));
  /** The providers that need more than a key, such as the endpoint of an Azure resource. */
  if (existsSync(join(realAgentDir, 'models.json'))) {
    symlinkSync(join(realAgentDir, 'models.json'), join(agentDir, 'models.json'));
  }
  return { base, home, journalDir, cwd, agentDir, placed, before: new Set(readdirSync(journalDir)) };
}

/** A Pi process in RPC mode, with a way to send a command and wait for its answer or for an event. */
function startPi(options: { cwd: string; home: string; agentDir: string; base: string; mode: Mode; model: string }) {
  const child: ChildProcess = spawn(
    PI,
    [
      '--mode',
      'rpc',
      '--no-extensions',
      '-e',
      EXTENSION,
      '--no-skills',
      '--no-prompt-templates',
      '--no-context-files',
      '--no-themes',
      '--no-mcp',
      '--model',
      options.model,
      '--session-dir',
      join(options.base, 'sessions'),
    ],
    {
      cwd: options.cwd,
      env: {
        ...process.env,
        HOME: options.home,
        XDG_CONFIG_HOME: join(options.home, '.config'),
        PI_CODING_AGENT_DIR: options.agentDir,
        PATH: cleanPath(),
        TZ,
        GIT_CEILING_DIRECTORIES: options.home,
        AGENT_JOURNAL_TOOLS: options.mode === 'tools' ? 'on' : 'off',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const events: Array<Record<string, any>> = [];
  const listeners = new Set<(record: Record<string, any>) => void>();
  let stderr = '';
  child.stderr!.on('data', (chunk) => (stderr += chunk));
  createInterface({ input: child.stdout! }).on('line', (line) => {
    let record: Record<string, any>;
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }
    events.push(record);
    for (const listener of listeners) listener(record);
  });
  let next = 0;

  function waitFor(test: (record: Record<string, any>) => boolean, timeout = MESSAGE_TIMEOUT_MS) {
    return new Promise<Record<string, any>>((done, fail) => {
      const timer = setTimeout(() => {
        listeners.delete(listener);
        fail(new Error(`timed out; stderr: ${stderr.slice(-500)}`));
      }, timeout);
      const listener = (record: Record<string, any>) => {
        if (!test(record)) return;
        clearTimeout(timer);
        listeners.delete(listener);
        done(record);
      };
      listeners.add(listener);
      child.once('exit', (code) => {
        clearTimeout(timer);
        fail(new Error(`pi exited with ${code}; stderr: ${stderr.slice(-500)}`));
      });
    });
  }

  async function command(payload: Record<string, unknown>): Promise<Record<string, any>> {
    const id = `req-${next++}`;
    const answer = waitFor((record) => record.type === 'response' && record.id === id, 60_000);
    child.stdin!.write(`${JSON.stringify({ id, ...payload })}\n`);
    const response = await answer;
    if (!response.success) throw new Error(`${String(payload.type)} failed: ${response.error}`);
    return response;
  }

  /** Sends one message and waits until Pi does not continue on its own. */
  async function prompt(message: string): Promise<void> {
    const settled = waitFor((record) => record.type === 'agent_settled');
    const response = await command({ type: 'prompt', message });
    if (response.data?.disposition === 'started') await settled;
  }

  async function stop(): Promise<void> {
    const exited = new Promise<void>((done) => child.once('exit', () => done()));
    child.stdin!.end();
    const timer = setTimeout(() => child.kill('SIGTERM'), 15_000);
    await exited;
    clearTimeout(timer);
  }

  return { events, command, prompt, stop };
}

const textOf = (result: any): string =>
  (result?.content ?? [])
    .filter((part: any) => part.type === 'text')
    .map((part: any) => part.text)
    .join('');

async function runOne(test: Case, mode: Mode, repeat: number, model: string): Promise<Record_> {
  const now = new Date();
  const run = prepare(test, now);
  const pi = startPi({ ...run, mode, model });
  const start = new Date();
  let error: string | undefined;
  let answer = '';
  let stats: Record<string, any> = {};
  let sessionId = '';
  try {
    const state = await pi.command({ type: 'get_state' });
    sessionId = state.data?.sessionId ?? '';
    for (const message of test.messages) await pi.prompt(fill(message, run.placed));
    /** A model call that failed ends the turn without an answer; that is an error of the run, not a wrong answer. */
    const failed = pi.events.find(
      (event) =>
        event.type === 'message_end' && event.message?.role === 'assistant' && event.message.stopReason === 'error',
    );
    if (failed) throw new Error(`the model call failed: ${failed.message.errorMessage ?? 'no message'}`);
    answer = (await pi.command({ type: 'get_last_assistant_text' })).data?.text ?? '';
    stats = (await pi.command({ type: 'get_session_stats' })).data ?? {};
    sessionId ||= stats.sessionId ?? '';
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    await pi.stop();
  }
  const end = new Date();
  const written = readdirSync(run.journalDir)
    .filter((name) => name.endsWith('.md') && !run.before.has(name))
    .map((name) => ({ name, text: readFileSync(join(run.journalDir, name), 'utf8') }));

  const starts = new Map<string, any>();
  const toolCalls: Array<ToolCall> = [];
  for (const event of pi.events) {
    if (event.type === 'tool_execution_start') starts.set(event.toolCallId, event);
    if (event.type === 'tool_execution_end') {
      toolCalls.push({
        name: event.toolName,
        args: starts.get(event.toolCallId)?.args,
        outChars: textOf(event.result).length,
        isError: Boolean(event.isError),
      });
    }
  }

  const stray = strayEntries(run, toolCalls);
  // A file outside the folder of the session would be found by the next session, so it moves in, as evidence.
  for (const path of stray.filter((item) => !item.startsWith(`${run.base}/`))) {
    mkdirSync(join(run.base, 'stray'), { recursive: true });
    renameSync(path, join(run.base, 'stray', basename(path)));
  }

  const modelId = model.split('/').at(-1)!;
  const session: Session = {
    answer,
    written,
    stray,
    start,
    end,
    expected: {
      cwd: `~/${test.dir}`,
      host: HOST,
      user: USER,
      agent: `pi/${modelId}`,
      sessionId,
    },
  };
  const graded = grade(test, session, run.placed as Array<Placed>);
  const record: Record_ = {
    case: test.id,
    kind: test.kind,
    mode,
    repeat,
    model,
    timeZone: TZ,
    score: error ? 0 : graded.score,
    checks: graded.checks,
    answer,
    written: written.map((file) => file.text),
    toolCalls,
    tokens: stats.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: stats.cost ?? 0,
    durationMs: end.getTime() - start.getTime(),
    ...(error ? { error } : {}),
  };
  /**
   * A session that passed every check needs no look later, and its folder
   * holds a copy of the whole journal. A session with no scored check proves
   * nothing, so it keeps its folder too.
   */
  const isClean = record.checks.every((check) => check.isPassed);
  const isScored = record.checks.some((check) => check.isScored !== false);
  if (!error && isClean && isScored) {
    await rm(run.base, { recursive: true, force: true });
    return record;
  }
  writeFileSync(join(run.base, 'events.jsonl'), pi.events.map((event) => JSON.stringify(event)).join('\n'));
  return { ...record, ...({ workdir: run.base } as object) };
}

/**
 * The entry files that a session wrote outside the journal folder. The files
 * on disk show every such entry in the folder of the session, however it was
 * written. A write or edit tool can also put one outside that folder, which
 * only its path shows: the tools read `~` as the home of the session and drop
 * a leading `@`.
 */
function strayEntries(
  run: { base: string; home: string; cwd: string; journalDir: string },
  toolCalls: Array<ToolCall>,
) {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) {
        if (path !== run.journalDir) walk(path);
      } else if (ID.test(item.name)) {
        found.add(path);
      }
    }
  };
  walk(run.base);
  for (const call of toolCalls) {
    if (call.isError || !['write', 'edit'].includes(call.name)) continue;
    const raw = (call.args as { path?: unknown } | undefined)?.path;
    if (typeof raw !== 'string') continue;
    const path = raw.replace(/^@/, '').replace(/^~(?=$|\/)/, run.home);
    const absolute = resolve(run.cwd, path);
    if (ID.test(basename(absolute)) && dirname(absolute) !== run.journalDir && existsSync(absolute))
      found.add(absolute);
  }
  return [...found].sort();
}

/** Runs the jobs with at most `limit` at a time. */
async function pool<T>(jobs: Array<() => Promise<T>>, limit: number): Promise<Array<T>> {
  const results: Array<T> = [];
  let index = 0;
  const worker = async () => {
    while (index < jobs.length) {
      const mine = index++;
      results[mine] = await jobs[mine]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const wanted = values.cases?.split(',');
  const cases = loadCases().filter((test) => !wanted || wanted.includes(test.id));
  const modes = values.modes!.split(',') as Array<Mode>;
  const repeats = Number(values.repeat);
  const out = values.out ?? join(ROOT, 'eval', 'results', new Date().toISOString().replaceAll(':', '').slice(0, 15));
  mkdirSync(out, { recursive: true });
  const jobs = cases.flatMap((test) =>
    modes.flatMap((mode) =>
      Array.from({ length: repeats }, (_, repeat) => async () => {
        const record = await runOne(test, mode, repeat, values.model!);
        writeFileSync(join(out, `${test.id}.${mode}.${repeat}.json`), `${JSON.stringify(record, null, 2)}\n`);
        const calls = record.toolCalls.map((call) => call.name).join(' ');
        console.log(
          `${test.id} ${mode} #${repeat}: score ${record.score.toFixed(2)}, $${record.cost.toFixed(3)}, ${record.toolCalls.length} calls (${calls})${record.error ? `, error: ${record.error}` : ''}`,
        );
        return record;
      }),
    ),
  );
  console.log(`${jobs.length} sessions with ${values.model} in ${TZ}, ${values.jobs} at a time, into ${out}`);
  await pool(jobs, Number(values.jobs));
  console.log(`done: node eval/report.ts ${out}`);
}
