import type { JournalEntry, JournalList, JournalOpened, JournalSync, JournalTurn, JournalView } from '../types';
import { questionPrompt } from './agent.js';
import { dayText, FAILED_STEP, instantOf, isLatest, localDayTime, rangeText, stepped, withUnit } from './format.js';
import {
  configArgs,
  contextArgs,
  entriesOf,
  isSyncOnOf,
  journalDirOf,
  listArgs,
  readArgs,
  recallArgs,
  sanitize,
  SYNC_OFF,
  SYNC_REMOTE_FAILED,
  syncArgs,
  type Filters,
} from './cli.js';
import type { Host } from './host.js';
import { CLI_IN_CHECKOUT, RULES_MARK, TOOL_PREFIX } from './names.js';
import type { PaneActions } from './pane-view.js';

/**
 * How a CLI call ended: the CLI it ran, its exit code and both streams, or -1
 * with the engine's reason when it could not start or was stopped.
 */
export type Run = { cli: string; exitCode: number; stdout: string; stderr: string; error?: string };

/** Long enough for `list --limit 200` on a large journal, short enough to give up on a hung one. */
const CLI_TIMEOUT_MS = 15_000;

/** The session as the CLI's `context` names it: where it works, its id, and the agent and model in it. */
export type SessionNames = { cwd: string; sessionId: string; agent: string };

export async function sessionOf(host: Host): Promise<SessionNames> {
  const [cwd, sessionId, mainModel] = await Promise.all([host.cwd(), host.sessionId(), host.mainModel()]);
  return { cwd, sessionId, agent: agentOf(mainModel) };
}

/** How handing the rules to the main conversation went. */
export type RulesOutcome = 'delivered' | 'present' | 'none';

/**
 * Gives the main conversation the rules for writing the journal: a row the
 * model reads, or a block of context on the prompt being submitted, added only
 * when what its next request is built from does not hold them yet. That is so
 * at a session's start, after /clear and after compaction, and not on a resume,
 * which still carries them. Subagents never get them, since both go to the
 * main conversation alone.
 *
 * The rules are made ahead, at the start and again for a new session id
 * (a /clear) or another model, so a delivery waits for no CLI run. One check
 * runs at a time, for the row and the prompt alike, so two cannot both find
 * the rules missing and both add them. A prompt waits to enter the
 * conversation until the turn under way ends, so the rules it carries count as
 * given from when they are handed out until the next turn starts.
 */
export function rulesKeeper(host: Host) {
  let made: { key: string; rules: Promise<string> } | null = null;
  let checks: Promise<unknown> = Promise.resolve();
  /** The session the rules were last handed to a prompt in, while that prompt may still wait to enter. */
  let handedTo: string | null = null;

  async function keyOf(): Promise<{ key: string; session: SessionNames; hasTools: boolean }> {
    const [session, hasTools] = await Promise.all([sessionOf(host), host.canCallTools().catch(() => false)]);
    return { key: `${session.sessionId}\n${session.cwd}\n${session.agent}\n${hasTools}`, session, hasTools };
  }

  /** The rules for the session as it is now; empty when the CLI cannot give them, which the next call tries again. */
  async function rules(): Promise<string> {
    const { key, session, hasTools } = await keyOf();
    if (made?.key !== key) {
      /**
       * The variant that writes and reads through this mod's tools, rather than
       * files and a shell. A person who denies one of the tools gets the
       * variant for files, as a session without the tools needs.
       */
      const toolPrefix = hasTools ? TOOL_PREFIX : undefined;
      const ran = runCli(host, contextArgs(session.cwd, session.sessionId, session.agent, toolPrefix));
      const making = { key, rules: ran.then((run) => (run.exitCode === 0 ? run.stdout.trim() : '')) };
      made = making;
      void making.rules.then((text) => {
        if (text === '' && made === making) made = null;
      });
    }
    return made.rules;
  }

  /** Runs one check after the ones before it, whatever they came to. */
  function exclusive<RESULT>(check: () => Promise<RESULT>): Promise<RESULT> {
    const result = checks.then(check, check);
    checks = result.catch(() => undefined);
    return result;
  }

  /** Whether the conversation holds the rules, or a prompt that carries them waits to enter it. */
  async function isGiven(): Promise<boolean> {
    if (handedTo !== null && handedTo === (await keyOf()).key) return true;
    return host.conversationHas(RULES_MARK);
  }

  function deliver(): Promise<RulesOutcome> {
    return exclusive(async () => {
      if (await isGiven()) return 'present';
      const text = await rules();
      if (text === '') return 'none';
      await host.appendNote(`${RULES_MARK}\n${text}`);
      return 'delivered';
    });
  }

  /** The rules as a block of context for the prompt being submitted, marked, or null when they are given already or the CLI gives none. */
  function forPrompt(): Promise<string | null> {
    return exclusive(async () => {
      if (await isGiven()) return null;
      const text = await rules();
      if (text === '') return null;
      handedTo = (await keyOf()).key;
      return `${RULES_MARK}\n${text}`;
    });
  }

  return {
    prepare: () => rules().then(() => undefined),
    deliver,
    forPrompt,
    /** A turn started, so a prompt that waited is in the conversation now, or was dropped. */
    turnStarted: () => void (handedTo = null),
    /** The conversation was compacted, so what a prompt carried is gone with it. */
    forget: () => void (handedTo = null),
  };
}

