import type { Args, On } from 'claude-code';
import { mock } from 'claude-code/testing';
import { COMMAND, PANE_ID, PLUGIN, toolName } from '../hooks/names.js';

/** One TSV line of `list` down a pipe. */
export const line = (id: string, project: string, summary: string): string => `${id}\t${project}\t${summary}`;

export const RECALL = '## Journal\n\nThe recall text.\n';
export const JOURNAL_DIR = '/home/me/journal';

/** What the CLI answers for an argv, by its subcommand. */
export type Script = {
  /** The lines `list` prints, or a function of its argv for a list that pages. */
  list?: string | ((argv: ReadonlyArray<string>) => string);
  read?: string;
  context?: string;
  /** What `write` prints: the new entry's path. */
  write?: string;
  /** Whether the config turns sync on, as `config` prints it. */
  isSyncOn?: boolean;
  /** What `sync` prints; off when not given. */
  sync?: string;
  /** A sync waits for this before it answers, so a test can end the session while one runs. */
  holdSync?: Promise<void>;
  /** A row appended waits for this before it is stored, so a test can submit a prompt while one is on its way. */
  holdAppend?: Promise<void>;
  /** A prompt waits for this before it enters the conversation, as one queued behind a running turn does. */
  holdSubmit?: Promise<void>;
  /** A `context` run waits for this before it answers, so a test can see what does not wait for the rules. */
  holdContext?: Promise<void>;
  failing?: string;
  /** A subcommand that fails on its first run only, as one that timed out once. */
  failsOnce?: string;
  /** The exit code of a subcommand that prints its output and still fails, such as a sync whose push failed. */
  exitCodes?: Record<string, number>;
  /** What a subcommand prints on stderr, such as the note of `list` that names the offset of older matches. */
  stderr?: Record<string, string>;
  /** The main conversation as its next request reads it: the text of each message. */
  conversation?: Array<string>;
  /** A spawn waits for this before it answers, so a question can stay open while a test asks again. */
  holdSpawn?: Promise<void>;
  /** A tool that a deny rule took out of the session, so the engine refuses to check it. */
  removed?: Array<string>;
  /** What the engine decides for a check of a tool the plugin did not register, such as Agent. */
  otherVerdict?: 'allow' | 'ask' | 'deny';
  /** The environment of the session, as the plugin reads it. */
  env?: Record<string, string>;
  /** Where a path lands once links are followed, or undefined when it does not exist. */
  lands?: (path: string) => string | undefined;
};

/**
 * A session in /work beneath the mod: the CLI answers from a script, and every
 * call the mod makes is kept for the test to look at.
 */
