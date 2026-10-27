/**
 * Runs the cases in Claude Code, once with the journal tools and once without
 * them, and writes one JSON record per session into the results folder.
 *
 *   node eval/claude-code/run.ts [--modes tools,files] [--cases id,id] [--repeat N]
 *                                [--model id] [--jobs N] [--out DIR]
 *
 * Each session gets its own folder with a fresh copy of the journal and its
 * own config, so nothing gets out to the real journal. It loads only this
 * checkout's plugin, without the user's settings, CLAUDE.md files, memory or
 * MCP servers. HOME stays the real one: Claude Code finds its login on macOS
 * by the path of its config, and a session with another HOME is not logged in.
 * So the folder is in the real home, and the rules give the model the working
 * directory as a path from `~`, as a user's rules do.
 *
 * Without the tools, a deny rule removes them, which is how a person turns them
 * off too, and the plugin then gives the rules for files. Pi asks for no
 * approval before a tool call. Here the sessions run in `acceptEdits`, which
 * allows a file write in the working folder and the journal, with an allow
 * list of the read tools and of the read-only shell commands that the rules
 * for files use. A session without a UI refuses any other call, and the model
 * sees the refusal as the result of the call.
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
  writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { type Case, fill, loadCases, materialize, type Placed } from '../dataset.ts';
import { grade, type Session } from '../grade.ts';
import {
  cleanPath,
  HOST,
  isClean,
  type Mode,
  pickZone,
  pool,
  type Record_,
  strayEntries,
  type ToolCall,
  USER,
} from '../runner.ts';

/** The time zone of every session and of the grader, so that both see the same local days. */
const TZ = pickZone(new Date());
process.env.TZ = TZ;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN = join(ROOT, 'claude-code');
/** How long one message may take before the session counts as stuck. */
const MESSAGE_TIMEOUT_MS = 5 * 60_000;
/** The most turns one message may take, so that a model in a loop stops. */
const MAX_TURNS = 60;

/** The plugin's journal tools, which a deny rule removes in the files mode. */
const JOURNAL_TOOLS = ['write', 'list', 'read'].map((name) => `mcp__agent-journal__${name}`);

/**
 * What a session may run without a question, besides a file write: the read
 * tools, and the shell commands that the rules for files use to read the
 * journal. `xargs` only with the reading commands, since it runs the command
 * it is given.
 */
const ALLOWED_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'ToolSearch',
  ...['ls', 'cat', 'head', 'tail', 'grep', 'awk', 'sort', 'uniq', 'wc', 'date', 'cd', 'find', 'pwd', 'echo'].map(
    (command) => `Bash(${command}:*)`,
  ),
  ...['grep', 'cat', 'head', 'awk', 'wc'].map((command) => `Bash(xargs ${command}:*)`),
];

/** The tools that write a file, and where each takes the path. */
const WRITE_TOOLS: Record<string, string> = {
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
};

/**
 * The `claude` program, found before the PATH of the sessions loses the
 * folders with the CLI: an install script puts both into `~/.local/bin`.
 */
const CLAUDE = execFileSync('sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).trim();

const { values } = parseArgs({
  options: {
    modes: { type: 'string', default: 'tools,files' },
    cases: { type: 'string' },
    repeat: { type: 'string', default: '1' },
    model: { type: 'string', default: 'claude-sonnet-5-5' },
    jobs: { type: 'string', default: '4' },
    out: { type: 'string' },
  },
});

/**
 * A folder in the home with the journal, the config and the case's working
 * directory. Its name is short, because a model can copy a long path wrong.
 */
function prepare(test: Case, now: Date) {
  const base = realpathSync(mkdtempSync(join(homedir(), '.aj-eval-')));
  const journalDir = join(base, 'agent-journal');
  const placed = materialize(journalDir, now, { host: HOST, user: USER });
  const config = join(base, '.config', 'agent-journal');
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, 'config'), `journal_dir=${journalDir}\nhost=${HOST}\nuser=${USER}\n`);
  const cwd = join(base, test.dir);
  mkdirSync(cwd, { recursive: true });
  if (test.git) {
    execFileSync('git', ['init', '-q', '-b', 'main', cwd]);
    writeFileSync(join(cwd, 'README.md'), `# ${test.dir.split('/').at(-1)}\n`);
  }
  return { base, journalDir, cwd, placed, before: new Set(readdirSync(journalDir)) };
}

