/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { ElementTable, RenderElement } from 'claude-code';
import type { JournalDate, JournalEntry, JournalList, JournalOpened, JournalTurn, JournalView } from '../types';
import type { Scope } from './agent.js';
import { sanitize } from './cli.js';
import {
  colorOf,
  column,
  dayHeading,
  fit,
  instantOf,
  isLatest,
  splitSources,
  localDayTime,
  periodText,
  type DateUnit,
  markdownOf,
  parseEntry,
} from './format.js';

/** The elements the pane draws with, on the surfaces that have all of them. */
export type Ui = Pick<ElementTable<'terminal' | 'desktop'>, 'Box' | 'Text' | 'Button' | 'Input' | 'Markdown'>;

/** What a press or an edit in the pane does. The view only calls these. */
export type PaneActions = {
  chooseScope: (scope: Scope) => void;
  chooseDateUnit: (unit: DateUnit) => void;
  /** One period back (`-1`) or forward (`1`) in the unit chosen. */
  stepDate: (by: number) => void;
  ask: (question: string) => void;
  open: (id: string) => void;
  back: () => void;
  showChat: () => void;
  showList: () => void;
  clearChat: () => void;
  sendToPrompt: (id: string) => void;
  close: () => void;
};

/** Everything one drawing of the pane reads. */
export type PaneModel = {
  scope: Scope;
  view: JournalView;
  list: JournalList;
  chat: Array<JournalTurn>;
  opened: JournalOpened;
  columns: number;
  /** Which surface draws the pane: the terminal gets colored buttons of its own, the others their native ones. */
  surface: string;
  /** The current project's name, or null outside a repository. */
  currentProject: string | null;
  now: Date;
  timeZone?: string;
  /** The rows the pane's body has room for. */
  bodyRows: number;
  /** The first row of the list in view, as the person scrolled it. */
  top: number;
  date: JournalDate;
  /** A note under the chat's input; empty for none. */
  notice: string;
};

/** The space between the pane's frame and its content, on the left and on the right. */
export const PADDING = 1;

/**
 * The fewest rows the list shows below its controls, however small the pane.
 * The list draws only the rows in view: a tree has a size limit, and a long
 * journal is far past it.
 */
export const MIN_LIST_ROWS = 3;

/** The widest the project column gets; a longer name is cut. */
export const PROJECT_WIDTH = 12;

/** The fields of an entry, in the order the detail view shows them. */
const FIELDS: ReadonlyArray<[string, string]> = [
  ['date', 'Date'],
  ['project', 'Project'],
  ['cwd', 'Directory'],
  ['agent', 'Agent'],
  ['session_id', 'Session'],
];

/** One day of the list: its heading and its entries, newest first. */
export type Day = { day: string; heading: string; rows: Array<{ entry: JournalEntry; time: string }> };

/** Entries grouped by local day, newest day and newest entry first. */
export function daysOf(entries: ReadonlyArray<JournalEntry>, now: Date, timeZone?: string): Array<Day> {
  const days: Array<Day> = [];
  for (const entry of [...entries].reverse()) {
    const instant = instantOf(entry.id);
    if (!instant) continue;
    const { day, time } = localDayTime(instant, timeZone);
    let last = days[days.length - 1];
    if (last?.day !== day) {
      last = { day, heading: dayHeading(day, now, timeZone), rows: [] };
      days.push(last);
    }
    last.rows.push({ entry, time });
  }
  return days;
}

/** How wide the project column is: the longest name shown, up to its limit. */
export const projectWidth = (entries: ReadonlyArray<JournalEntry>): number =>
  Math.min(Math.max(1, ...entries.map((entry) => [...(entry.project || '-')].length)), PROJECT_WIDTH);

/** One row of the list: a day's heading, an entry, the gap after a day, or the note that older entries are loading. */
export type ListLine =
  | { kind: 'day'; heading: string }
  | { kind: 'entry'; entry: JournalEntry; time: string; heading: string }
  | { kind: 'gap' }
  | { kind: 'more' };

