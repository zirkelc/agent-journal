/** One entry as the pane lists it. */
export type JournalEntry = { id: string; project: string; summary: string };

/** The pane's list, and how far loading it got. */
export type JournalList = {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  entries: Array<JournalEntry>;
  error: string;
  /** How many of the most recent entries the pane asked for; scrolling near the end asks for more. */
  limit: number;
  /** Whether the journal holds older entries than the ones loaded. */
  hasMore: boolean;
};

/** One question of the search chat, and its answer once the agent gave it. */
export type JournalTurn = {
  status: 'asking' | 'answered' | 'failed';
  question: string;
  answer: string;
  agentId: string;
  /** When the question was asked, in milliseconds since the epoch. */
  startedAt: number;
  /** When the answer came, or 0 while there is none. */
  endedAt: number;
  /** What the agent did so far, one line per tool call. */
  steps: Array<string>;
  /** Every entry the agent's tools returned, so the answer's sources can show their summaries. */
  seen: Array<JournalEntry>;
};

/** The entry the pane shows in full, or none. */
export type JournalOpened = { id: string; status: 'loading' | 'ready' | 'failed'; text: string } | null;

/** How far the list's date filter narrows it: not at all, or to one local year, month or day. */
export type JournalDateUnit = 'all' | 'year' | 'month' | 'day';

/** The list's date filter: its unit, and the period as the CLI's `--date` takes it (`2026`, `2026-10`, `2026-10-07`). */
export type JournalDate = { unit: JournalDateUnit; value: string };

/** Which view the pane shows under an opened entry. */
export type JournalView = 'list' | 'chat';

declare module 'claude-code' {
  interface PluginState {
    'agent-journal': {
      /** The scope the person picked in the pane; null until then, so the setting applies. */
      scope: 'project' | 'all' | null;
      view: JournalView;
      list: JournalList;
      chat: Array<JournalTurn>;
      opened: JournalOpened;
      /** A note under the chat's input, such as a question dropped while another was answered; empty for none. */
      notice: string;
      /** The period the list is narrowed to. */
      date: JournalDate;
      /** The first row of the list the pane shows, as the person scrolled it. */
      top: number;
    };
  }
}