/** How many entries the pane loads at first, and how many more each time the list nears its end. */
export const PANE_PAGE = 200;

/** The most entries the pane asks the CLI for, however far the person scrolls. */
const PANE_MAX = 100_000;

/**
 * The CLI the plugin ships, and no other: never one on `PATH`, so the mod runs
 * one known program, of the same commit as itself. The root is followed through
 * links first: a mod loaded through a link in a mods folder would otherwise
 * look for the CLI next to the link.
 */
/** The CLI each host found, looked for once: the plugin root does not move during a session. */
const clis = new WeakMap<Host, Promise<string>>();

function cliOf(host: Host): Promise<string> {
  let found = clis.get(host);
  if (!found) {
    found = findCli(host);
    clis.set(host, found);
  }
  return found;
}

async function findCli(host: Host): Promise<string> {
  const root = (await host.realPath(host.pluginRoot)) ?? host.pluginRoot;
  return `${root}/${CLI_IN_CHECKOUT}`;
}

/**
 * Runs the CLI in the session's directory, where `--project .` resolves. Never
 * rejects: a CLI that cannot start is a failed run with the reason as stderr.
 */
export async function runCli(host: Host, args: Array<string>, timeoutMs = CLI_TIMEOUT_MS): Promise<Run> {
  let cli = `${host.pluginRoot}/${CLI_IN_CHECKOUT}`;
  try {
    const [found, cwd] = await Promise.all([cliOf(host), host.cwd()]);
    cli = found;
    const ran = await host.run([cli, ...args], cwd, timeoutMs);
    return { cli, exitCode: ran.exitCode, stdout: ran.stdout, stderr: ran.stderr };
  } catch (error) {
    const reason = String((error as Error)?.message ?? error).slice(0, 200);
    return {
      cli,
      exitCode: -1,
      stdout: '',
      stderr: `agent-journal could not run (${reason}).`,
      error: reason,
    };
  }
}

/** What to tell the person when the CLI does not speak the language this mod expects. */
export const tooOld = (run: Run): string =>
  `${run.cli} is older than this mod: it does not list entries by id or give the recall text. Update agent-journal.`;

/** The first line a failed run said, for one line in the pane. A usage error means a CLI too old for the call. */
export function failureOf(run: Run): string {
  const first = run.stderr.trim().split('\n')[0] ?? '';
  if (first.startsWith('usage:')) return sanitize(tooOld(run));
  return sanitize(first || `agent-journal exited with ${run.exitCode}`);
}

/**
 * The agent writing: the product, then the model as the session names it. The
 * CLI makes the model its API id, the same for every harness. Without a model,
 * the product alone.
 */
export function agentOf(model: string): string {
  return model === '' ? 'claude' : `claude/${model}`;
}

/**
 * How many entries a load asks for: the first page when it starts again, else
 * as many as the list holds. A list kept in the session from a version of the
 * pane without pages has no count, and starts at the first page too.
 */
export function pageLimitOf(list: JournalList, isFresh: boolean): number {
  const limit = (list as Partial<JournalList>).limit;
  return isFresh || typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0 ? PANE_PAGE : limit;
}