/** The list as rows, one each, so a window over it is a slice. */
export function linesOf(days: ReadonlyArray<Day>, hasMore: boolean): Array<ListLine> {
  const lines: Array<ListLine> = [];
  for (const day of days) {
    if (lines.length > 0) lines.push({ kind: 'gap' });
    lines.push({ kind: 'day', heading: day.heading });
    for (const row of day.rows) lines.push({ kind: 'entry', entry: row.entry, time: row.time, heading: day.heading });
  }
  if (hasMore) lines.push({ kind: 'more' });
  return lines;
}

/** The list as rows, and the width of its project column, measured over every entry loaded so it holds while scrolling. */
export type ListLayout = { lines: Array<ListLine>; width: number };

/** The last list laid out, kept while its entries, its day and its time zone stay the same. */
let lastLayout: {
  entries: ReadonlyArray<JournalEntry>;
  hasMore: boolean;
  today: string;
  timeZone?: string;
  layout: ListLayout;
} | null = null;

/** The list's rows for a drawing or a scroll; both ask for the same rows, so the last ones are kept. */
export function listLayoutOf(list: JournalList, now: Date, timeZone?: string): ListLayout {
  const today = localDayTime(now, timeZone).day;
  const kept = lastLayout;
  if (
    kept &&
    kept.entries === list.entries &&
    kept.hasMore === list.hasMore &&
    kept.today === today &&
    kept.timeZone === timeZone
  )
    return kept.layout;
  const layout = {
    lines: linesOf(daysOf(list.entries, now, timeZone), list.hasMore),
    width: projectWidth(list.entries),
  };
  lastLayout = { entries: list.entries, hasMore: list.hasMore, today, timeZone, layout };
  return layout;
}

/**
 * The rows above the list: the header and its margin, Ask and its margin, the
 * scope, the date, the rule, the project's name with its margin when one
 * shows, and the margin above the list. Kept beside the views that draw them.
 */
export function listTopRows(model: Pick<PaneModel, 'scope' | 'currentProject' | 'list'>): number {
  const hasChip = model.scope === 'project' && (model.currentProject ?? model.list.entries[0]?.project);
  return 2 + 2 + 1 + 1 + 1 + (hasChip ? 2 : 0) + 1;
}

/** Where the list's window stands: its first row, clamped, its height, and the furthest its first row goes. */
export type ListWindow = { top: number; rows: number; maxTop: number };

export function windowOf(lineCount: number, bodyRows: number, topRows: number, top: number): ListWindow {
  const rows = Math.max(bodyRows - topRows, MIN_LIST_ROWS);
  const maxTop = Math.max(lineCount - rows, 0);
  return { top: Math.min(Math.max(top, 0), maxTop), rows, maxTop };
}

/**
 * The rows in view. One that starts inside a day shows that day's heading in
 * its first row, over the entry that scrolled under it, so a row always says
 * which day it belongs to.
 */
export function visibleLines(lines: ReadonlyArray<ListLine>, window: ListWindow): Array<ListLine> {
  const shown = lines.slice(window.top, window.top + window.rows);
  const first = shown[0];
  if (first?.kind === 'entry') shown[0] = { kind: 'day', heading: first.heading };
  return shown;
}

/** The background of an action button in the terminal: the blue of a VS Code button, readable in both themes. */
export const BUTTON_COLOR = '#0e639c';

/**
 * How a button looks: `primary` on a colored ground, the action of a view or a
 * chosen option; `neutral` as plain text, for navigation; `dim` for an option
 * not chosen.
 */
export type ButtonLook = 'primary' | 'neutral' | 'dim';

/**
 * A button with its look: in the terminal a label on a colored ground or as
 * plain text; elsewhere the surface's own button, primary or not.
 */
