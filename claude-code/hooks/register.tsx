/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { Register, Timer } from 'claude-code';
import { atom, read, update } from 'claude-code';
import { AGENT_PROMPT, scopeOf, searchModelOf, TOOL_SPECS, WRITE_SPEC } from './agent.js';
import {
  type ByField,
  capped,
  entriesOf,
  fitList,
  InputError,
  isCut,
  isPeriod,
  listArgs,
  MAX_LIMIT,
  MAX_OUTPUT,
  offsetOf,
  readArgs,
  withNote,
  withOlder,
  writeArgs,
  writtenIdOf,
  type Query,
} from './cli.js';
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
  endSyncTimeoutOf,
  runCli,
  sessionOf,
  stepOf,
  syncer,
} from './journal.js';
import {
  AGENT_NAME,
  AGENT_TOOLS,
  AGENT_TYPE,
  COMMAND,
  COMMAND_DESCRIPTION,
  DENIED_TOOLS,
  IS_ASK_ON,
  PANE_ID,
  PANE_TITLE,
  TOOL_LIST,
  TOOL_READ,
  TOOL_WRITE,
  isToolsOn,
  toolName,
} from './names.js';
import type { JournalView } from '../types';
import { listLayoutOf, listOuterRows, PADDING, paneView, SUGGESTIONS, windowOf } from './pane-view.js';

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
const syncAtom = atom({ plugin: 'agent-journal', key: 'sync' } as const, { status: 'off', text: '' });

/** The pane's choices kept in the store, so they last across sessions: which entries, and which model answers. */
const SCOPE_KEY = 'scope';
const MODEL_KEY = 'model';

/** How often an open question redraws its elapsed time. */
const TICK_MS = 1_000;