/**
 * Loads the pane's list, and where the journal is. Each load supersedes the
 * ones before it. The CLI prints the most recent entries oldest first, so one
 * entry more than asked for says that older ones exist, and is left out.
 */
export function listLoader(host: Host) {
  let generation = 0;
  let journalDir: string | null = null;
  let isSyncOn = false;
  /** Read once a session: the config changes only with a new one, as the rules do. */
  let configRead: Promise<JournalConfig> | null = null;

  /** Where the journal is and whether sync is on, from the CLI's `config`. A run that fails is tried again next time. */
  function config(): Promise<JournalConfig> {
    configRead ??= runCli(host, configArgs()).then((run) => {
      if (run.exitCode !== 0) configRead = null;
      journalDir = journalDirOf(run.stdout) ?? journalDir;
      isSyncOn = isSyncOnOf(run.stdout);
      return { journalDir, isSyncOn };
    });
    return configRead;
  }

  /** The filters the pane's scope and date give, for a page of a size and an offset. */
  async function filtersOf(limit: number, offset: number): Promise<Filters> {
    const [scope, date] = await Promise.all([host.scope.read(), host.date.read()]);
    return {
      limit: limit + 1,
      offset,
      ...(date.unit !== 'all' ? { date: date.value } : {}),
      ...(scope === 'project' ? { project: '.' } : {}),
    };
  }

  /** The newest entries, as many as the list holds now; `isFresh` starts again at the first page, as a new filter does. */
  async function load(isFresh = false): Promise<void> {
    const mine = ++generation;
    const limit = pageLimitOf(await host.list.read(), isFresh);
    await host.list.update((list): JournalList => ({ ...list, status: 'loading', error: '', limit }));
    const [listed] = await Promise.all([runCli(host, listArgs(await filtersOf(limit, 0), PANE_MAX)), config()]);
    if (mine !== generation) return;
    const entries = entriesOf(listed.stdout);
    /** Lines without a single id come from a CLI that prints another layout. */
    const isTooOld = listed.exitCode === 0 && entries.length === 0 && /\S/.test(listed.stdout);
    await host.list.update((list): JournalList => {
      if (listed.exitCode !== 0) return { ...list, status: 'failed', error: failureOf(listed) };
      if (isTooOld) return { ...list, status: 'failed', error: sanitize(tooOld(listed)) };
      const hasMore = entries.length > limit;
      return { status: 'ready', entries: hasMore ? entries.slice(-limit) : entries, error: '', limit, hasMore };
    });
  }

  /**
   * One page of older entries, put under the ones loaded: the CLI skips as many
   * of the newest as the list holds. An entry written meanwhile moves the page
   * by one, so an entry already listed is not listed twice.
   */
  async function loadMore(): Promise<void> {
    const list = await host.list.read();
    if (list.status !== 'ready' || !list.hasMore) return;
    const mine = ++generation;
    await host.list.update((now): JournalList => ({ ...now, status: 'loading' }));
    const listed = await runCli(host, listArgs(await filtersOf(PANE_PAGE, list.entries.length), PANE_MAX));
    if (mine !== generation) return;
    const older = entriesOf(listed.stdout);
    await host.list.update((now): JournalList => {
      if (listed.exitCode !== 0) return { ...now, status: 'failed', error: failureOf(listed) };
      const hasMore = older.length > PANE_PAGE;
      const known = new Set(now.entries.map((entry) => entry.id));
      const added = (hasMore ? older.slice(-PANE_PAGE) : older).filter((entry) => !known.has(entry.id));
      const entries = [...added, ...now.entries];
      return { status: 'ready', entries, error: '', limit: entries.length, hasMore };
    });
  }

  /**
   * New entries after a write: the newest page, merged into the list by id, so
   * a long list is not read again in full. Entries are only ever added, so the
   * ones loaded stay right. A list not loaded yet is loaded.
   */
  async function refresh(): Promise<void> {
    const list = await host.list.read();
    if (list.status !== 'ready' || list.entries.length === 0) return load();
    const mine = ++generation;
    const listed = await runCli(host, listArgs(await filtersOf(PANE_PAGE - 1, 0), PANE_MAX));
    if (mine !== generation || listed.exitCode !== 0) return;
    const newest = entriesOf(listed.stdout);
    await host.list.update((now): JournalList => {
      const known = new Set(now.entries.map((entry) => entry.id));
      const added = newest.filter((entry) => !known.has(entry.id));
      if (added.length === 0) return now;
      const entries = [...now.entries, ...added].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return { ...now, entries, limit: entries.length };
    });
  }

  return {
    load,
    loadMore,
    refresh,
    config,
    journalDir: () => journalDir,
    /** Whether sync is on, as far as the config has been read; off until it has. */
    isSyncOn: () => isSyncOn,
  };
}