type Event = Record<string, any>;

/**
 * A Claude Code process that reads the user's messages as stream JSON, so that
 * all messages of a case go into one session, with a way to send one and wait
 * for the result of its turn.
 */
function startClaude(options: { cwd: string; base: string; journalDir: string; mode: Mode; model: string }) {
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    options.model,
    '--plugin-dir',
    PLUGIN,
    '--setting-sources',
    'project,local',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    ...ALLOWED_TOOLS,
    '--max-turns',
    String(MAX_TURNS),
    /** The journal is outside the working folder, and a session without a UI cannot ask for a write there. */
    '--add-dir',
    options.journalDir,
    ...(options.mode === 'files' ? ['--disallowedTools', ...JOURNAL_TOOLS] : []),
  ];
  const child: ChildProcess = spawn(CLAUDE, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(options.base, '.config'),
      PATH: cleanPath(),
      TZ,
      GIT_CEILING_DIRECTORIES: options.base,
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const events: Array<Event> = [];
  const listeners = new Set<(event: Event) => void>();
  let stderr = '';
  child.stderr!.on('data', (chunk) => (stderr += chunk));
  createInterface({ input: child.stdout! }).on('line', (line) => {
    let event: Event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    events.push(event);
    for (const listener of listeners) listener(event);
  });
  const exited = new Promise<number | null>((done) => child.once('exit', (code) => done(code)));

  /** Sends one message and waits for the result of its turn. */
  function send(message: string): Promise<Event> {
    return new Promise<Event>((done, fail) => {
      const timer = setTimeout(() => {
        listeners.delete(listener);
        fail(new Error(`timed out; stderr: ${stderr.slice(-500)}`));
      }, MESSAGE_TIMEOUT_MS);
      const listener = (event: Event) => {
        if (event.type !== 'result') return;
        clearTimeout(timer);
        listeners.delete(listener);
        done(event);
      };
      listeners.add(listener);
      void exited.then((code) => {
        if (!listeners.has(listener)) return;
        clearTimeout(timer);
        listeners.delete(listener);
        fail(new Error(`claude exited with ${code}; stderr: ${stderr.slice(-500)}`));
      });
      const content = [{ type: 'text', text: message }];
      child.stdin!.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`);
    });
  }

  async function stop(): Promise<void> {
    child.stdin!.end();
    const timer = setTimeout(() => child.kill('SIGTERM'), 15_000);
    await exited;
    clearTimeout(timer);
  }

  return { events, send, stop };
}

/** The text of a tool result, which is a string or a list of blocks. */
const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('')
      : '';

/** Every tool call of the session, with its arguments and the length of its result. */
function toolCallsOf(events: Array<Event>): Array<ToolCall> {
  const results = new Map<string, Event>();
  for (const event of events) {
    if (event.type !== 'user' || !Array.isArray(event.message?.content)) continue;
    for (const block of event.message.content) if (block.type === 'tool_result') results.set(block.tool_use_id, block);
  }
  const calls: Array<ToolCall> = [];
  for (const event of events) {
    if (event.type !== 'assistant' || !Array.isArray(event.message?.content)) continue;
    for (const block of event.message.content) {
      if (block.type !== 'tool_use') continue;
      const result = results.get(block.id);
      calls.push({
        name: block.name,
        args: block.input,
        outChars: textOf(result?.content).length,
        isError: Boolean(result?.is_error),
      });
    }
  }
  return calls;
}

/** The tokens of all turns: each result counts its own turn. */
function tokensOf(results: Array<Event>): Record_['tokens'] {
  const sum = (key: string) => results.reduce((total, result) => total + (Number(result.usage?.[key]) || 0), 0);
  const tokens = {
    input: sum('input_tokens'),
    output: sum('output_tokens'),
    cacheRead: sum('cache_read_input_tokens'),
    cacheWrite: sum('cache_creation_input_tokens'),
  };
  return { ...tokens, total: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite };
}

/** The agent as the plugin names it: `claude-haiku-5-5` is `claude/haiku-5-5`. */
const agentOf = (model: string): string => `claude/${model.replace(/^claude-/, '').replace(/\[.*\]$/, '')}`;

async function runOne(test: Case, mode: Mode, repeat: number, model: string): Promise<Record_> {
  const now = new Date();
  const run = prepare(test, now);
  const claude = startClaude({ ...run, mode, model });
  const start = new Date();
  let error: string | undefined;
  const results: Array<Event> = [];
  try {
    for (const message of test.messages) {
      const result = await claude.send(fill(message, run.placed));
      results.push(result);
      /** A model call that failed ends the turn without an answer; that is an error of the run, not a wrong answer. */
      if (result.is_error || result.subtype !== 'success') {
        throw new Error(
          `the turn failed: ${result.subtype}${result.result ? `: ${String(result.result).slice(0, 300)}` : ''}`,
        );
      }
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    await claude.stop();
  }
  const end = new Date();
  const answer = String(results.at(-1)?.result ?? '');
  const sessionId = String(
    claude.events.find((event) => event.type === 'system' && event.session_id)?.session_id ?? '',
  );
  const written = readdirSync(run.journalDir)
    .filter((name) => name.endsWith('.md') && !run.before.has(name))
    .map((name) => ({ name, text: readFileSync(join(run.journalDir, name), 'utf8') }));
  const toolCalls = toolCallsOf(claude.events);

  const stray = strayEntries(run, toolCalls, (call) => {
    const key = WRITE_TOOLS[call.name];
    const raw = key ? (call.args as Record<string, unknown> | undefined)?.[key] : undefined;
    /** The tools read `~` as the real home. */
    return typeof raw === 'string' ? raw.replace(/^~(?=$|\/)/, homedir()) : undefined;
  });
  // A file outside the folder of the session would be found by the next session, so it moves in, as evidence.
  for (const path of stray.filter((item) => !item.startsWith(`${run.base}/`))) {
    mkdirSync(join(run.base, 'stray'), { recursive: true });
    renameSync(path, join(run.base, 'stray', basename(path)));
  }

  const session: Session = {
    answer,
    written,
    stray,
    start,
    end,
    expected: { cwd: `~/${relative(homedir(), run.cwd)}`, host: HOST, user: USER, agent: agentOf(model), sessionId },
  };
  const graded = grade(test, session, run.placed as Array<Placed>);
  /** Each result names the calls that a permission check refused in its turn. */
  const refused = new Set(
    results.flatMap((result) =>
      (Array.isArray(result.permission_denials) ? result.permission_denials : []).map(
        (denial: Event, index: number) => denial.tool_use_id ?? `${String(result.session_id)}:${index}`,
      ),
    ),
  );
  /** Each result gives the cost of the session so far. */
  const cost = Math.max(0, ...results.map((result) => Number(result.total_cost_usd) || 0));
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
    tokens: tokensOf(results),
    cost,
    durationMs: end.getTime() - start.getTime(),
    refused: refused.size,
    ...(error ? { error } : {}),
  };
  /** A clean session's folder holds only a copy of the whole journal. */
  if (isClean(record)) {
    await rm(run.base, { recursive: true, force: true });
    return record;
  }
  writeFileSync(join(run.base, 'events.jsonl'), claude.events.map((event) => JSON.stringify(event)).join('\n'));
  return { ...record, ...({ workdir: run.base } as object) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!existsSync(PLUGIN)) throw new Error(`no plugin at ${PLUGIN}`);
  const wanted = values.cases?.split(',');
  const cases = loadCases().filter((test) => !wanted || wanted.includes(test.id));
  const modes = values.modes!.split(',') as Array<Mode>;
  const repeats = Number(values.repeat);
  const out =
    values.out ??
    join(ROOT, 'eval', 'results', `claude-code-${new Date().toISOString().replaceAll(':', '').slice(0, 15)}`);
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