function actionButton(
  ui: Ui,
  model: PaneModel,
  key: string,
  label: string,
  onPress: () => void,
  look: ButtonLook = 'primary',
): RenderElement {
  const { Box, Button } = ui;
  if (model.surface !== 'terminal') {
    return (
      <Button key={key} variant={look === 'primary' ? 'primary' : 'secondary'} onPress={onPress}>
        {label}
      </Button>
    );
  }
  return (
    <Box key={`box:${key}`} paddingX={1} {...(look === 'primary' ? { backgroundColor: BUTTON_COLOR } : {})}>
      <Button key={key} plain {...(look === 'dim' ? { dimColor: true } : {})} onPress={onPress}>
        {label}
      </Button>
    </Box>
  );
}

function headerView(ui: Ui, actions: PaneActions, model: PaneModel): RenderElement {
  const { Box, Text } = ui;
  const isList = model.opened === null && model.view === 'list';
  const back = model.opened !== null ? () => actions.back() : () => actions.showList();
  return (
    <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
      <Text bold color="cyan">
        AGENT JOURNAL
      </Text>
      <Box flexDirection="row" columnGap={2}>
        {!isList && actionButton(ui, model, 'back', '← Back', back, 'neutral')}
        {actionButton(ui, model, 'close', '✕ Close', () => actions.close(), 'neutral')}
      </Box>
    </Box>
  );
}

/** A dim rule across the pane, to set one part of a view off from the next. */
function ruleView(ui: Ui, model: PaneModel, key: string): RenderElement {
  const { Text } = ui;
  return (
    <Text key={key} dimColor>
      {'─'.repeat(model.columns)}
    </Text>
  );
}

/** The scope as two buttons, the active one highlighted: both choices are visible and take a click. */
function scopeView(ui: Ui, actions: PaneActions, model: PaneModel): RenderElement {
  const { Box, Text } = ui;
  const current = model.currentProject ? `Current (${sanitize(model.currentProject)})` : 'Current';
  return (
    <Box flexDirection="row" columnGap={1}>
      <Text dimColor>Project</Text>
      {actionButton(
        ui,
        model,
        'scope:all',
        'All',
        () => actions.chooseScope('all'),
        model.scope === 'all' ? 'primary' : 'dim',
      )}
      {actionButton(
        ui,
        model,
        'scope:project',
        current,
        () => actions.chooseScope('project'),
        model.scope === 'project' ? 'primary' : 'dim',
      )}
    </Box>
  );
}

/** The units the list narrows to, in the order the date row shows them. */
const DATE_UNITS: ReadonlyArray<[DateUnit, string]> = [
  ['all', 'All'],
  ['year', 'Year'],
  ['month', 'Month'],
  ['day', 'Day'],
];

/**
 * The date filter as one row: the units as buttons, the chosen one on color,
 * and, once a unit is chosen, the period with a step back and a step forward.
 * The step forward is dim at the period today is in, since nothing is newer.
 */
function dateView(ui: Ui, actions: PaneActions, model: PaneModel): RenderElement {
  const { Box, Text } = ui;
  const { date } = model;
  const isNewest = isLatest(date, localDayTime(model.now, model.timeZone).day);
  return (
    <Box flexDirection="row" columnGap={1}>
      <Text dimColor>{'Date   '}</Text>
      {DATE_UNITS.map(([unit, label]) =>
        actionButton(
          ui,
          model,
          `date:${unit}`,
          label,
          () => actions.chooseDateUnit(unit),
          date.unit === unit ? 'primary' : 'dim',
        ),
      )}
      {date.unit !== 'all' && (
        <Box key="period" flexDirection="row" marginLeft={2}>
          {actionButton(ui, model, 'date:back', '‹', () => actions.stepDate(-1), 'neutral')}
          <Text bold>{periodText(date)}</Text>
          {actionButton(ui, model, 'date:forward', '›', () => actions.stepDate(1), isNewest ? 'dim' : 'neutral')}
        </Box>
      )}
    </Box>
  );
}