/** What the mod reads from the CLI's config: where the journal is, and whether sync is on. */
export type JournalConfig = { journalDir: string | null; isSyncOn: boolean };

/** Long enough for a push over a slow network, short enough to give up on a hung one. */
export const SYNC_TIMEOUT_MS = 60_000;

/** What the session's end leaves to the hooks after its sync, of the engine's short bound for the exit. */
const END_MARGIN_MS = 100;

/** The least time worth starting a sync in: less, and git is stopped halfway through a step. */
const END_SYNC_MIN_MS = 400;

/**
 * How long the session's end may sync for, from what is left of the exit's
 * bound, or null when it should not: too little is left, or a sync is under
 * way, which the end neither waits for nor runs beside.
 */
export function endSyncTimeoutOf(remainingMs: number, isRunning: boolean): number | null {
  const timeoutMs = remainingMs - END_MARGIN_MS;
  if (isRunning || timeoutMs < END_SYNC_MIN_MS) return null;
  return Math.min(timeoutMs, SYNC_TIMEOUT_MS);
}

/** What one `sync` came to, for the pane: its line, or the reason it failed. */
export function syncStateOf(run: Run): JournalSync {
  /** Only a sync the config turned on runs, so the CLI is there, and a run that ended this way was stopped. */
  if (run.exitCode === -1) return { status: 'failed', text: `sync did not finish: ${run.error ?? 'stopped'}` };
  const line = sanitize(run.stdout.trim().split('\n')[0] ?? '');
  if (run.exitCode === 0) return line === SYNC_OFF ? { status: 'off', text: '' } : { status: 'synced', text: line };
  if (run.exitCode === SYNC_REMOTE_FAILED && line !== '') return { status: 'failed', text: line };
  return { status: 'failed', text: failureOf(run) };
}

/**
 * Commits and pushes the journal folder through the CLI, which does nothing
 * when the config leaves sync off. One sync runs at a time. A sync asked for
 * while one runs is run once that one ends, and every caller waits for it, so
 * the last write is always in a sync that started after it.
 */
export function syncer(host: Host) {
  let running: Promise<void> | null = null;
  let isPending = false;
  /** Whether the next sync pulls first: it does when any caller that waits for it asked for the pull. */
  let isPull = true;

  async function loop(timeoutMs: number): Promise<void> {
    do {
      isPending = false;
      /** Off stays quiet: a journal without sync shows nothing for it. */
      await host.sync.update((sync): JournalSync => (sync.status === 'off' ? sync : { ...sync, status: 'syncing' }));
      const ran = await runCli(host, syncArgs(isPull), timeoutMs);
      await host.sync.update(() => syncStateOf(ran));
    } while (isPending);
  }

  /** `pull` false leaves out the pull before the push, for the sync at the session's end. */
  function request(timeoutMs = SYNC_TIMEOUT_MS, pull = true): Promise<void> {
    if (running) {
      isPull = isPending ? isPull || pull : pull;
      isPending = true;
      return running;
    }
    isPull = pull;
    running = loop(timeoutMs).finally(() => {
      running = null;
    });
    return running;
  }

  return { request, isRunning: () => running !== null };
}

/** The most earlier turns a follow-up question carries, so the prompt stays small. */
const HISTORY_TURNS = 6;

/** How an ask ended: started, refused while another question runs, nothing to ask, or failed with a reason in the chat. */
export type AskOutcome = 'asked' | 'busy' | 'empty' | 'failed';

/**
 * Asks the search agent one question of the chat. Earlier answered turns go
 * with it, so a follow-up can say "and before that?". Its answer arrives with
 * the agent's last turn. One question runs at a time: the check and the new
 * turn are one change of the chat, so two asks at once cannot both pass. Any
 * failure after that settles the turn, so a question never stays open with no
 * agent behind it.
 */
