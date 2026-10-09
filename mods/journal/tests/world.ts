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
  search?: string;
  read?: string;
  context?: string;
  failing?: string;
  /** A spawn waits for this before it answers, so a question can stay open while a test asks again. */
  holdSpawn?: Promise<void>;
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
  on('session.start', ($, e) => ({ cwd: e.cwd }));
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
  on('agent.register', ($, e) => (registered.agents.push(e), { value: { agent: `${PLUGIN}:${e.name}` } }));
  /** Only the engine starts an agent and gives its id, so a spawn answered here never carries one. */
  on('agent.spawn', async ($, e) => {
    spawned.push(e);
    await script.holdSpawn;
    return { model: 'haiku' };
  });
  const turns: Array<unknown> = [];
  on('turn.complete', ($, e) => (turns.push(e), { text: '' }));
  on('ui.open', ($, e) => (opened.push(e), { value: { isPlaced: true } }));
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }));
  on('ui.invalidate', () => ({ value: undefined }));
  on('prompt.fill', ($, e) => (filled.push(e.text), { value: { isFilled: true } }) as never);
  on('process.run', ($, e): never => {
    runs.push(e);
    const command = e.argv[1] ?? '';
    if (script.failing === command)
      return { value: { exitCode: 1, stdout: '', stderr: `${command} failed\n` } } as never;
    const stdout =
      command === 'config'
        ? `journal_dir=${JOURNAL_DIR}\njournal_dir_from=config\n`
        : command === 'list' && typeof script.list === 'function'
          ? script.list(e.argv)
          : (((script as Record<string, unknown>)[command] as string | undefined) ?? '');
    return { value: { exitCode: 0, stdout, stderr: '' } } as never;
  });

  return { runs, opened, spawned, registered, toasts, filled, turns, clock };
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

/** `/journal`, with what follows it. */
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
