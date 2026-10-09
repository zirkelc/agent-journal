import { describe, expect, test } from 'claude-code/testing';
import type { Timer } from 'claude-code';
import type { JournalDate, JournalList, JournalOpened, JournalTurn, JournalView } from '../types';
import { type Scope, type SearchModel, TOOL_SPECS } from '../hooks/agent.js';
import type { Cell, Host } from '../hooks/host.js';
import { TOOL_LIST, TOOL_READ, TOOL_SEARCH, toolName } from '../hooks/names.js';
import { isFailedStep } from '../hooks/pane-view.js';
import {
  agentOf,
  ANSWER_ATTEMPTS,
  answerWaiter,
  ask,
  answered,
  isAskingFor,
  lastAnswerOf,
  PANE_PAGE,
  pageLimitOf,
  recorded,
  stepOf,
  UNLISTED_ATTEMPTS,
  waitOn,
} from '../hooks/journal.js';

const BLANK = { startedAt: 1_000, endedAt: 0, steps: [], seen: [] };
const EARLIER: JournalTurn = {
  ...BLANK,
  status: 'answered',
  question: 'before?',
  answer: 'Earlier.',
  agentId: 'agent-0',
  endedAt: 2_000,
};
const ASKING: JournalTurn = {
  ...BLANK,
  status: 'asking',
  question: 'what did we fix?',
  answer: '',
  agentId: 'agent-1',
};
const CHAT: Array<JournalTurn> = [EARLIER, ASKING];

/** A value held in memory, changed in one step as the session's state is. */
function cell<VALUE>(initial: VALUE): Cell<VALUE> {
  let value = initial;
  return {
    read: async () => value,
    update: async (change) => (value = change(value)),
  };
}

/** Lets the promises that are ready run, a few links deep. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}

/** A session with a CLI that recalls, and a spawn the test decides. */
function hostWith(spawn: Host['spawn']): Host {
  return {
    pluginRoot: '/plugin',
    cwd: async () => '/work',
    sessionId: async () => 'session-1',
    mainModel: async () => 'claude-opus-5-5',
    agentStatus: async () => undefined,
    agentMessages: async () => [],
    isFile: async () => false,
    realPath: async () => undefined,
    run: async () => ({ exitCode: 0, stdout: 'The recall text.\n', stderr: '' }) as never,
    spawn,
    openPane: async () => true,
    closePane: async () => undefined,
    fillPrompt: async () => undefined,
    toast: () => {},
    after: () => ({ cancel: () => {} }) as unknown as Timer,
    scope: cell<Scope>('project'),
    model: cell<SearchModel>('haiku'),
    list: cell<JournalList>({ status: 'idle', entries: [], error: '', limit: 0, hasMore: false }),
    view: cell<JournalView>('list'),
    chat: cell<Array<JournalTurn>>([]),
    opened: cell<JournalOpened>(null),
    top: cell(0),
    date: cell<JournalDate>({ unit: 'all', value: '' }),
    notice: cell(''),
    conversationText: async () => '',
    appendNote: async () => {},
    redraw: () => {},
  };
}