export async function ask(host: Host, question: string): Promise<AskOutcome> {
  const text = question.trim();
  if (text === '') return 'empty';

  let index = -1;
  let earlier: Array<JournalTurn> = [];
  await host.chat.update((chat): Array<JournalTurn> => {
    if (chat.some((turn) => turn.status === 'asking')) return chat;
    earlier = chat.filter((turn) => turn.status === 'answered').slice(-HISTORY_TURNS);
    index = chat.length;
    return [
      ...chat,
      {
        status: 'asking',
        question: text,
        answer: '',
        agentId: '',
        startedAt: Date.now(),
        endedAt: 0,
        steps: [],
        seen: [],
      },
    ];
  });
  if (index === -1) return 'busy';

  const settle = (change: (turn: JournalTurn) => JournalTurn) =>
    host.chat.update((chat): Array<JournalTurn> => chat.map((turn, at) => (at === index ? change(turn) : turn)));
  const fail = async (answer: string): Promise<AskOutcome> => {
    await settle((turn) => ({ ...turn, status: 'failed', answer, endedAt: Date.now() }));
    return 'failed';
  };

  try {
    const session = await sessionOf(host);
    const recall = await runCli(host, recallArgs(session.cwd, session.sessionId, session.agent));
    if (recall.exitCode !== 0 || recall.stdout.trim() === '') return await fail(failureOf(recall));

    const [scope, model] = await Promise.all([host.scope.read(), host.model.read()]);
    const prompt = questionPrompt(recall.stdout, scope, earlier, text);
    const spawned = await host.spawn(prompt, model === 'inherit' ? undefined : model);
    if (spawned.deny) return await fail(`The search did not start: ${spawned.deny}`);
    if (!spawned.agentId) return await fail('The search started without an agent to wait for.');
    const agentId = spawned.agentId;
    await settle((turn) => ({ ...turn, agentId }));
    return 'asked';
  } catch (error) {
    return await fail(
      `The search did not start: ${sanitize(String((error as Error)?.message ?? error)).slice(0, 200)}`,
    );
  }
}

/** How often an agent whose answer is awaited is looked at again. */
export const ANSWER_POLL_MS = 1_000;

/**
 * Waits for search agents' answers. An agent ends a turn after each model
 * request, with tool calls and maybe a line such as "I will search first", and
 * a background agent's report can reach the main session as a hand-back
 * instead. So no single turn is the end: the agent is looked at until it has
 * stopped, and its last words in its transcript are the answer, or the last
 * turn's text when there are none. A look that fails (the agent list or the
 * chat could not be read) is tried again on the same schedule, and once the
 * attempts are spent the question fails, so it never stays open.
 */
export function answerWaiter(host: Host) {
  /** The agents whose stop is awaited: the text of each one's newest turn that had any, and whether it was seen running. */
  const waiting = new Map<string, { text: string; hasRun: boolean }>();

  async function settle(agentId: string, answer: string, isAborted: boolean): Promise<void> {
    const after = await host.chat.update((chat) => answered(chat, agentId, answer, isAborted));
    const turn = (after as Array<JournalTurn>).find((one) => one.agentId === agentId);
    if (turn?.status === 'answered') host.toast('The journal answered: see the Journal pane');
  }

  async function look(agentId: string, attempt: number): Promise<void> {
    const state = waiting.get(agentId);
    if (!state || !isAskingFor(await host.chat.read(), agentId)) return void waiting.delete(agentId);
    const status = await host.agentStatus(agentId);
    if (isRunningStatus(status)) state.hasRun = true;
    if (waitOn(status, state.hasRun, attempt) === 'wait') {
      host.after(ANSWER_POLL_MS, () => poll(agentId, attempt + 1));
      return;
    }
    const answer = lastAnswerOf(await host.agentMessages(agentId)) || state.text;
    waiting.delete(agentId);
    await settle(agentId, answer, status === 'killed');
  }

  function poll(agentId: string, attempt: number): void {
    void look(agentId, attempt).catch(() => {
      if (attempt < ANSWER_ATTEMPTS) return void host.after(ANSWER_POLL_MS, () => poll(agentId, attempt + 1));
      waiting.delete(agentId);
      void settle(agentId, '', false).catch(() => undefined);
    });
  }

  /** One turn of an agent whose question is open ended, with its text. */
  async function turnEnded(agentId: string, answer: string, isAborted: boolean): Promise<void> {
    if (isAborted) return settle(agentId, answer, true);
    const state = waiting.get(agentId);
    if (state) {
      if (answer.trim() !== '') state.text = answer;
      return;
    }
    waiting.set(agentId, { text: answer.trim() !== '' ? answer : '', hasRun: false });
    poll(agentId, 0);
  }

  return { turnEnded };
}

