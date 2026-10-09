import { describe, expect, test } from 'claude-code/testing';
import type { On } from 'claude-code';
import type { JournalTurn } from '../types';
import {
  BUTTON_COLOR,
  daysOf,
  linesOf,
  paneView,
  projectWidth,
  visibleLines,
  windowOf,
  type PaneActions,
  type PaneModel,
} from '../hooks/pane-view.js';
import { colorOf } from '../hooks/format.js';
import { nodeOf, PANE, propsOf, textOf } from './world.js';

const NOTHING: PaneActions = {
  chooseScope: () => {},
  chooseDateUnit: () => {},
  stepDate: () => {},
  ask: () => {},
  open: () => {},
  back: () => {},
  showChat: () => {},
  showList: () => {},
  clearChat: () => {},
  sendToPrompt: () => {},
  close: () => {},
};

const MODEL: PaneModel = {
  scope: 'all',
  view: 'list',
  list: {
    status: 'ready',
    entries: [
      { id: '2026-10-05T090000Z', project: 'claude-quick-actions', summary: 'Older' },
      { id: '2026-10-06T143000Z', project: 'nebula', summary: 'Middle' },
      { id: '2026-10-06T150000Z', project: 'repo', summary: 'Newer' },
    ],
    error: '',
    limit: 200,
    hasMore: false,
  },
  chat: [],
  opened: null,
  columns: 80,
  surface: 'terminal',
  currentProject: 'agent-journal',
  now: new Date('2026-10-06T16:00:00Z'),
  timeZone: 'Europe/Berlin',
  bodyRows: 40,
  top: 0,
  date: { unit: 'all', value: '' },
  notice: '',
};

/** The view drawn as a pane of its own, through the engine, so the tree is checked as a session checks it. */
const VIEW = { ...PANE, requestId: 'view' } as const;

/** Draws the view for a model through a test pane, on a surface. */
function drawsWith(on: On) {
  let model = MODEL;
  on('ui.render', { component: 'Pane', requestId: 'view' }, async ($, e) =>
    paneView((await $.ui.resolve(e)) as never, NOTHING, model),
  );
  return (next: PaneModel) => {
    model = next;
  };
}