/** The current project's name on its color, above a list that shows only its entries. */
function projectChip(ui: Ui, project: string | null): RenderElement | null {
  const { Box, Text } = ui;
  if (!project) return null;
  return (
    <Box key="chip" flexDirection="row" marginTop={1}>
      <Box paddingX={1} backgroundColor={colorOf(project)}>
        <Text bold>{sanitize(project)}</Text>
      </Box>
    </Box>
  );
}

/** One hover group per row, so all its parts light while the pointer is on any of them. */
export const rowHover = (id: string) => ({ scope: `row:${id}`, inverse: true }) as const;

/**
 * One entry on one line: the dim time, the project on its color, and the
 * summary, three buttons that open the entry and light together. A Button has
 * no text color, so the project's color is its ground here.
 */
function entryRow(
  ui: Ui,
  actions: PaneActions,
  entry: JournalEntry,
  when: string,
  width: number,
  columns: number,
  keyPrefix: string,
): RenderElement {
  const { Box, Button } = ui;
  const project = entry.project || '-';
  const projectColumns = width > 0 ? width + 2 + 2 : 0;
  const summaryWidth = Math.max(columns - [...when].length - 2 - projectColumns, 10);
  const hover = rowHover(`${keyPrefix}:${entry.id}`);
  const open = () => actions.open(entry.id);
  return (
    <Box key={`row:${keyPrefix}:${entry.id}`} flexDirection="row">
      <Button key={`${keyPrefix}:time:${entry.id}`} plain dimColor hover={hover} onPress={open}>
        {`${when}  `}
      </Button>
      {width > 0 && (
        <Box paddingX={1} backgroundColor={colorOf(project)}>
          <Button key={`${keyPrefix}:project:${entry.id}`} plain hover={hover} onPress={open}>
            {column(sanitize(project), width)}
          </Button>
        </Box>
      )}
      <Button key={`${keyPrefix}:${entry.id}`} plain hover={hover} onPress={open}>
        {`${width > 0 ? '  ' : ''}${fit(sanitize(entry.summary), summaryWidth)}`}
      </Button>
    </Box>
  );
}

function listView(ui: Ui, actions: PaneActions, model: PaneModel): RenderElement {
  const { Box, Text } = ui;
  const { list } = model;
  let rows: RenderElement | Array<RenderElement>;
  if (list.status === 'loading' && list.entries.length === 0) rows = <Text dimColor>Loading the journal…</Text>;
  else if (list.status === 'failed') rows = <Text color="red">{sanitize(list.error)}</Text>;
  else if (list.entries.length === 0)
    rows = (
      <Text dimColor>{model.date.unit === 'all' ? 'No entries yet.' : `No entries in ${periodText(model.date)}.`}</Text>
    );
  else {
    const layout = listLayoutOf(list, model.now, model.timeZone);
    const { lines } = layout;
    /** One project's list says its name once, above it, so its rows need no project column. */
    const width = model.scope === 'project' ? 0 : layout.width;
    const window = windowOf(lines.length, model.bodyRows, listTopRows(model), model.top);
    rows = visibleLines(lines, window).map((line, at) => {
      if (line.kind === 'entry') return entryRow(ui, actions, line.entry, line.time, width, model.columns, 'entry');
      if (line.kind === 'day')
        return (
          <Text key={`line:${window.top + at}`} bold>
            {line.heading}
          </Text>
        );
      if (line.kind === 'more')
        return (
          <Text key="more" dimColor>
            Loading older entries…
          </Text>
        );
      return <Text key={`line:${window.top + at}`}> </Text>;
    });
  }
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" marginBottom={1}>
        {actionButton(ui, model, 'open-ask', '✦ Ask', () => actions.showChat())}
      </Box>
      {scopeView(ui, actions, model)}
      {dateView(ui, actions, model)}
      {ruleView(ui, model, 'rule:list')}
      {model.scope === 'project' && projectChip(ui, model.currentProject ?? list.entries[0]?.project ?? null)}
      <Box marginTop={1} flexDirection="column">
        {rows}
      </Box>
    </Box>
  );
}