/** What the chat says when a question comes while another is still being answered. */
export const busyNotice = (question: string): string =>
  `Still answering the question before. Ask again once its answer is in: ${sanitize(question.trim())}`;

/** What the search agent's last turn means for the chat: the turn it answers, settled. */
export function answered(
  chat: Array<JournalTurn>,
  agentId: string,
  answer: unknown,
  isAborted: boolean,
  now = Date.now(),
): Array<JournalTurn> {
  const at = chat.findIndex((turn) => turn.status === 'asking' && turn.agentId === agentId);
  if (at === -1) return chat;
  const text = typeof answer === 'string' ? answer.trim() : '';
  const turn = chat[at]!;
  const settled: JournalTurn = isAborted
    ? { ...turn, status: 'failed', answer: 'The search was stopped.', endedAt: now }
    : text === ''
      ? { ...turn, status: 'failed', answer: 'The search ended without an answer.', endedAt: now }
      : { ...turn, status: 'answered', answer: text, endedAt: now };
  return chat.map((one, index) => (index === at ? settled : one));
}

/** The longest an answer is awaited, in looks one second apart. */
export const ANSWER_ATTEMPTS = 300;

/** How many looks an agent the session does not list yet gets before it counts as gone. */
export const UNLISTED_ATTEMPTS = 5;

/** Whether an agent's status says it is still at work. */
export const isRunningStatus = (status: string | undefined): boolean =>
  status === 'pending' || status === 'running' || status === 'waiting';

/**
 * Whether to look at an agent again or take its answer now. A running agent is
 * waited for. One the session no longer lists has stopped if it was seen
 * running; before that, it may simply not be listed yet, so it gets a few looks.
 */
export function waitOn(status: string | undefined, hasRun: boolean, attempt: number): 'wait' | 'done' {
  if (attempt >= ANSWER_ATTEMPTS) return 'done';
  if (isRunningStatus(status)) return 'wait';
  if (status !== undefined) return 'done';
  return !hasRun && attempt < UNLISTED_ATTEMPTS ? 'wait' : 'done';
}

/** Whether a question of the chat waits for this agent's answer. */
export const isAskingFor = (chat: ReadonlyArray<JournalTurn>, agentId: string): boolean =>
  chat.some((turn) => turn.status === 'asking' && turn.agentId === agentId);

/** The last thing an agent said: the text of its last assistant message that has any. */
export function lastAnswerOf(messages: ReadonlyArray<{ role: string; text: string }>): string {
  for (let at = messages.length - 1; at >= 0; at--) {
    const message = messages[at]!;
    if (message.role === 'assistant' && message.text.trim() !== '') return message.text;
  }
  return '';
}

/**
 * The turn a tool call of an agent belongs to: the one asking under that agent,
 * or, while the spawn has not yet stored its id, the one asking without one.
 */
function turnOf(chat: ReadonlyArray<JournalTurn>, agentId: string): number {
  const exact = chat.findIndex((turn) => turn.status === 'asking' && turn.agentId === agentId);
  if (exact !== -1) return exact;
  return chat.findIndex((turn) => turn.status === 'asking' && turn.agentId === '');
}

/** The chat with one more step of an agent's search, and the entries that step returned. */
export function recorded(
  chat: Array<JournalTurn>,
  agentId: string,
  step: string,
  entries: ReadonlyArray<JournalEntry>,
): Array<JournalTurn> {
  const at = turnOf(chat, agentId);
  if (at === -1) return chat;
  const turn = chat[at]!;
  const known = new Set(turn.seen.map((entry) => entry.id));
  const seen = [...turn.seen, ...entries.filter((entry) => !known.has(entry.id))];
  return chat.map((one, index) => (index === at ? { ...turn, steps: [...turn.steps, step], seen } : one));
}

