/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { Register, Timer } from 'claude-code';
import { atom, read, update } from 'claude-code';
import { agentSpec, scopeOf, searchModelOf, TOOL_SPECS } from './agent.js';
import { capped, entriesOf, InputError, listArgs, readArgs, searchArgs, type Filters } from './cli.js';
import { ALL_DATES, entryOfText } from './format.js';
import type { Host } from './host.js';
import {
  actionsOf,
  answerWaiter,
  ask,
  type AskOutcome,
  busyNotice,
  failureOf,
  isAskingFor,
  listLoader,
  recorded,
  rulesKeeper,
  runCli,
  stepOf,
} from './journal.js';
import {
  AGENT_TYPE,
  COMMAND,
  COMMAND_DESCRIPTION,
  PANE_ID,
  PANE_TITLE,
  TOOL_LIST,
  TOOL_READ,
  TOOL_SEARCH,
  toolName,
} from './names.js';
import type { JournalView } from '../types';
import { listLayoutOf, listTopRows, PADDING, paneView, SUGGESTIONS, windowOf } from './pane-view.js';

const listAtom = atom({ plugin: 'agent-journal', key: 'list' } as const, {
  status: 'idle',
  entries: [],
  error: '',
  limit: 0,
  hasMore: false,
});
const viewAtom = atom({ plugin: 'agent-journal', key: 'view' } as const, 'list');
const chatAtom = atom({ plugin: 'agent-journal', key: 'chat' } as const, []);
const openedAtom = atom({ plugin: 'agent-journal', key: 'opened' } as const, null);
const topAtom = atom({ plugin: 'agent-journal', key: 'top' } as const, 0);
const dateAtom = atom({ plugin: 'agent-journal', key: 'date' } as const, ALL_DATES);
const noticeAtom = atom({ plugin: 'agent-journal', key: 'notice' } as const, '');

/** The pane's choices kept in the store, so they last across sessions: which entries, and which model answers. */
const SCOPE_KEY = 'scope';
const MODEL_KEY = 'model';

/** How often an open question redraws its elapsed time. */
const TICK_MS = 1_000;

/** Several writes to the journal in a row reload the list once. */
const REFRESH_DEBOUNCE_MS = 200;

