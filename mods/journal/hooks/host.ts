import type { ProcessRunResult, Timer } from 'claude-code';
import type { JournalDate, JournalList, JournalOpened, JournalTurn, JournalView } from '../types';
import type { Scope } from './agent.js';

/** One value of the mod's session state: read it, or change it from what it is. */
export type Cell<VALUE> = {
  read: () => Promise<VALUE>;
  update: (change: (value: VALUE) => VALUE) => Promise<unknown>;
};

/**
 * The engine's methods the mod uses, bound once when the session starts. The
 * engine reads its calls from the source, so `$` is never stored or passed:
 * each method here is one call written out where `$` is in scope.
 */
export type Host = {
  pluginRoot: string;
  cwd: () => Promise<string>;
  sessionId: () => Promise<string>;
  mainModel: () => Promise<string>;
  /** Where one of the session's agents stands, or undefined when the session no longer lists it. */
  agentStatus: (agentId: string) => Promise<string | undefined>;
  /** One agent's transcript, as role and text; empty when it cannot be read. */
  agentMessages: (agentId: string) => Promise<ReadonlyArray<{ role: string; text: string }>>;
  isFile: (path: string) => Promise<boolean>;
  /** Where a path lands with every link followed, or undefined when it leads nowhere. */
  realPath: (path: string) => Promise<string | undefined>;
  run: (argv: Array<string>, cwd: string, timeoutMs: number) => Promise<ProcessRunResult>;
  spawn: (prompt: string) => Promise<{ agentId?: string; deny?: string }>;
  openPane: () => Promise<boolean>;
  closePane: () => Promise<unknown>;
  fillPrompt: (text: string) => Promise<unknown>;
  toast: (text: string) => void;
  after: (ms: number, fn: () => void) => Timer;
  scope: Cell<Scope | null>;
  list: Cell<JournalList>;
  view: Cell<JournalView>;
  chat: Cell<Array<JournalTurn>>;
  opened: Cell<JournalOpened>;
  top: Cell<number>;
  date: Cell<JournalDate>;
  notice: Cell<string>;
  /** Draws the pane again, for what changes with time alone. */
  redraw: () => void;
};