export function world(on: On, script: Script = {}) {
  const runs: Array<Args<'process.run'>> = [];
  const opened: Array<Args<'ui.open'>> = [];
  const spawned: Array<unknown> = [];
  const registered: { tools: Array<string>; agents: Array<Args<'agent.register'>>; commands: Array<string> } = {
    tools: [],
    agents: [],
    commands: [],
  };
  const toasts: Array<string> = [];
  const filled: Array<string> = [];

  const clock = mock.clock(on, { now: 0 });
  mock.env(on, script.env ?? {});
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('session.end', ($, e) => ({ sessionId: e.sessionId }));
  on('session.cwd', () => ({ value: '/work' }));
  on('session.id', () => ({ value: 'session-1' }));
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }));
  on('session.repo', () => ({ value: { root: '/work', remote: null, internal: false, name: null } }) as never);
  on('fs.stat', ($, e) => {
    const landsAt = script.lands?.(e.path);
    if (landsAt === undefined) return { deny: 'ENOENT' };
    return { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: landsAt !== e.path, realPath: landsAt } } as never;
  });
  on('command.register', ($, e) => (registered.commands.push(e.name), { value: { command: e.name } }));
  on('tool.register', ($, e) => (registered.tools.push(e.name), { value: { tool: toolName(e.name) } }));
  /**
   * A registered tool is in the session, so the engine puts a check of it to
   * the person, as it does without a rule. A tool that a deny rule removed is
   * not in the session, and the engine refuses to check it.
   */
  /** The tool of each permission check, in order: in auto mode, a check can go to the classifier. */
  const checks: Array<string> = [];
  on('tool.check', ($, e, next) => {
    checks.push(e.tool);
    if (script.removed?.includes(e.tool)) throw new Error(`no tool named "${e.tool}" in this session`);
    if (registered.tools.some((name) => toolName(name) === e.tool)) return { decision: 'ask' };
    return script.otherVerdict ? { decision: script.otherVerdict } : next(e);
  });
  on('agent.register', ($, e) => (registered.agents.push(e), { value: { agent: `${PLUGIN}:${e.name}` } }));
  /** Only the engine starts an agent and gives its id, so a spawn answered here never carries one. */
  on('agent.spawn', async ($, e) => {
    spawned.push(e);
    await script.holdSpawn;
    return { model: 'haiku' };
  });
  const turns: Array<unknown> = [];
  on('turn.complete', ($, e) => (turns.push(e), { text: '' }));
  on('turn.start', ($, e) => ({ turnId: e.turnId }));
  /** The engine's context is the blocks it was given. */
  on('prompt.context', ($, e) => ({ blocks: e.blocks }));
  /** Every row appended, and the main conversation as its next request reads it, appended rows included. */
  const notes: Array<string> = [];
  let conversation = [...(script.conversation ?? [])];
  on(
    'session.messages',
    ($, e) =>
      ({
        value: (e as { agentId?: string }).agentId
          ? []
          : conversation.map((text) => ({ role: 'user', content: [{ type: 'text', text }] })),
      }) as never,
  );
  on('session.append', async ($, e, next) => {
    await script.holdAppend;
    const text = e.message.content.map((block) => String((block as { text?: unknown }).text ?? '')).join('');
    notes.push(text);
    conversation.push(text);
    return next(e);
  });
  /**
   * A prompt enters with the context hooks gave it, which the session stores
   * beside it, so the next request reads both.
   */
  const prompts: Array<{ text: string; context: ReadonlyArray<string> }> = [];
  on('prompt.submit', async ($, e) => {
    const context = e.context ?? [];
    prompts.push({ text: e.text, context });
    await script.holdSubmit;
    conversation.push(e.text, ...context);
    return { text: e.text, context };
  });
  /** A compaction leaves its summary alone, so what was appended before is gone from the next request. */
  on('session.compact', ($, e) => {
    conversation = ['The summary.'];
    return { messages: e.messages } as never;
  });
  /** A compaction as a guard leaves it: the conversation is the summary, and no hook of a person's plugin ran on it. */
  const compactUnseen = () => void (conversation = ['The summary.']);
  /** The store in memory: what one session sets, the next one gets. */
  const stored = new Map<string, unknown>();
  on('store.get', ($, e) => ({ value: stored.get(e.key) }) as never);
  on('store.set', ($, e) => (stored.set(e.key, e.value), { value: undefined }) as never);
  on('ui.open', ($, e) => (opened.push(e), { value: { isPlaced: true } }));
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }));
  on('ui.invalidate', () => ({ value: undefined }));
  on('prompt.fill', ($, e) => (filled.push(e.text), { value: { isFilled: true } }) as never);
  on('process.run', async ($, e): Promise<never> => {
    runs.push(e);
    const command = e.argv[1] ?? '';
    if (command === 'sync') await script.holdSync;
    if (command === 'context') await script.holdContext;
    const isFailingOnce = script.failsOnce === command && runs.filter((run) => run.argv[1] === command).length === 1;
    if (script.failing === command || isFailingOnce)
      return { value: { exitCode: 1, stdout: '', stderr: `${command} failed\n` } } as never;
    const stdout =
      command === 'config'
        ? `journal_dir=${JOURNAL_DIR}\njournal_dir_from=config\nsync=${script.isSyncOn ? 'git' : 'off'}\n`
        : command === 'sync'
          ? (script.sync ?? 'sync is off\n')
          : command === 'list' && typeof script.list === 'function'
            ? script.list(e.argv)
            : (((script as Record<string, unknown>)[command] as string | undefined) ?? '');
    const stderr = script.stderr?.[command] ?? '';
    return { value: { exitCode: script.exitCodes?.[command] ?? 0, stdout, stderr } } as never;
  });

  /** The CLI runs a test asks about: every one but the rules and the config read ahead at the session's start. */
  const queries = () =>
    runs.filter((run) => run.argv[1] !== 'config' && !(run.argv[1] === 'context' && !run.argv.includes('--recall')));

  return {
    runs,
    queries,
    checks,
    opened,
    spawned,
    registered,
    toasts,
    filled,
    turns,
    clock,
    notes,
    stored,
    prompts,
    compactUnseen,
  };
}

export const SESSION = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const;

export const PANE = {
  component: 'Pane',
  surface: 'terminal',
  requestId: PANE_ID,
  viewport: { columns: 160, rows: 40 },
  props: {
    title: 'Journal',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const;

/** `/agent-journal`, with what follows it. */
export const journal = (args = '') =>
  ({
    command: COMMAND,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  }) as const;

/** Every string in a drawn tree, joined, for a look at what the person sees. */
export function textOf(tree: unknown): string {
  const out: Array<string> = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') out.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(tree);
  return out.join(' ');
}

/** The props of the element with a key in a drawn tree, or undefined when it is not drawn. */
export function propsOf(tree: unknown, key: string): Record<string, unknown> | undefined {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = propsOf(child, key);
      if (found) return found;
    }
    return undefined;
  }
  if (!tree || typeof tree !== 'object') return undefined;
  const node = tree as { props?: Record<string, unknown>; children?: unknown };
  if (node.props?.key === key) return node.props;
  return propsOf(node.children, key);
}

/** The node of the element with a key in a drawn tree: its props and what the engine keeps beside them, such as `hover`. */
export function nodeOf(
  tree: unknown,
  key: string,
): { props?: Record<string, unknown>; hover?: Record<string, unknown> } | undefined {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = nodeOf(child, key);
      if (found) return found;
    }
    return undefined;
  }
  if (!tree || typeof tree !== 'object') return undefined;
  const node = tree as { props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown };
  if (node.props?.key === key) return node;
  return nodeOf(node.children, key);
}