describe('pane-view', () => {
  test('entries are grouped by local day, newest first, with only the time per entry', () => {
    // Act
    const days = daysOf(MODEL.list.entries, MODEL.now, MODEL.timeZone);

    // Assert
    expect(days.map((day) => day.heading)).toEqual(['Today, Tuesday 2026-10-06', 'Yesterday, Monday 2026-10-05']);
    expect(days[0]!.rows.map((row) => `${row.time} ${row.entry.summary}`)).toEqual(['17:00 Newer', '16:30 Middle']);
  });

  test('a window inside a day shows that day\u2019s heading over its first row, and the list ends with a loading note', () => {
    // Arrange
    const lines = linesOf(daysOf(MODEL.list.entries, MODEL.now, MODEL.timeZone), true);

    // Act
    const window = windowOf(lines.length, 10, 7, 1);
    const shown = visibleLines(lines, window);
    const clamped = windowOf(lines.length, 10, 7, 99);

    // Assert
    expect(lines.map((line) => line.kind)).toEqual(['day', 'entry', 'entry', 'gap', 'day', 'entry', 'more']);
    expect(window).toEqual({ top: 1, rows: 3, maxTop: 4 });
    expect(shown.map((line) => (line.kind === 'entry' ? line.entry.summary : line.kind))).toEqual([
      'day',
      'Middle',
      'gap',
    ]);
    expect(shown[0]).toEqual({ kind: 'day', heading: 'Today, Tuesday 2026-10-06' });
    expect(clamped.top).toBe(4);
  });

  test('the project column fits the longest name up to its limit', () => {
    // Act
    const width = projectWidth(MODEL.list.entries);

    // Assert
    expect(width).toBe(12);
  });

  test('the list shows day rows, then per entry three buttons in one hover group: dim time, project on its color, summary', async ($, on) => {
    // Arrange
    drawsWith(on);

    // Act
    const tree = await $.ui.render(VIEW as never);
    const drawn = JSON.stringify(tree);

    // Assert
    expect(drawn).toContain('AGENT JOURNAL');
    expect(drawn).toContain('"key":"open-ask"');
    expect(drawn).toContain('Today, Tuesday 2026-10-06');
    expect(drawn).toContain('claude-quic…');
    const time = propsOf(tree, 'entry:time:2026-10-06T150000Z');
    const project = propsOf(tree, 'entry:project:2026-10-06T150000Z');
    const summary = propsOf(tree, 'entry:2026-10-06T150000Z');
    expect(time).toEqual(expect.objectContaining({ label: '17:00  ', dimColor: true }));
    expect(project?.label).toBe('repo'.padEnd(12, ' '));
    expect(summary).toEqual(expect.objectContaining({ label: '  Newer', plain: true }));
    expect(summary?.dimColor).toBe(undefined);
    const scopes = ['entry:time:', 'entry:project:', 'entry:'].map(
      (prefix) => nodeOf(tree, `${prefix}2026-10-06T150000Z`)?.hover?.scope,
    );
    expect(scopes).toEqual(Array(3).fill('row:entry:2026-10-06T150000Z'));
    expect(drawn).toContain(`"backgroundColor":"${colorOf('repo')}"`);
  });

  test('the header holds Back outside the list and Close, Ask leads the list, and a rule follows the project row', async ($, on) => {
    // Arrange
    const set = drawsWith(on);

    // Act
    const list = await $.ui.render(VIEW as never);
    set({ ...MODEL, view: 'chat' });
    const chat = await $.ui.render(VIEW as never);

    // Assert
    expect(propsOf(list, 'back')).toBe(undefined);
    expect(propsOf(list, 'open-ask')).toEqual(expect.objectContaining({ label: '✦ Ask', plain: true }));
    expect(propsOf(list, 'box:open-ask')).toEqual(expect.objectContaining({ backgroundColor: BUTTON_COLOR }));
    expect(propsOf(list, 'close')).toEqual(expect.objectContaining({ label: '✕ Close' }));
    expect(propsOf(list, 'box:close')?.backgroundColor).toBe(undefined);
    expect(propsOf(list, 'close')?.dimColor).toBe(undefined);
    expect(JSON.stringify(list)).toContain('─'.repeat(80));
    expect(propsOf(chat, 'back')).toEqual(expect.objectContaining({ label: '← Back' }));
    expect(propsOf(chat, 'open-ask')).toBe(undefined);
  });

  test('the current project\u2019s list names it once on its color and drops the project column', async ($, on) => {
    // Arrange
    const set = drawsWith(on);
    set({ ...MODEL, scope: 'project' });

    // Act
    const tree = await $.ui.render(VIEW as never);
    const drawn = JSON.stringify(tree);

    // Assert
    expect(drawn).toContain(`"backgroundColor":"${colorOf('agent-journal')}"`);
    expect(drawn).toContain('"agent-journal"');
    expect(propsOf(tree, 'entry:project:2026-10-06T150000Z')).toBe(undefined);
    expect(propsOf(tree, 'entry:2026-10-06T150000Z')?.label).toBe('Newer');
  });

  test('the scope is two buttons, the chosen one on color, the other dim, the current one named', async ($, on) => {
    // Arrange
    const set = drawsWith(on);

    // Act
    const all = await $.ui.render(VIEW as never);
    set({ ...MODEL, scope: 'project', currentProject: null });
    const outside = await $.ui.render(VIEW as never);

    // Assert
    expect(propsOf(all, 'box:scope:all')?.backgroundColor).toBe(BUTTON_COLOR);
    expect(propsOf(all, 'scope:all')?.dimColor).toBe(undefined);
    expect(propsOf(all, 'box:scope:project')?.backgroundColor).toBe(undefined);
    expect(propsOf(all, 'scope:project')).toEqual(
      expect.objectContaining({ label: 'Current (agent-journal)', dimColor: true }),
    );
    expect(propsOf(outside, 'scope:project')?.label).toBe('Current');
    expect(propsOf(outside, 'box:scope:project')?.backgroundColor).toBe(BUTTON_COLOR);
  });

  test('an opened entry shows its summary in a box, then its fields and its body as markdown, on every surface with input', async ($, on) => {
    // Arrange
    const set = drawsWith(on);
    set({
      ...MODEL,
      opened: {
        id: '2026-10-06T143000Z',
        status: 'ready',
        text: '---\ndate: 2026-10-06T14:30:00Z\nproject: nebula\nsummary: "Shipped it"\nsession_id: s-1\n---\n\n## Notes\n\n- one\n',
      },
    });

    // Act
    const drawn = await Promise.all(
      (['terminal', 'desktop'] as const).map(async (surface) =>
        JSON.stringify(await $.ui.render({ ...VIEW, surface } as never)),
      ),
    );

    // Assert
    for (const text of drawn) {
      expect(text.indexOf('Shipped it') < text.indexOf('2026-10-06 16:30')).toBe(true);
      expect(text).toContain('"borderStyle":"round"');
      expect(text).not.toContain('Summary');
      expect(text).toContain('2026-10-06 16:30  (2026-10-06T14:30:00Z)');
      expect(text).toContain('Shipped it');
      expect(text).toContain('"type":"Markdown"');
      expect(text).toContain('## Notes');
      expect(text).toContain('"key":"back"');
    }
  });

  test('an answered turn shows its answer without the Sources line, its sources as dim buttons, and a status line', async ($, on) => {
    // Arrange
    const chat: Array<JournalTurn> = [
      {
        status: 'answered',
        question: 'what did we fix?',
        answer: 'You fixed the race.\n\nSources: 2026-10-06T143000Z',
        agentId: 'a',
        startedAt: 0,
        endedAt: 9_000,
        steps: ['listing this project', 'reading 2026-10-06T143000Z'],
        seen: [],
      },
    ];
    const set = drawsWith(on);
    set({ ...MODEL, view: 'chat', chat });

    // Act
    const tree = await $.ui.render(VIEW as never);
    const drawn = JSON.stringify(tree);

    // Assert
    expect(drawn).toContain('› what did we fix?');
    expect(drawn).toContain('You fixed the race.');
    expect(drawn).not.toContain('Sources: 2026');
    expect(drawn).toContain('Sources (1)');
    expect(drawn).toContain('≡ ');
    expect(propsOf(tree, 'source:0:2026-10-06T143000Z')).toEqual(
      expect.objectContaining({ label: '• Middle', plain: true, dimColor: true }),
    );
    expect(drawn).toContain('✻ ');
    expect(drawn).toContain('Answered in 9s · 2 steps');
  });

  test('an open turn shows the agent\u2019s steps and the time so far', async ($, on) => {
    // Arrange
    const chat: Array<JournalTurn> = [
      {
        status: 'asking',
        question: 'and before?',
        answer: '',
        agentId: 'b',
        startedAt: MODEL.now.getTime() - 12_000,
        endedAt: 0,
        steps: ['searching "fix", this project'],
        seen: [],
      },
    ];
    const set = drawsWith(on);
    set({ ...MODEL, view: 'chat', chat });

    // Act
    const drawn = JSON.stringify(await $.ui.render(VIEW as never));

    // Assert
    expect(drawn).toContain('⏺ ');
    expect(drawn).toContain('searching \\"fix\\", this project');
    expect(drawn).toContain('"color":"green"');
    expect(drawn).toContain('Searching… 12s · 1 step');
    expect(drawn).not.toContain('"key":"clear"');
  });

  test('the empty chat offers questions to press, the scope, and an input between two rules', async ($, on) => {
    // Arrange
    const set = drawsWith(on);
    set({ ...MODEL, view: 'chat' });

    // Act
    const tree = await $.ui.render(VIEW as never);
    const drawn = JSON.stringify(tree);

    // Assert
    expect(propsOf(tree, 'suggest:1')).toEqual(
      expect.objectContaining({ label: '› What did we fix last week?', plain: true }),
    );
    expect(propsOf(tree, 'box:scope:all')?.backgroundColor).toBe(BUTTON_COLOR);
    expect(propsOf(tree, 'ask')?.label).toBe(undefined);
    expect(drawn).toContain('❯ ');
    expect(drawn).toContain('─'.repeat(80));
    expect(drawn).not.toContain('"key":"open-ask"');
  });

  test('every view draws within the engine’s rules', async ($, on) => {
    // Arrange
    const set = drawsWith(on);

    // Act
    const list = textOf(await $.ui.render(VIEW as never));
    set({ ...MODEL, view: 'chat' });
    const chat = textOf(await $.ui.render(VIEW as never));

    // Assert
    expect(list).toContain('Newer');
    expect(chat).toContain('Ask about past work');
  });
});