function entryView(ui: Ui, actions: PaneActions, model: PaneModel, opened: NonNullable<JournalOpened>): RenderElement {
  const { Box, Text, Markdown } = ui;
  const parsed = opened.status === 'ready' ? parseEntry(opened.text) : null;
  const instant = instantOf(opened.id);
  const when = instant ? localDayTime(instant, model.timeZone) : undefined;
  return (
    <Box flexDirection="column">
      {parsed && (
        <Box flexDirection="row" marginBottom={1}>
          {actionButton(ui, model, 'send', '↳ Send to prompt', () => actions.sendToPrompt(opened.id))}
        </Box>
      )}
      {opened.status === 'loading' && <Text dimColor>Loading {opened.id}…</Text>}
      {opened.status === 'failed' && <Text color="red">{sanitize(opened.text)}</Text>}
      {parsed?.fields.summary && (
        <Box
          key="summary"
          borderStyle="round"
          borderColor={parsed.fields.project ? colorOf(parsed.fields.project) : 'cyan'}
          paddingX={1}
          marginBottom={1}
        >
          <Text bold wrap="wrap">
            {sanitize(parsed.fields.summary)}
          </Text>
        </Box>
      )}
      {parsed && (
        <Box flexDirection="column" marginBottom={1}>
          {FIELDS.filter(([key]) => parsed.fields[key]).map(([key, label]) => (
            <Box key={`field:${key}`} flexDirection="row">
              <Text dimColor>{label.padEnd(11, ' ')}</Text>
              <Text color={key === 'project' ? colorOf(parsed.fields[key]!) : undefined} wrap="wrap">
                {sanitize(
                  key === 'date' && when ? `${when.day} ${when.time}  (${parsed.fields[key]})` : parsed.fields[key]!,
                )}
              </Text>
            </Box>
          ))}
        </Box>
      )}
      {parsed && parsed.body !== '' && <Markdown key="body" text={markdownOf(parsed.body)} />}
    </Box>
  );
}

/** Questions the empty chat offers, each asked with one press. */
export const SUGGESTIONS: ReadonlyArray<string> = [
  'What did we do today?',
  'What did we fix last week?',
  'What is still open here?',
  'What did I do yesterday?',
];