/** Several writes to the journal in a row reload the list, and sync it, once. */
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
  /** Commits and pushes the journal folder after writes, when the config turns sync on. */
  let sync: ReturnType<typeof syncer> | null = null;
  /** Whether a draw has already asked for the load of a list that was never loaded. */
  let isIdleLoadQueued = false;

  const load = (isFresh?: boolean) => loader?.load(isFresh) ?? Promise.resolve();

  /**
   * A new entry shows in the list without a reload by hand, and is committed
   * and pushed when sync is on. Several writes in a row do this once, after
   * the last. The sync runs on its own, so a push never holds up the turn.
   */
  function journalWritten(bound: Host, list: ReturnType<typeof listLoader>, syncing: ReturnType<typeof syncer>): void {
    void list
      .config()
      .then(({ isSyncOn }) => {
        refresh?.cancel();
        refresh = bound.after(REFRESH_DEBOUNCE_MS, () => {
          /** A list nobody has opened is left for the pane to load when it opens. */
          void bound.list
            .read()
            .then((shown) => (shown.status === 'idle' ? undefined : list.refresh()))
            .catch(() => undefined);
          if (isSyncOn) void syncing.request().catch(() => undefined);
        });
      })
      .catch(() => undefined);
  }

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
    /** Read once, at the start, since the tools are registered then. The engine takes the name only as a literal. */
    const hasTools = isToolsOn(await $.env.get('AGENT_JOURNAL_TOOLS'));
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
      sync: { read: () => read($, syncAtom), update: (change) => update($, syncAtom, change) },
      redraw: () => $.ui.invalidate('ui.render'),
      conversationHas: async (text) => {
        const messages = await $.session.messages({ as: 'api' });
        return messages.some((message) =>
          message.content.some((block) => typeof block.text === 'string' && block.text.includes(text)),
        );
      },
      canCallTools: async () => {
        if (!hasTools) return false;
        /** The engine refuses to check a tool that a deny rule took out of the session. */
        const verdicts = await Promise.all(
          [TOOL_WRITE, TOOL_LIST, TOOL_READ].map((name) =>
            $.tool.check({ tool: toolName(name), input: {} }).catch(() => null),
          ),
        );
        return verdicts.every((verdict) => verdict !== null && verdict.decision !== 'deny');
      },
      appendNote: async (text) => {
        await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } });
      },
      opened: { read: () => read($, openedAtom), update: (change) => update($, openedAtom, change) },
    };
    /**
     * The journal's tools, for the main conversation, and the search agent's
     * too while the pane answers questions. Registered before the rules are
     * made, which give the variant for the tools only when the session has them.
     * With the tools turned off, the model writes and reads the entries as files.
     */
    if (hasTools) for (const spec of [...TOOL_SPECS, WRITE_SPEC]) await $.tool.register(spec);
    loader = listLoader(host);
    waiter = answerWaiter(host);
    sync = syncer(host);
    /**
     * Read now, so a write before the pane is opened is known as one to the
     * journal. With sync on, the session starts with a sync, which brings in
     * what other machines pushed, and the list shows their entries after it.
     */
    const [bound, list, syncing] = [host, loader, sync];
    void loader
      .config()
      .then(async ({ isSyncOn }) => {
        if (!isSyncOn) return;
        await syncing.request();
        /** A list nobody has opened is left for the pane to load when it opens. */
        if ((await bound.list.read()).status !== 'idle') await list.refresh();
      })
      .catch(() => undefined);
    keeper = rulesKeeper(host);
    /** Made now, so the first message does not wait for the CLI. */
    void keeper.prepare().catch(() => undefined);
    currentProject = projectOf(await $.session.repo().catch(() => null));
    /** The agent that answers the pane's questions, while it answers any (see IS_ASK_ON). */
    if (IS_ASK_ON) {
      /**
       * The agent type. It runs on the session's model unless a question names
       * another, so the model can change between questions. Its permission mode
       * is the session's, and the person's own rules decide its spawn and its tool
       * calls.
       */
      await $.agent.register({
        name: AGENT_NAME,
        description: 'Answers a question about past work from the agent journal. Started only by /agent-journal.',
        prompt: AGENT_PROMPT,
        tools: AGENT_TOOLS,
        disallowedTools: DENIED_TOOLS,
        omitClaudeMd: true,
        model: 'inherit',
        maxTurns: 12,
      });
    }
    await $.command.register({ name: COMMAND, description: COMMAND_DESCRIPTION });
    return started;
  });

  /**
   * The engine builds the main conversation's context at its start, after
   * /clear and after compaction, and subagents reuse it. So this is when the
   * main conversation may need the rules again, but they are not put into the
   * shared context, which subagents would read too: they go to the main
   * conversation as a row of their own. Where Claude Code's built-in guard is
   * seated, this hook does not run, and the prompt hook below gives them.
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
   * Under the built-in guard this hook does not run either.
   */
  on('session.compact', async ($, e, next) => {
    const result = await next(e);
    if (!host || !keeper || e.agentId !== undefined || e.trigger === 'precompute' || !result.messages) return result;
    const delivery = keeper;
    delivery.forget();
    host.after(0, () => void delivery.deliver().catch(() => undefined));
    return result;
  }).catch(($, e, next) => next(e));

  /**
   * Where Claude Code's built-in guard is seated (a Team or Enterprise plan,
   * or managed settings on the machine), a person's plugin no longer runs on
   * `prompt.context` or `session.compact`, but keeps `prompt.submit` and the
   * context it adds. So each prompt carries the rules while the conversation
   * lacks them: the first one, and the first after a /clear or a compaction.
   * Without the guard, the hooks above have given them by then, and the
   * prompt carries nothing.
   */
  on('prompt.submit', async ($, e, next) => {
    const block = keeper ? await keeper.forPrompt().catch(() => null) : null;
    return next(block ? { ...e, context: [...(e.context ?? []), block] } : e);
  }).catch(($, e, next) => next(e));

  /** A turn begins with the prompts that were waiting, so the rules a prompt carried are in the conversation now. */
  on('turn.start', async ($, e, next) => {
    keeper?.turnStarted();
    return next(e);
  });

  /** The search agent is this mod's own: the main model never sees it. It exists only while the pane answers questions (see IS_ASK_ON). */
  if (IS_ASK_ON) on('agent.offer', { agent: 'agent-journal:search' }, () => ({ isOffered: false }));

  /**
   * The main model may find the tools that read the journal, but they take no
   * room in its prompt: the rules name them, so it loads them by name when it
   * is asked about past work. Writing is what every session does, so that
   * tool's schema stays in the prompt.
   */
  on('tool.describe', { tool: /^mcp__agent-journal__(list|read|write)$/ }, async ($, e, next) => ({
    ...(await next(e)),
    isDeferred: e.tool !== toolName(TOOL_WRITE),
  }));

  /**
   * One new entry, for the session as it is now. Only the main conversation
   * writes the journal, so a subagent's call is refused before the CLI runs.
   *
   * The hook answers the call itself, so no permission check runs: only a deny
   * rule for the tool stops it. Workaround for anthropics/claude-code#104217,
   * tracked in zirkelc/issues#22. Remove both when the fix is adopted.
   */
  on('tool.call', { tool: /^mcp__agent-journal__write$/ }, async ($, e, next) => {
    if (e.agentId) return { deny: 'Only the main conversation writes journal entries.' };
    const [bound, list, syncing] = [host, loader, sync];
    if (!bound || !list || !syncing) return next(e);
    const input = e as unknown as Record<string, unknown>;
    const session = await sessionOf(bound);
    let args: Array<string>;
    try {
      const summary = typeof input.summary === 'string' ? input.summary : '';
      const body = typeof input.body === 'string' ? input.body : '';
      args = writeArgs(summary, body, session.cwd, session.sessionId, session.agent);
    } catch (error) {
      if (error instanceof InputError) return { deny: error.message };
      throw error;
    }
    const ran = await runCli(bound, args);
    const id = ran.exitCode === 0 ? writtenIdOf(ran.stdout) : undefined;
    if (!id) return { deny: failureOf(ran) };
    journalWritten(bound, list, syncing);
    return { result: id };
  });

  /** Answered here too, with no permission check: see anthropics/claude-code#104217, tracked in zirkelc/issues#22. */
  on('tool.call', { tool: /^mcp__agent-journal__(list|read)$/ }, async ($, e, next) => {
    if (!host) return next(e);
    const input = e as unknown as Record<string, unknown>;
    const query = queryOf(input);
    const isRead = e.tool === toolName(TOOL_READ);
    const which = isRead ? stringsOf(input.which) : [];
    let args: Array<string>;
    try {
      if (e.tool === toolName(TOOL_LIST)) args = listArgs(query);
      else if (isRead) args = readArgs(which, query);
      else return { deny: `unknown journal tool ${e.tool}` };
    } catch (error) {
      if (error instanceof InputError) return { deny: error.message };
      throw error;
    }
    const ran = await runCli(host, args);
    /**
     * Exit 1 of `read` is an answer: nothing matches, or an id prefix matches
     * several entries, whose ids the model needs to read the one it means.
     */
    const isNoMatch = isRead && ran.exitCode === 1;
    const isOk = ran.exitCode === 0 || isNoMatch;
    /**
     * The steps of the search agent, for the chat in the pane, only while that
     * agent exists (see IS_ASK_ON). Every subagent can call these tools, and a
     * call of an agent without a turn in the chat changes nothing. The step
     * reads the parsed values, since the model can give a list as a JSON string.
     */
    const agentId = e.agentId;
    if (IS_ASK_ON && agentId) {
      const found = ran.exitCode !== 0 ? [] : isRead ? entryOfText(ran.stdout) : entriesOf(ran.stdout);
      const parsed = { ...input, which, terms: query.terms };
      await update($, chatAtom, (chat) => {
        const seen = chat.flatMap((turn) => turn.seen);
        const step = stepOf(e.tool, parsed, { isOk, entries: found }, seen);
        return recorded(chat, agentId, step, found);
      }).catch(() => undefined);
    }
    if (!isOk) return { deny: failureOf(ran) };
    if (isNoMatch) return { result: capped(ran.stderr.trim() || 'No entries match.') };
    if (!isRead) {
      if (query.by) return { result: capped(withNote(ran.stdout, ran.stderr)) };
      const text = fitList(ran.stdout, ran.stderr, offsetOf(query)) ?? withNote(ran.stdout, ran.stderr);
      if (!isCut(text)) return { result: capped(text || 'No entries match.') };
      /** The same filters counted by day, for the note on what the cut left out. */
      const counted = await runCli(host, listArgs({ ...query, limit: undefined, offset: undefined, by: 'date' }));
      return { result: capped(counted.exitCode === 0 ? withOlder(text, counted.stdout) : text) };
    }
    const text = withNote(ran.stdout, ran.stderr);
    const period = which.length === 1 && isPeriod(which[0]!) ? which[0]! : undefined;
    if (!period || text.length <= MAX_OUTPUT) return { result: capped(text) };
    /** Cut text would lose the last entries without a word, so a long period gives the summaries of the same page instead. */
    const { project, cwd, host: machine, user, agent, limit, offset } = query;
    const listed = await runCli(
      host,
      listArgs({ date: period, project, cwd, host: machine, user, agent, limit: limit ?? MAX_LIMIT, offset }),
    );
    if (listed.exitCode !== 0) return { result: capped(text) };
    const cut = fitList(listed.stdout, listed.stderr, offsetOf(query)) ?? withNote(listed.stdout, listed.stderr);
    /** The same period counted by day, for the note on what the cap left out, as a list gives it. */
    const counted = isCut(cut)
      ? await runCli(host, listArgs({ date: period, project, cwd, host: machine, user, agent, by: 'date' }))
      : undefined;
    const summaries = counted?.exitCode === 0 ? withOlder(cut, counted.stdout) : cut;
    return {
      result: capped(
        `The entries of ${period} are ${text.length} characters, more than one result holds. Their summaries follow; read the ones you need by id.\n${summaries}`,
      ),
    };
  });

  on('command.run', { command: 'agent-journal' }, async ($, e, next) => {
    if (!host) return next(e);
    /** Text after the command is a question only while the pane answers questions. */
    const question = IS_ASK_ON ? e.args.trim() : '';
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

  if (IS_ASK_ON) {
    /** The search agent's last turn is its answer. */
    on('turn.complete', async ($, e, next) => {
      const result = await next(e);
      const agentId = e.agentId;
      if (!agentId) return result;
      if (!host || !waiter || !isAskingFor(await read($, chatAtom), agentId)) return result;
      await waiter.turnEnded(agentId, typeof e.answer === 'string' ? e.answer : '', Boolean(e.isAborted));
      return result;
    });
  }

  /** An entry written as a file, as the person may still ask for, counts as a write to the journal too. */
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const result = await next(e);
    const isRefused = 'deny' in result && Boolean(result.deny);
    const [bound, list, syncing] = [host, loader, sync];
    if (isRefused || !bound || !list || !syncing) return result;
    const path = String(e.file_path);
    void list
      .config()
      .then(({ journalDir }) => {
        if (journalDir && path.startsWith(`${journalDir}/`)) journalWritten(bound, list, syncing);
      })
      .catch(() => undefined);
    return result;
  });

  /**
   * The last chance to commit what was written another way than the journal's
   * tool or the Write tool, or in the moment before the exit. The engine
   * bounds the whole exit, so the sync gets what is left of that bound; a push
   * it cuts short is made by the next sync.
   */
  on('session.end', async ($, e, next) => {
    const timeoutMs = sync && loader?.isSyncOn() ? endSyncTimeoutOf(next.budget.remainingMs, sync.isRunning()) : null;
    /** Beside the end step rather than before it, so the hooks after this one keep their share of the bound. */
    /** Without a pull first, since the next session's start pulls anyway, so the exit does not wait for it. */
    const syncing = sync && timeoutMs !== null ? sync.request(timeoutMs, false).catch(() => undefined) : null;
    const result = await next(e);
    await syncing;
    return result;
  });

  if (IS_ASK_ON) {
    /**
     * The pane's questions are asked here, in a hook, rather than from a
     * Button's or an Input's own closure, and the press or the submit is answered
     * without its closure.
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
  }

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
    const outerRows = listOuterRows({ scope, currentProject, list, journalDir: loader.journalDir() });
    const current = windowOf(lines.length, paneRows, outerRows, await read($, topAtom));
    const moved = windowOf(lines.length, paneRows, outerRows, current.top + e.by);
    if (moved.top !== current.top) await update($, topAtom, () => moved.top);
    if (moved.top + 2 * moved.rows >= lines.length) void loader.loadMore().catch(() => undefined);
    return {};
  }).catch(($, e, next) => next(e));

  on('ui.render', { component: 'Pane', requestId: 'journal' }, async ($, e, next) => {
    if (!host || e.surface === 'mobile') return next(e);
    const { Box, Text, Button, Input, Markdown } = await $.ui.resolve(e);
    const [scope, view, list, chat, opened, top, date, notice, syncState, model, sessionModel] = await Promise.all([
      host.scope.read(),
      read($, viewAtom),
      read($, listAtom),
      read($, chatAtom),
      read($, openedAtom),
      read($, topAtom),
      read($, dateAtom),
      read($, noticeAtom),
      read($, syncAtom),
      host.model.read(),
      $.session.model().catch(() => ''),
    ]);
    paneRows = e.props.scroll.bodyRows;
    /**
     * A list that was never loaded, although the pane is open: after /clear the
     * session's values start over while the pane stays, and no event says so.
     * A draw cannot write, so the load starts just after it.
     */
    if (list.status === 'idle' && !isIdleLoadQueued) {
      isIdleLoadQueued = true;
      host.after(0, () => {
        isIdleLoadQueued = false;
        void load().catch(() => undefined);
      });
    }
    return paneView({ Box, Text, Button, Input, Markdown }, actionsOf(host, load), {
      scope,
      model,
      sessionModel,
      journalDir: loader?.journalDir() ?? null,
      isSyncOn: loader?.isSyncOn() ?? false,
      sync: syncState,
      view,
      list,
      chat,
      opened,
      columns: Math.max(e.props.bodyColumns - 2 * PADDING - 1, 20),
      surface: e.surface,
      currentProject,
      now: new Date(),
      bodyRows: paneRows,
      isDocked: e.props.placement === 'dock',
      top,
      date,
      notice,
    });
  });
};