export const register: Register = (on) => {
  /** The engine as the session bound it, for work that outlives the dispatch that started it. */
  let host: Host | null = null;
  /** Makes the rules for writing the journal and gives them to the main conversation. */
  let keeper: ReturnType<typeof rulesKeeper> | null = null;
  let loader: ReturnType<typeof listLoader> | null = null;
  let refresh: Timer | null = null;
  /** Whether the pane redraws each second, which it does only while a question is open. */
  let isTicking = false;
  /** The current project's name, read once a session: every drawing and every turn of the wheel needs it. */
  let currentProject: string | null = null;
  /** The rows the pane's body had when it was last drawn, which a scroll measures the list's window by. */
  let paneRows = 0;
  /** Waits for each search agent's answer and settles its question. */
  let waiter: ReturnType<typeof answerWaiter> | null = null;

  const load = (isFresh?: boolean) => loader?.load(isFresh) ?? Promise.resolve();

  /** While a question is open, the pane redraws each second, so its elapsed time counts up. */
  function tick(bound: Host): void {
    if (isTicking) return;
    isTicking = true;
    const step = () =>
      bound.after(TICK_MS, () => {
        void bound.chat
          .read()
          .then((chat) => {
            if (!chat.some((turn) => turn.status === 'asking')) return void (isTicking = false);
            bound.redraw();
            step();
          })
          .catch(() => void (isTicking = false));
      });
    step();
  }

  /** Asks from the pane or the command, and says so when another question is still being answered. */
  async function askFrom(bound: Host, question: string): Promise<AskOutcome> {
    const outcome = await ask(bound, question).catch((): AskOutcome => 'failed');
    await bound.notice.update(() => (outcome === 'busy' ? busyNotice(question) : ''));
    if (outcome === 'asked') tick(bound);
    return outcome;
  }

  on('session.start', async ($, e, next) => {
    const started = await next(e);
    host = {
      pluginRoot: $.plugin.root,
      cwd: () => $.session.cwd(),
      sessionId: () => $.session.id(),
      mainModel: () => $.session.model(),
      agentStatus: async (agentId) => (await $.agent.list()).find((agent) => agent.id === agentId)?.status,
      agentMessages: async (agentId) => {
        const found = await $.session.messages({ agentId }).catch(() => null);
        return Array.isArray(found) ? found : [];
      },
      isFile: async (path) => {
        try {
          return (await $.fs.stat(path)).kind === 'file';
        } catch {
          return false;
        }
      },
      realPath: async (path) => {
        try {
          return (await $.fs.stat(path, { resolve: true })).realPath;
        } catch {
          return undefined;
        }
      },
      run: (argv, cwd, timeoutMs) => $.process.run(argv, { cwd, timeoutMs }),
      spawn: async (prompt, model) => {
        const spawned = await $.agent.spawn({
          subagentType: AGENT_TYPE,
          description: 'Search the journal',
          prompt,
          ...(model ? { model } : {}),
        });
        return 'deny' in spawned && spawned.deny ? { deny: spawned.deny } : { agentId: spawned.agentId };
      },
      openPane: async () =>
        (await $.ui.open({ id: PANE_ID, title: PANE_TITLE, focus: true, holdToasts: true })).isPlaced,
      closePane: () => $.ui.close({ id: PANE_ID }),
      fillPrompt: (text) => $.prompt.fill({ text, mode: 'insert' }),
      toast: (text) => $.ui.toast(text),
      after: (ms, fn) => $.clock.after(ms, fn),
      scope: {
        read: async () => scopeOf(await $.store.get(SCOPE_KEY)),
        update: async (change) => $.store.set(SCOPE_KEY, change(scopeOf(await $.store.get(SCOPE_KEY)))),
      },
      model: {
        read: async () => searchModelOf(await $.store.get(MODEL_KEY)),
        update: async (change) => $.store.set(MODEL_KEY, change(searchModelOf(await $.store.get(MODEL_KEY)))),
      },
      list: { read: () => read($, listAtom), update: (change) => update($, listAtom, change) },
      view: { read: () => read($, viewAtom), update: (change) => update($, viewAtom, change) },
      chat: { read: () => read($, chatAtom), update: (change) => update($, chatAtom, change) },
      top: { read: () => read($, topAtom), update: (change) => update($, topAtom, change) },
      date: { read: () => read($, dateAtom), update: (change) => update($, dateAtom, change) },
      notice: { read: () => read($, noticeAtom), update: (change) => update($, noticeAtom, change) },
      redraw: () => $.ui.invalidate('ui.render'),
      conversationText: async () => {
        const messages = await $.session.messages({ as: 'api' });
        return messages
          .flatMap((message) => message.content)
          .map((block) => (typeof block.text === 'string' ? block.text : ''))
          .join('\n');
      },
      appendNote: async (text) => {
        await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } });
      },
      opened: { read: () => read($, openedAtom), update: (change) => update($, openedAtom, change) },
    };
    loader = listLoader(host);
    waiter = answerWaiter(host);
    keeper = rulesKeeper(host);
    /** Made now, so the first message does not wait for the CLI. */
    void keeper.prepare().catch(() => undefined);
    currentProject = projectOf(await $.session.repo().catch(() => null));
    for (const spec of TOOL_SPECS) await $.tool.register(spec);
    await $.agent.register(agentSpec());
    await $.command.register({ name: COMMAND, description: COMMAND_DESCRIPTION });
    return started;
  });

  /**
   * The engine builds the main conversation's context at its start, after
   * /clear and after compaction, and subagents reuse it. So this is when the
   * main conversation may need the rules again, but they are not put into the
   * shared context, which subagents would read too: they go to the main
   * conversation as a row of their own.
   */
  on('prompt.context', async ($, e, next) => {
    const result = await next(e);
    if (keeper) await keeper.deliver().catch(() => undefined);
    return result;
  }).catch(($, e, next) => next(e));

  /**
   * Compaction replaces the main conversation with its summary, and the rules
   * with it, after the engine has already rebuilt the context. So once the
   * compacted conversation is in place, the rules are given again. A message
   * handed up with the compaction would be stored as one the person typed,
   * which is why they come as the same hidden row as at the start. A
   * subagent's compaction is its own, and a precompute installs nothing.
   */
  on('session.compact', async ($, e, next) => {
    const result = await next(e);
    if (!host || !keeper || e.agentId !== undefined || e.trigger === 'precompute' || !result.messages) return result;
    const delivery = keeper;
    host.after(0, () => void delivery.deliver().catch(() => undefined));
    return result;
  }).catch(($, e, next) => next(e));

  /** The search agent is this mod's own: the main model never sees it. */
  on('agent.offer', { agent: 'agent-journal:search' }, () => ({ isOffered: false }));

  /** The main model may find the journal tools, but they take no room in its prompt. */
  on('tool.describe', { tool: /^mcp__agent-journal__(list|search|read)$/ }, async ($, e, next) => ({
    ...(await next(e)),
    isDeferred: true,
  }));

  /**
   * A spawn this mod makes comes from no model response, so the auto mode
   * classifier has no verdict for it and denies it. Approves only the search
   * agent when this mod itself starts it, and the three tools, which only read
   * the journal. Every other call goes through the normal checks.
   */
  on('tool.check', { tool: 'Agent' }, ($, e, next) => {
    const input = e.input as { subagent_type?: string } | undefined;
    const isOwnSpawn = next.origin?.plugin === $.plugin.name && input?.subagent_type === AGENT_TYPE;
    return isOwnSpawn ? { decision: 'allow', reason: 'started by /journal' } : next(e);
  });
  on('tool.check', { tool: /^mcp__agent-journal__(list|search|read)$/ }, () => ({
    decision: 'allow',
    reason: 'reads the journal',
  }));

  on('tool.call', { tool: /^mcp__agent-journal__(list|search|read)$/ }, async ($, e, next) => {
    if (!host) return next(e);
    const input = e as unknown as Record<string, unknown>;
    const filters: Filters = {
      since: typeof input.since === 'string' ? input.since : undefined,
      until: typeof input.until === 'string' ? input.until : undefined,
      project: typeof input.project === 'string' ? input.project : undefined,
      limit: typeof input.limit === 'number' ? input.limit : undefined,
    };
    let args: Array<string>;
    try {
      if (e.tool === toolName(TOOL_LIST)) args = listArgs(filters);
      else if (e.tool === toolName(TOOL_SEARCH)) args = searchArgs(String(input.text ?? ''), filters);
      else if (e.tool === toolName(TOOL_READ)) args = readArgs(String(input.id ?? ''));
      else return { deny: `unknown journal tool ${e.tool}` };
    } catch (error) {
      if (error instanceof InputError) return { deny: error.message };
      throw error;
    }
    const ran = await runCli(host, args);
    const agentId = e.agentId;
    if (agentId) {
      const found =
        ran.exitCode !== 0 ? [] : e.tool === toolName(TOOL_READ) ? entryOfText(ran.stdout) : entriesOf(ran.stdout);
      await update($, chatAtom, (chat) => {
        const seen = chat.flatMap((turn) => turn.seen);
        const step = stepOf(e.tool, input, { isOk: ran.exitCode === 0, entries: found }, seen);
        return recorded(chat, agentId, step, found);
      }).catch(() => undefined);
    }
    if (ran.exitCode !== 0) return { deny: failureOf(ran) };
    return { result: capped(ran.stdout) || 'No entries match.' };
  });

  on('command.run', { command: 'journal' }, async ($, e, next) => {
    if (!host) return next(e);
    const question = e.args.trim();
    const isPlaced = await host.openPane();
    void load().catch(() => undefined);
    const waiting = isPlaced ? '' : ' The journal pane is waiting for a wider terminal.';
    if (question === '') return waiting ? { text: waiting.trim() } : {};
    await host.view.update((): JournalView => 'chat');
    await host.opened.update(() => null);
    /** Waits until the agent has started, so its answer always finds the question. */
    const outcome = await askFrom(host, question);
    if (outcome === 'busy') return { text: `${busyNotice(question)}${waiting}` };
    const asked = (await host.chat.read()).at(-1);
    if (outcome === 'failed' && asked?.status === 'failed') return { text: `${asked.answer}${waiting}` };
    return { text: `Asking the journal: ${question}${waiting}` };
  });

  /** The search agent's last turn is its answer. */
  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    const agentId = e.agentId;
    if (!agentId) return result;
    if (!host || !waiter || !isAskingFor(await read($, chatAtom), agentId)) return result;
    await waiter.turnEnded(agentId, typeof e.answer === 'string' ? e.answer : '', Boolean(e.isAborted));
    return result;
  });

  /** A new entry shows in the list without a reload by hand. */
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const result = await next(e);
    const dir = loader?.journalDir();
    const isRefused = 'deny' in result && Boolean(result.deny);
    if (dir && !isRefused && String(e.file_path).startsWith(`${dir}/`)) {
      refresh?.cancel();
      refresh = $.clock.after(REFRESH_DEBOUNCE_MS, () => void loader?.refresh().catch(() => undefined));
    }
    return result;
  });

  /**
   * A spawn made from a Button's or an Input's own closure reaches the auto
   * mode classifier without this mod's permission hook, which then denies it for
   * want of a verdict. Made inside a hook, as from the slash command, the hook
   * approves it. So the pane's questions are asked here, and the press or the
   * submit is answered without its closure.
   */
  on('ui.press', async ($, e, next) => {
    if (!host || e.plugin !== $.plugin.name || !e.element.startsWith('suggest:')) return next(e);
    const question = SUGGESTIONS[Number(e.element.slice('suggest:'.length))];
    if (question === undefined) return next(e);
    await askFrom(host, question);
    return { element: e.element };
  });
  on('ui.input', async ($, e, next) => {
    if (!host || e.plugin !== $.plugin.name || e.element !== 'ask' || e.kind !== 'submit') return next(e);
    await askFrom(host, e.value);
    return { element: e.element, value: e.value };
  });

  /** Esc steps back: from an entry to the view under it, from the chat to the list. In the list it closes the pane. */
  on('ui.close', async ($, e, next) => {
    if (e.id !== PANE_ID || e.origin.kind !== 'person') return next(e);
    if ((await read($, openedAtom)) !== null) {
      await update($, openedAtom, () => null);
      return { deny: 'back' };
    }
    if ((await read($, viewAtom)) === 'chat') {
      await update($, viewAtom, (): JournalView => 'list');
      return { deny: 'back to the list' };
    }
    return next(e);
  }).catch(($, e, next) => next(e));

  /**
   * The list draws only the rows in view, so it scrolls itself: a move in the
   * list view shifts its first row and leaves the engine's window where it is.
   * Near the end the next page loads. Other views scroll as the engine does.
   */
  on('ui.scroll', { component: 'Pane', requestId: 'journal' }, async ($, e, next) => {
    if (!host || !loader) return next(e);
    const [view, opened, list, scope] = await Promise.all([
      read($, viewAtom),
      read($, openedAtom),
      read($, listAtom),
      host.scope.read(),
    ]);
    if (opened !== null || view !== 'list' || list.entries.length === 0) return next(e);
    const { lines } = listLayoutOf(list, new Date());
    const topRows = listTopRows({ scope, currentProject, list, journalDir: loader.journalDir() });
    const current = windowOf(lines.length, paneRows, topRows, await read($, topAtom));
    const moved = windowOf(lines.length, paneRows, topRows, current.top + e.by);
    if (moved.top !== current.top) await update($, topAtom, () => moved.top);
    if (moved.top + 2 * moved.rows >= lines.length) void loader.loadMore().catch(() => undefined);
    return {};
  }).catch(($, e, next) => next(e));

  on('ui.render', { component: 'Pane', requestId: 'journal' }, async ($, e, next) => {
    if (!host || e.surface === 'mobile') return next(e);
    const { Box, Text, Button, Input, Markdown } = await $.ui.resolve(e);
    const [scope, view, list, chat, opened, top, date, notice, model, sessionModel] = await Promise.all([
      host.scope.read(),
      read($, viewAtom),
      read($, listAtom),
      read($, chatAtom),
      read($, openedAtom),
      read($, topAtom),
      read($, dateAtom),
      read($, noticeAtom),
      host.model.read(),
      $.session.model().catch(() => ''),
    ]);
    paneRows = e.props.scroll.bodyRows;
    return paneView({ Box, Text, Button, Input, Markdown }, actionsOf(host, load), {
      scope,
      model,
      sessionModel,
      journalDir: loader?.journalDir() ?? null,
      view,
      list,
      chat,
      opened,
      columns: Math.max(e.props.bodyColumns - 2 * PADDING - 1, 20),
      surface: e.surface,
      currentProject,
      now: new Date(),
      bodyRows: paneRows,
      top,
      date,
      notice,
    });
  });
};

/** The current project's name: the last part of the repository's root, or null outside one. */
const projectOf = (repo: { root: string } | null): string | null =>
  repo ? (repo.root.split('/').filter(Boolean).pop() ?? null) : null;