/** Seconds as the chat shows a duration: `9s`, `1m 05s`. */
export function durationOf(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/** The entries an answer names, in the order it names them, with what the agent saw of each. */
export function sourcesOf(turn: JournalTurn, known: ReadonlyArray<JournalEntry>): Array<JournalEntry> {
  const byId = new Map([...known, ...turn.seen].map((entry) => [entry.id, entry]));
  return splitSources(turn.answer).ids.map((id) => byId.get(id) ?? { id, project: '', summary: id });
}

/** Whether a step line tells of a tool call that failed. */
export const isFailedStep = (step: string): boolean => /\bfailed$/.test(step);

/** The status under a turn, as the main session shows one under a reply. */
export function statusOf(turn: JournalTurn, now: number): string {
  const steps = `${turn.steps.length} ${turn.steps.length === 1 ? 'step' : 'steps'}`;
  const took = durationOf((turn.endedAt || now) - turn.startedAt);
  return turn.status === 'asking' ? `Searching… ${took} · ${steps}` : `Answered in ${took} · ${steps}`;
}

function turnView(ui: Ui, actions: PaneActions, model: PaneModel, turn: JournalTurn, index: number): RenderElement {
  const { Box, Text, Button, Markdown } = ui;
  const sources = turn.status === 'answered' ? sourcesOf(turn, model.list.entries) : [];
  const answer = splitSources(turn.answer).text;
  return (
    <Box key={`turn:${index}`} flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">{`› ${sanitize(turn.question)}`}</Text>
      {turn.status === 'asking' && turn.steps.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {turn.steps.map((step, at) => (
            <Box key={`step:${index}:${at}`} flexDirection="row">
              <Text color={isFailedStep(step) ? 'red' : 'green'}>⏺ </Text>
              <Text dimColor>{fit(sanitize(step), model.columns - 2)}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Box flexDirection="column" paddingLeft={2} marginTop={1}>
        {turn.status === 'failed' && <Text color="red">{sanitize(turn.answer)}</Text>}
        {turn.status === 'answered' && <Markdown key={`answer:${index}`} text={markdownOf(answer)} />}
      </Box>
      {sources.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Box flexDirection="row">
            <Text color="cyan">≡ </Text>
            <Text dimColor bold>{`Sources (${sources.length})`}</Text>
          </Box>
          <Box flexDirection="column" paddingLeft={2}>
            {sources.map((entry) => (
              <Button key={`source:${index}:${entry.id}`} plain dimColor onPress={() => actions.open(entry.id)}>
                {fit(`• ${sanitize(entry.summary || entry.id).replace(/\s+/g, ' ')}`, model.columns - 2)}
              </Button>
            ))}
          </Box>
        </Box>
      )}
      {turn.status !== 'failed' && (
        <Box marginTop={1}>
          <Text color="cyan">✻ </Text>
          <Text dimColor>{statusOf(turn, model.now.getTime())}</Text>
        </Box>
      )}
    </Box>
  );
}

function chatView(ui: Ui, actions: PaneActions, model: PaneModel): RenderElement {
  const { Box, Text, Button, Input } = ui;
  const isAsking = model.chat.some((turn) => turn.status === 'asking');
  return (
    <Box flexDirection="column">
      {model.chat.length > 0 && !isAsking && (
        <Box flexDirection="row" marginBottom={1}>
          {actionButton(ui, model, 'clear', '+ New chat', () => actions.clearChat())}
        </Box>
      )}
      {scopeView(ui, actions, model)}
      {ruleView(ui, model, 'rule:chat')}
      <Box marginTop={1} />
      {model.chat.length === 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>Ask about past work. A follow-up question keeps the context.</Text>
          <Box flexDirection="column" marginTop={1}>
            {SUGGESTIONS.map((question, at) => (
              <Button key={`suggest:${at}`} plain onPress={() => actions.ask(question)}>
                {`› ${question}`}
              </Button>
            ))}
          </Box>
        </Box>
      )}
      {model.chat.map((turn, index) => turnView(ui, actions, model, turn, index))}
      <Text dimColor>{'─'.repeat(model.columns)}</Text>
      <Box flexDirection="row">
        <Text bold>❯ </Text>
        <Input
          key="ask"
          placeholder={
            isAsking
              ? 'wait for the answer…'
              : model.chat.length === 0
                ? 'what did we fix last week?'
                : 'ask a follow-up question'
          }
          submitLabel="ask"
          autoFocus
          onSubmit={(value) => actions.ask(value)}
        />
      </Box>
      <Text dimColor>{'─'.repeat(model.columns)}</Text>
      {model.notice !== '' && (
        <Text key="notice" color="yellow" wrap="wrap">
          {model.notice}
        </Text>
      )}
    </Box>
  );
}

/** The whole pane: the header, then an opened entry, the chat or the list. */
export function paneView(ui: Ui, actions: PaneActions, model: PaneModel): RenderElement {
  const { Box } = ui;
  const body = model.opened
    ? entryView(ui, actions, model, model.opened)
    : model.view === 'chat'
      ? chatView(ui, actions, model)
      : listView(ui, actions, model);
  return (
    <Box flexDirection="column" paddingX={PADDING}>
      {headerView(ui, actions, model)}
      {body}
    </Box>
  );
}