/** What one tool call of the search agent gave back, for its step line. */
export type StepResult = { isOk: boolean; entries: ReadonlyArray<JournalEntry> };

/**
 * One tool call of the search agent as the chat shows its progress, in words:
 * what it did, what it found, where, and when.
 */
export function stepOf(
  tool: string,
  input: Record<string, unknown>,
  result: StepResult,
  seen: ReadonlyArray<JournalEntry> = [],
  timeZone?: string,
): string {
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const project = text(input.project);
  const where = project === '.' ? 'this project' : project !== '' ? project : 'all projects';
  const range = rangeText(text(input.since), text(input.until), timeZone);
  const n = result.entries.length;
  const count = (one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = (head: string) => [head, where, range].filter(Boolean).join(' · ');
  if (tool.endsWith('__list')) {
    const terms = Array.isArray(input.terms) ? input.terms.filter((term) => typeof term === 'string') : [];
    if (terms.length === 0)
      return result.isOk ? parts(`Listed ${count('entry', 'entries')}`) : `${parts('Listing')}${FAILED_STEP}`;
    const query = terms.map((term) => `"${term}"`).join(' ');
    return result.isOk
      ? parts(`Searched ${query} · ${count('match', 'matches')}`)
      : `${parts(`Searching ${query}`)}${FAILED_STEP}`;
  }
  if (tool.endsWith('__read')) {
    const which = Array.isArray(input.which) ? input.which.map(text) : [text(input.which)];
    const id = which.join(', ');
    if (!result.isOk) return `Reading ${id}${FAILED_STEP}`;
    if (which.length !== 1) return `Read ${count('entry', 'entries')}`;
    const known = [...result.entries, ...seen].find((entry) => entry.id === id);
    if (known?.summary) return `Read: ${known.summary}`;
    const instant = instantOf(id);
    if (!instant) return `Read ${id}`;
    const when = localDayTime(instant, timeZone);
    return `Read the entry of ${dayText(when.day)}, ${when.time}`;
  }
  return tool;
}

/** Shows one entry in full. */
export async function openEntry(host: Host, id: string): Promise<void> {
  await host.opened.update((): JournalOpened => ({ id, status: 'loading', text: '' }));
  const ran = await runCli(host, readArgs([id]));
  await host.opened.update((opened): JournalOpened => {
    if (opened?.id !== id) return opened;
    return ran.exitCode === 0
      ? { id, status: 'ready', text: ran.stdout }
      : { id, status: 'failed', text: failureOf(ran) };
  });
}

/** Presses and edits in the pane. Nothing they start may reject into the engine. */
export function actionsOf(host: Host, load: (isFresh?: boolean) => Promise<void>): PaneActions {
  const quietly = (work: () => Promise<unknown>) => void work().catch(() => undefined);
  return {
    chooseScope: (scope) =>
      quietly(async () => {
        await host.scope.update(() => scope);
        await host.top.update(() => 0);
        await load(true);
      }),
    chooseModel: (model) => quietly(() => host.model.update(() => model)),
    chooseDateUnit: (unit) =>
      quietly(async () => {
        await host.date.update((date) => withUnit(date, unit, localDayTime(new Date()).day));
        await host.top.update(() => 0);
        await load(true);
      }),
    stepDate: (by) =>
      quietly(async () => {
        const today = localDayTime(new Date()).day;
        const date = await host.date.read();
        if (by > 0 && isLatest(date, today)) return;
        await host.date.update(() => stepped(date, by));
        await host.top.update(() => 0);
        await load(true);
      }),
    ask: (question) => quietly(() => ask(host, question)),
    open: (id) => quietly(() => openEntry(host, id)),
    back: () => quietly(() => host.opened.update(() => null)),
    showChat: () => quietly(() => host.view.update((): JournalView => 'chat')),
    showList: () => quietly(() => host.view.update((): JournalView => 'list')),
    clearChat: () => quietly(() => host.chat.update((chat) => chat.filter((turn) => turn.status === 'asking'))),
    close: () => quietly(() => host.closePane()),
    sendToPrompt: (id) =>
      quietly(async () => {
        const opened = await host.opened.read();
        if (opened?.id !== id || opened.status !== 'ready') return;
        await host.fillPrompt(`Journal entry ${id}:\n\n${opened.text.trim()}\n\n`);
      }),
  };
}