describe('journal', () => {
  test('a question the agent takes keeps its turn open under the agent\u2019s id', async () => {
    // Arrange
    const host = hostWith(async () => ({ agentId: 'agent-1' }));

    // Act
    const outcome = await ask(host, 'what did we fix?');

    // Assert
    expect(outcome).toBe('asked');
    const [turn] = await host.chat.read();
    expect(turn).toEqual(expect.objectContaining({ status: 'asking', agentId: 'agent-1' }));
  });

  test('a spawn that throws fails its question instead of leaving it open', async () => {
    // Arrange
    const host = hostWith(async () => {
      throw new Error('no agents today');
    });

    // Act
    const outcome = await ask(host, 'what did we fix?');
    const next = await ask(host, 'and now?');

    // Assert
    expect(outcome).toBe('failed');
    const [turn] = await host.chat.read();
    expect(turn).toEqual(
      expect.objectContaining({ status: 'failed', answer: 'The search did not start: no agents today' }),
    );
    expect(next).toBe('failed');
  });

  test('a look at the agent that fails is tried again, and the answer still settles the question', async () => {
    // Arrange
    const host = hostWith(async () => ({ agentId: 'agent-1' }));
    let looks = 0;
    host.agentStatus = async () => {
      looks += 1;
      if (looks === 1) throw new Error('agent list unavailable');
      return 'completed';
    };
    host.agentMessages = async () => [{ role: 'assistant', text: 'Fixed the race.' }];
    const timers: Array<() => void> = [];
    host.after = (ms, fn) => (timers.push(fn), { cancel: () => {} }) as unknown as Timer;
    await ask(host, 'what did we fix?');
    const waiter = answerWaiter(host);

    // Act
    await waiter.turnEnded('agent-1', '', false);
    await settled();
    timers.shift()?.();
    await settled();

    // Assert
    expect(looks).toBe(2);
    const [turn] = await host.chat.read();
    expect(turn).toEqual(expect.objectContaining({ status: 'answered', answer: 'Fixed the race.' }));
  });

  test('two questions at once start one search, and the other is refused as busy', async () => {
    // Arrange
    let spawns = 0;
    const host = hostWith(async () => ({ agentId: `agent-${++spawns}` }));

    // Act
    const outcomes = await Promise.all([ask(host, 'one?'), ask(host, 'two?')]);

    // Assert
    expect(outcomes).toEqual(['asked', 'busy']);
    expect(spawns).toBe(1);
    expect((await host.chat.read()).map((turn) => turn.question)).toEqual(['one?']);
  });

  test('since takes a range\u2019s _since value of the clock and until its _until value', () => {
    // Arrange
    const list = TOOL_SPECS.find((spec) => spec.name === TOOL_LIST)!;
    const properties = (list.inputSchema as { properties: Record<string, { description: string }> }).properties;

    // Act
    const since = properties.since!.description;
    const until = properties.until!.description;

    // Assert
    expect(since).toContain('`local_today_since`');
    expect(until).toContain('`local_today_until`');
  });

  test('a list kept from before the pane loaded in pages starts at the first page', () => {
    // Arrange
    const kept = { status: 'ready', entries: [], error: '' } as never;

    // Act
    const limit = pageLimitOf(kept, false);

    // Assert
    expect(limit).toBe(PANE_PAGE);
  });

  test('the agent’s answer settles the turn it was asked in, and only that one', () => {
    // Act
    const result = answered(CHAT, 'agent-1', '  Fixed the race.  ', false, 9_000);

    // Assert
    expect(result).toEqual([EARLIER, { ...ASKING, status: 'answered', answer: 'Fixed the race.', endedAt: 9_000 }]);
  });

  test('another agent’s last turn leaves the chat as it is', () => {
    // Act
    const result = answered(CHAT, 'agent-2', 'Something else.', false);

    // Assert
    expect(result).toBe(CHAT);
  });

  test('an empty or missing answer fails the turn', () => {
    // Act
    const empty = answered(CHAT, 'agent-1', '', false);
    const missing = answered(CHAT, 'agent-1', undefined, false);

    // Assert
    expect(empty[1]!.status).toBe('failed');
    expect(empty[1]!.answer).toBe('The search ended without an answer.');
    expect(missing[1]!.answer).toBe('The search ended without an answer.');
  });

  test('a stopped search fails the turn', () => {
    // Act
    const result = answered(CHAT, 'agent-1', 'half an answer', true);

    // Assert
    expect(result[1]!.answer).toBe('The search was stopped.');
  });

  test('the agent is named by the product and the model, and by the product alone without a model', () => {
    // Act
    const result = [agentOf('claude-opus-5-5[1m]'), agentOf('claude-haiku-4-5-20251001'), agentOf('')];

    // Assert
    expect(result).toEqual(['claude/opus-5-5', 'claude/haiku-4-5-20251001', 'claude']);
  });

  test('a step of the agent goes to the turn it asks for, with the entries it returned, once each', () => {
    // Arrange
    const entry = { id: '2026-10-05T143000Z', project: 'nebula', summary: 'Fixed the race' };

    // Act
    const once = recorded(CHAT, 'agent-1', 'listing this project', [entry]);
    const twice = recorded(once, 'agent-1', 'reading 2026-10-05T143000Z', [entry]);

    // Assert
    expect(twice[1]!.steps).toEqual(['listing this project', 'reading 2026-10-05T143000Z']);
    expect(twice[1]!.seen).toEqual([entry]);
    expect(twice[0]).toBe(EARLIER);
  });

  test('a step that arrives before the spawn stored its id goes to the turn still without one', () => {
    // Arrange
    const unnamed: Array<JournalTurn> = [{ ...ASKING, agentId: '' }];

    // Act
    const result = recorded(unnamed, 'agent-9', 'searching "fix", this project', []);

    // Assert
    expect(result[0]!.steps).toEqual(['searching "fix", this project']);
  });

  test('a tool call reads as a step, in local days, with what it found', () => {
    // Arrange
    const entry = { id: '2026-10-07T095401Z', project: 'agent-journal', summary: 'Released 0.2.1' };
    const zone = 'Europe/Berlin';

    // Act
    const steps = [
      stepOf(
        toolName(TOOL_LIST),
        { since: '2026-09-27T22:00:00Z', until: '2026-10-04T21:59:59Z', project: '.' },
        { isOk: true, entries: [entry, entry] },
        [],
        zone,
      ),
      stepOf(
        toolName(TOOL_LIST),
        { since: 'today', until: 'today', project: '.' },
        { isOk: true, entries: [entry] },
        [],
        zone,
      ),
      stepOf(toolName(TOOL_SEARCH), { text: 'race' }, { isOk: true, entries: [] }, [], zone),
      stepOf(toolName(TOOL_READ), { id: '2026-10-07T095401Z' }, { isOk: true, entries: [] }, [entry], zone),
      stepOf(toolName(TOOL_READ), { id: '2026-10-04T223000Z' }, { isOk: true, entries: [] }, [], zone),
    ];

    // Assert
    expect(steps).toEqual([
      'Listed 2 entries · this project · Sep 28 – Oct 4',
      'Listed 1 entry · this project · today',
      'Searched "race" · 0 matches · all projects',
      'Read: Released 0.2.1',
      'Read the entry of Oct 5, 00:30',
    ]);
  });

  test('a failed call of every tool reads as failed, and a search for the word failed does not', () => {
    // Arrange
    const failed = { isOk: false, entries: [] };
    const zone = 'Europe/Berlin';

    // Act
    const steps = [
      stepOf(toolName(TOOL_LIST), { since: 'today', project: '.' }, failed, [], zone),
      stepOf(toolName(TOOL_SEARCH), { text: 'race' }, failed, [], zone),
      stepOf(toolName(TOOL_READ), { id: '2026-10-07T095401Z' }, failed, [], zone),
      stepOf(toolName(TOOL_SEARCH), { text: 'failed' }, { isOk: true, entries: [] }, [], zone),
    ];

    // Assert
    expect(steps).toEqual([
      'Listing · this project · today · failed',
      'Searching "race" · all projects · failed',
      'Reading 2026-10-07T095401Z · failed',
      'Searched "failed" · 0 matches · all projects',
    ]);
    expect(steps.map(isFailedStep)).toEqual([true, true, true, false]);
  });

  test('a running agent is waited for, and an unlisted one only until it counts as gone', () => {
    // Act
    const result = [
      waitOn('running', false, 3),
      waitOn('completed', true, 3),
      waitOn(undefined, false, 0),
      waitOn(undefined, true, 0),
      waitOn(undefined, false, UNLISTED_ATTEMPTS),
      waitOn('running', true, ANSWER_ATTEMPTS),
    ];

    // Assert
    expect(result).toEqual(['wait', 'done', 'wait', 'done', 'done', 'done']);
  });

  test('an agent\u2019s answer is the last assistant message with text', () => {
    // Arrange
    const messages = [
      { role: 'user', text: 'what did we fix?' },
      { role: 'assistant', text: 'You fixed the race.' },
      { role: 'assistant', text: '' },
      { role: 'user', text: '' },
    ];

    // Act
    const result = lastAnswerOf(messages);

    // Assert
    expect(result).toBe('You fixed the race.');
    expect(lastAnswerOf([])).toBe('');
  });

  test('only a turn still asking waits for its agent', () => {
    // Act
    const result = [isAskingFor(CHAT, 'agent-1'), isAskingFor(CHAT, 'agent-0'), isAskingFor(CHAT, 'agent-9')];

    // Assert
    expect(result).toEqual([true, false, false]);
  });
});