/** The current project's name: the last part of the repository's root, or null outside one. */
const projectOf = (repo: { root: string } | null): string | null =>
  repo ? (repo.root.split('/').filter(Boolean).pop() ?? null) : null;

/** A tool's input as the query of `list` or the filters of `read`: only the values of the right type count. */
function queryOf(input: Record<string, unknown>): Query {
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  const number = (value: unknown) => (typeof value === 'number' ? value : undefined);
  return {
    terms: stringsOf(input.terms),
    isFixed: input.fixed === true,
    date: text(input.date),
    since: text(input.since),
    until: text(input.until),
    project: text(input.project),
    cwd: text(input.cwd),
    host: text(input.host),
    user: text(input.user),
    agent: text(input.agent),
    limit: number(input.limit),
    offset: number(input.offset),
    /** Checked against the fields where the arguments are made. */
    by: input.by === undefined || input.by === null ? undefined : (String(input.by) as ByField),
  };
}

/**
 * A list of strings from a tool's input. A model sometimes gives a list as one
 * string, or as the JSON text of a list, so both count as the list.
 */
function stringsOf(value: unknown): Array<string> {
  let items: unknown = value;
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      items = JSON.parse(value);
    } catch {
      items = [value];
    }
  }
  const list = Array.isArray(items) ? items : typeof items === 'string' ? [items] : [];
  return list
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}
