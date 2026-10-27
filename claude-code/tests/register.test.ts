import { describe, expect, test } from 'claude-code/testing';
import { localDayTime } from '../hooks/format.js';
import {
  COMMAND,
  PANE_ID,
  PLUGIN,
  RULES_MARK,
  TOOL_LIST,
  TOOL_READ,
  TOOL_PREFIX,
  TOOL_WRITE,
  toolName,
} from '../hooks/names.js';
import { journal, JOURNAL_DIR, line, PANE, SESSION, textOf, world } from './world.js';

/** A turn of the wheel over the journal pane, before the hook decides where it goes. */
const SCROLL = {
  component: 'Pane',
  requestId: PANE_ID,
  offset: 0,
  by: 1,
  bodyRows: 30,
  contentRows: 30,
  origin: { kind: 'person' },
} as const;

/** A prompt the person typed and sent, as the engine raises it. */
const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const;

describe('register', () => {
  test('registers the three journal tools and the command at session start', async ($, on) => {
    // Arrange
    const kept = world(on);

    // Act
    await $.session.start(SESSION);

    // Assert
    expect(kept.registered.tools).toEqual(['list', 'read', 'write']);
    expect(kept.registered.commands).toEqual([COMMAND]);
  });

  test('the tools that read the journal are deferred, and the write tool is in the main model\u2019s prompt', async ($, on) => {
    // Arrange
    world(on);
    on('tool.describe', ($, e) => ({ name: e.tool, description: '', isDeferred: false }) as never);
    await $.session.start(SESSION);

    // Act
    const tools = await Promise.all(
      [TOOL_LIST, TOOL_READ, TOOL_WRITE].map((name) =>
        $.tool.describe({ tool: toolName(name), description: 'Uses the journal.' } as never),
      ),
    );

    // Assert
    expect(tools.map((tool) => (tool as { isDeferred: boolean }).isDeferred)).toEqual([true, true, false]);
  });

  test('the rules for writing the journal go to the main conversation as a marked row of their own, once', async ($, on) => {
    // Arrange
    const kept = world(on, { context: 'Standing rules.\n\n## Journal\n' });
    await $.session.start(SESSION);
    const engine = { name: 'claudeMd', text: 'Project rules.' };

    // Act
    const [result] = await Promise.all([
      $.prompt.context({ blocks: [engine] } as never),
      $.prompt.context({ blocks: [engine] } as never),
    ]);
    await $.prompt.context({ blocks: [engine] } as never);

    // Assert
    expect(result.blocks).toEqual([engine]);
    expect(kept.notes).toEqual([`${RULES_MARK}\nStanding rules.\n\n## Journal`]);
    const made = kept.runs.filter((run) => run.argv[1] === 'context');
    expect(made.length).toBe(1);
    expect(made[0]!.argv.slice(1)).toEqual([
      'context',
      '--cwd',
      '/work',
      '--session-id',
      'session-1',
      '--agent',
      'claude/claude-opus-5-5[1m]',
      '--tools',
      TOOL_PREFIX,
    ]);
  });

  test('a session where a deny rule removes a journal tool gets the rules for files', async ($, on) => {
    // Arrange
    const kept = world(on, { context: 'Standing rules.\n', removed: [toolName(TOOL_WRITE)] });
    await $.session.start(SESSION);

    // Act
    await $.prompt.context({ blocks: [] } as never);

    // Assert
    const made = kept.runs.filter((run) => run.argv[1] === 'context');
    expect(made.map((run) => run.argv.slice(1))).toEqual([
      ['context', '--cwd', '/work', '--session-id', 'session-1', '--agent', 'claude/claude-opus-5-5[1m]'],
    ]);
  });

  test('a conversation that holds the rules\u2019 mark, as a resumed one does, gets no second copy, and their text alone is no mark', async ($, on) => {
    // Arrange
    const resumed = world(on, { context: 'Standing rules.\n', conversation: ['hi', `${RULES_MARK}\nStanding rules.`] });
    await $.session.start(SESSION);

    // Act
    await $.prompt.context({ blocks: [] } as never);

    // Assert
    expect(resumed.notes).toEqual([]);
  });

  test('rules quoted in the conversation without the mark do not count as given', async ($, on) => {
    // Arrange
    const kept = world(on, { context: 'Standing rules.\n', conversation: ['Look at this: Standing rules.'] });
    await $.session.start(SESSION);

    // Act
    await $.prompt.context({ blocks: [] } as never);

    // Assert
    expect(kept.notes.length).toBe(1);
  });

  test('a CLI that cannot give the rules adds nothing', async ($, on) => {
    // Arrange
    const kept = world(on, { failing: 'context' });
    await $.session.start(SESSION);

    // Act
    await $.prompt.context({ blocks: [] } as never);

    // Assert
    expect(kept.notes).toEqual([]);
  });

  test('a compaction brings the rules back once, even with the context read again at the same time', async ($, on) => {
    // Arrange
    const kept = world(on, { context: 'Standing rules.\n' });
    await $.session.start(SESSION);
    await $.prompt.context({ blocks: [] } as never);
    const compaction = { trigger: 'auto', messages: [{ role: 'user', text: 'The summary.', toolUses: [] }] };

    // Act
    await $.session.compact(compaction as never);
    await Promise.all([kept.clock.settle(), $.prompt.context({ blocks: [] } as never)]);

    // Assert
    expect(kept.notes.length).toBe(2);
  });

  test('a subagent\u2019s compaction and a precompute give the main conversation nothing', async ($, on) => {
    // Arrange
    const kept = world(on, { context: 'Standing rules.\n', conversation: [`${RULES_MARK}\nStanding rules.`] });
    await $.session.start(SESSION);
    const compaction = { trigger: 'auto', messages: [{ role: 'user', text: 'The summary.', toolUses: [] }] };

    // Act
    await $.session.compact({ ...compaction, agentId: 'agent-1' } as never);
    await $.session.compact({ ...compaction, trigger: 'precompute' } as never);
    await kept.clock.settle();

    // Assert
    expect(kept.notes).toEqual([]);
  });

  test('where prompt.context does not run, the first prompt carries the rules as context, and the next one none', async ($, on) => {
    // Arrange
    const kept = world(on, { context: 'Standing rules.\n' });
    await $.session.start(SESSION);

    // Act
    await $.prompt.submit(typed('first'));
    await $.prompt.submit(typed('second'));

    // Assert
    expect(kept.prompts).toEqual([
      { text: 'first', context: [`${RULES_MARK}\nStanding rules.`] },
      { text: 'second', context: [] },
    ]);
    expect(kept.notes).toEqual([]);
  });

  test('a prompt after the rules came through prompt.context adds no second copy', async ($, on) => {
    // Arrange
    const kept = world(on, { context: 'Standing rules.\n' });
    await $.session.start(SESSION);
    await $.prompt.context({ blocks: [] } as never);

    // Act
    await $.prompt.submit(typed('first'));

    // Assert
    expect(kept.notes).toEqual([`${RULES_MARK}\nStanding rules.`]);
    expect(kept.prompts).toEqual([{ text: 'first', context: [] }]);
  });

  test('a prompt submitted while prompt.context still appends the rules waits for it and adds no second copy', async ($, on) => {
    // Arrange
    let release = () => {};
    const kept = world(on, {
      context: 'Standing rules.\n',
      holdAppend: new Promise<void>((resolve) => (release = resolve)),
    });
    await $.session.start(SESSION);

    // Act
    const delivered = $.prompt.context({ blocks: [] } as never);
    await kept.clock.settle();
    const submitted = $.prompt.submit(typed('first'));
    await kept.clock.settle();
    release();
    await Promise.all([delivered, submitted]);

    // Assert
    expect(kept.notes.length).toBe(1);
    expect(kept.prompts).toEqual([{ text: 'first', context: [] }]);
  });

  test('after a compaction the mod does not see, the next prompt carries the rules again', async ($, on) => {
    // Arrange
    const kept = world(on, { context: 'Standing rules.\n' });
    await $.session.start(SESSION);
    await $.prompt.submit(typed('first'));
    await $.turn.start({ text: 'first', turnId: 'turn-1' });
    /** The conversation as the engine leaves it after a compaction no hook of this mod ran on. */
    kept.compactUnseen();

    // Act
    await $.prompt.submit(typed('after'));

    // Assert
    expect(kept.prompts.map((prompt) => prompt.context)).toEqual([
      [`${RULES_MARK}\nStanding rules.`],
      [`${RULES_MARK}\nStanding rules.`],
    ]);
  });

  test('prompt.context while a prompt with the rules waits to enter adds no second copy', async ($, on) => {
    // Arrange
    let release = () => {};
    const kept = world(on, {
      context: 'Standing rules.\n',
      holdSubmit: new Promise<void>((resolve) => (release = resolve)),
    });
    await $.session.start(SESSION);

    // Act
    const submitted = $.prompt.submit(typed('first'));
    await kept.clock.settle();
    await $.prompt.context({ blocks: [] } as never);
    release();
    await submitted;

    // Assert
    expect(kept.prompts).toEqual([{ text: 'first', context: [`${RULES_MARK}\nStanding rules.`] }]);
    expect(kept.notes).toEqual([]);
  });

  test('prompt.context and a prompt at the same time give the rules once', async ($, on) => {
    // Arrange
    const kept = world(on, { context: 'Standing rules.\n' });
    await $.session.start(SESSION);

    // Act
    await Promise.all([$.prompt.submit(typed('first')), $.prompt.context({ blocks: [] } as never)]);

    // Assert
    const copies = kept.notes.length + kept.prompts.flatMap((prompt) => prompt.context).length;
    expect(copies).toBe(1);
  });

  test('two prompts submitted at the same time carry the rules once', async ($, on) => {
    // Arrange
    const kept = world(on, { context: 'Standing rules.\n' });
    await $.session.start(SESSION);

    // Act
    await Promise.all([$.prompt.submit(typed('a')), $.prompt.submit(typed('b'))]);

    // Assert
    expect(kept.prompts).toEqual([
      { text: 'a', context: [`${RULES_MARK}\nStanding rules.`] },
      { text: 'b', context: [] },
    ]);
  });

  test('a prompt into a conversation that holds the rules does not wait for the CLI', async ($, on) => {
    // Arrange
    const kept = world(on, {
      context: 'Standing rules.\n',
      conversation: [`${RULES_MARK}\nStanding rules.`],
      holdContext: new Promise<void>(() => {}),
    });
    await $.session.start(SESSION);
    let isEntered = false;

    // Act
    void $.prompt.submit(typed('first')).then(() => (isEntered = true));
    await kept.clock.settle();

    // Assert
    expect(isEntered).toBe(true);
    expect(kept.prompts).toEqual([{ text: 'first', context: [] }]);
  });

  test('a CLI run that failed at the start is tried again for the first prompt', async ($, on) => {
    // Arrange
    const kept = world(on, { context: 'Standing rules.\n', failsOnce: 'context' });
    await $.session.start(SESSION);
    await kept.clock.settle();

    // Act
    await $.prompt.submit(typed('first'));

    // Assert
    expect(kept.prompts).toEqual([{ text: 'first', context: [`${RULES_MARK}\nStanding rules.`] }]);
  });

  test('a compaction after a prompt carried the rules gives them again', async ($, on) => {
    // Arrange
    const kept = world(on, { context: 'Standing rules.\n' });
    await $.session.start(SESSION);
    await $.prompt.submit(typed('first'));
    const compaction = { trigger: 'auto', messages: [{ role: 'user', text: 'The summary.', toolUses: [] }] };

    // Act
    await $.session.compact(compaction as never);
    await kept.clock.settle();

    // Assert
    expect(kept.notes).toEqual([`${RULES_MARK}\nStanding rules.`]);
  });

  test('a list call runs the CLI in the session directory with the filters', async ($, on) => {
    // Arrange
    const kept = world(on, { list: line('2026-10-05T143000Z', 'repo', 'Did a thing') });
    await $.session.start(SESSION);

    // Act
    const result = await $.tool.call({ tool: toolName(TOOL_LIST), since: '2026-09-28', project: '.' } as never);

    // Assert
    expect(kept.queries().length).toBe(1);
    expect(kept.queries()[0]!.argv.slice(1)).toEqual([
      'list',
      '--since',
      '2026-09-28',
      '--project',
      '.',
      '--limit',
      '50',
    ]);
    expect(kept.queries()[0]!.init?.cwd).toBe('/work');
    expect(JSON.stringify(result)).toContain('Did a thing');
  });

  test('a list call searches with its terms and counts by a field', async ($, on) => {
    // Arrange
    const kept = world(on, { list: '3\t2026-10-05\n3\ttotal\n' });
    await $.session.start(SESSION);

    // Act
    const result = await $.tool.call({
      tool: toolName(TOOL_LIST),
      terms: ['race', ' '],
      fixed: true,
      project: '.',
      by: 'date',
    } as never);

    // Assert
    expect(kept.queries()[0]!.argv.slice(1)).toEqual(['list', 'race', '--fixed', '--project', '.', '--by', 'date']);
    expect(JSON.stringify(result)).toContain('3\\ttotal');
  });

  test('a list call that counts and pages at once is refused before the CLI runs', async ($, on) => {
    // Arrange
    const kept = world(on);
    await $.session.start(SESSION);

    // Act
    const result = await $.tool.call({ tool: toolName(TOOL_LIST), by: 'project', limit: 10 } as never);

    // Assert
    expect(kept.queries().length).toBe(0);
    expect(JSON.stringify(result)).toContain('leave out limit and offset');
  });

  test('a search term that would read as a flag is refused before the CLI runs', async ($, on) => {
    // Arrange
    const kept = world(on);
    await $.session.start(SESSION);

    // Act
    const result = await $.tool.call({ tool: toolName(TOOL_LIST), terms: ['--all'] } as never);

    // Assert
    expect(kept.queries().length).toBe(0);
    expect(JSON.stringify(result)).toContain('must not start with');
  });

  test('a list that the limit cut names the offset of the older matches as the tool takes it', async ($, on) => {
    // Arrange
    world(on, {
      list: line('2026-10-05T143000Z', 'repo', 'Did a thing'),
      stderr: { list: 'matches 1 to 50, counted from the newest; --offset 50 for older ones\n' },
    });
    await $.session.start(SESSION);

    // Act
    const result = await $.tool.call({ tool: toolName(TOOL_LIST), project: '.' } as never);

    // Assert
    expect(JSON.stringify(result)).toContain('call again with offset 50 for older ones');
  });

  test('a read call passes its ids, or a period with its project and page, to the CLI', async ($, on) => {
    // Arrange
    const kept = world(on, { read: '---\nsummary: "A thing."\n---\n\nBody.\n' });
    await $.session.start(SESSION);

    // Act
    await $.tool.call({ tool: toolName(TOOL_READ), which: ['2026-10-05T143000Z', '2026-10-06'] } as never);
    const result = await $.tool.call({
      tool: toolName(TOOL_READ),
      which: ['2026-10'],
      project: '.',
      limit: 5,
      offset: 5,
    } as never);

    // Assert
    expect(kept.queries().map((run) => run.argv.slice(1))).toEqual([
      ['read', '2026-10-05T143000Z', '2026-10-06'],
      ['read', '2026-10', '--project', '.', '--limit', '5', '--offset', '5'],
    ]);
    expect(JSON.stringify(result)).toContain('Body.');
  });

  test('a read call takes its ids as the JSON text of a list too, and names which when it has none', async ($, on) => {
    // Arrange
    const kept = world(on, { read: 'An entry.\n' });
    await $.session.start(SESSION);

    // Act
    const missing = await $.tool.call({ tool: toolName(TOOL_READ), ids: ['2026-10-05T143000Z'] } as never);
    await $.tool.call({ tool: toolName(TOOL_READ), which: '["2026-10-05T143000Z", "2026-10-06T080000Z"]' } as never);

    // Assert
    expect(JSON.stringify(missing)).toContain('which is missing');
    expect(kept.queries().map((run) => run.argv.slice(1))).toEqual([
      ['read', '2026-10-05T143000Z', '2026-10-06T080000Z'],
    ]);
  });

  test('a read that matches nothing is an answer, not a failure', async ($, on) => {
    // Arrange
    world(on, { exitCodes: { read: 1 }, stderr: { read: 'no entry matches 2026-01-01\n' } });
    await $.session.start(SESSION);

    // Act
    const result = await $.tool.call({ tool: toolName(TOOL_READ), which: ['2026-01-01'] } as never);

    // Assert
    expect(result).toEqual({ result: 'No entries match. no entry matches 2026-01-01' });
  });

  test('a read value that would read as a flag is refused before the CLI runs', async ($, on) => {
    // Arrange
    const kept = world(on);
    await $.session.start(SESSION);

    // Act
    const result = await $.tool.call({ tool: toolName(TOOL_READ), which: ['--all'] } as never);

    // Assert
    expect(kept.queries().length).toBe(0);
    expect(JSON.stringify(result)).toContain('must not start with');
  });

  test('a write call runs the CLI for the session with the summary and the body, and answers with the id', async ($, on) => {
    // Arrange
    const kept = world(on, { write: `${JOURNAL_DIR}/2026-10-06T080000Z.md\n` });
    await $.session.start(SESSION);

    // Act
    const result = await $.tool.call({
      tool: toolName(TOOL_WRITE),
      summary: 'Shipped the write tool.',
      body: 'What was decided.',
    } as never);

    // Assert
    const writes = kept.queries().filter((run) => run.argv[1] === 'write');
    expect(writes.length).toBe(1);
    expect(writes[0]!.argv.slice(1)).toEqual([
      'write',
      '--summary=Shipped the write tool.',
      '--body=What was decided.',
      '--cwd',
      '/work',
      '--session-id',
      'session-1',
      '--agent',
      'claude/claude-opus-5-5[1m]',
      '--no-sync',
    ]);
    expect(writes[0]!.init?.cwd).toBe('/work');
    expect((result as { result?: unknown }).result).toBe('2026-10-06T080000Z');
  });

  test('a write call with an empty summary is refused before the CLI runs', async ($, on) => {
    // Arrange
    const kept = world(on);
    await $.session.start(SESSION);

    // Act
    const result = await $.tool.call({ tool: toolName(TOOL_WRITE), summary: '  ', body: 'A body.' } as never);

    // Assert
    expect(kept.queries().length).toBe(0);
    expect((result as { deny?: string }).deny).toBe('summary is empty');
  });

  test('a write the CLI refuses answers with its reason', async ($, on) => {
    // Arrange
    world(on, { failing: 'write' });
    await $.session.start(SESSION);

    // Act
    const result = await $.tool.call({ tool: toolName(TOOL_WRITE), summary: 'A summary.', body: '' } as never);

    // Assert
    expect((result as { deny?: string }).deny).toBe('write failed');
  });

  test('a write call from a subagent is refused before the CLI runs', async ($, on) => {
    // Arrange
    const kept = world(on, { write: `${JOURNAL_DIR}/2026-10-06T080000Z.md\n` });
    await $.session.start(SESSION);

    // Act
    const result = await $.tool.call({
      tool: toolName(TOOL_WRITE),
      summary: 'From a subagent.',
      body: '',
      agentId: 'agent-1',
    } as never);

    // Assert
    expect(kept.queries().length).toBe(0);
    expect((result as { deny?: string }).deny).toBe('Only the main conversation writes journal entries.');
  });

  test('a write through the tool syncs once and adds the entry to the list once', async ($, on) => {
    // Arrange
    let lines = [line('2026-10-05T143000Z', 'repo', 'Newer')];
    const kept = world(on, {
      isSyncOn: true,
      list: () => lines.join('\n'),
      write: `${JOURNAL_DIR}/2026-10-06T080000Z.md\n`,
      sync: 'committed 2026-10-06T080000Z · pushed to origin/main\n',
    });
    on('tool.call', { tool: 'Write' }, () => ({ result: 'written' }) as never);
    await $.session.start(SESSION);
    await $.command.run(journal());
    await kept.clock.settle();
    lines = [...lines, line('2026-10-06T080000Z', 'repo', 'Newest')];
    /** The session's start ran a sync and the pane a list before the write. */
    const before = kept.queries().length;

    // Act
    await $.tool.call({ tool: toolName(TOOL_WRITE), summary: 'Newest', body: '' } as never);
    await kept.clock.advance(1_000);
    await kept.clock.settle();
    const drawn = textOf(await $.ui.render(PANE as never));

    // Assert
    /** The refresh and the sync start together, so only how many of each ran is fixed, not their order. */
    const runs = kept
      .queries()
      .slice(before)
      .map((run) => run.argv[1]);
    expect(runs[0]).toBe('write');
    expect(runs.slice(1).sort()).toEqual(['list', 'sync']);
    expect(drawn).toContain('Newest');
    expect(drawn).toContain('⇅ pushed to origin/main');
  });

  test('the project choice is stored, and a later session opens on it', async ($, on) => {
    // Arrange
    const kept = world(on, { list: line('2026-10-05T143000Z', 'repo', 'Newer') });
    await $.session.start(SESSION);
    await $.command.run(journal());
    await kept.clock.settle();
    await $.ui.render(PANE as never);

    // Act
    await $.ui.press({ plugin: PLUGIN, key: 'scope:all' });
    await kept.clock.settle();

    // Assert
    expect(kept.stored.get('scope')).toBe('all');
    const lists = kept.queries().filter((run) => run.argv[1] === 'list');
    expect(lists.at(-1)!.argv.slice(1)).toEqual(['list', '--limit', '201']);
  });

  test('a session with a stored project choice lists by it, and an unknown one counts as the current project', async ($, on) => {
    // Arrange
    const kept = world(on, { list: line('2026-10-05T143000Z', 'repo', 'Newer') });
    kept.stored.set('scope', 'all');
    await $.session.start(SESSION);

    // Act
    await $.command.run(journal());
    await kept.clock.settle();
    kept.stored.set('scope', 'everything');
    await $.ui.render(PANE as never);
    await $.ui.press({ plugin: PLUGIN, key: 'date:all' });
    await kept.clock.settle();

    // Assert
    const lists = kept.queries().filter((run) => run.argv[1] === 'list');
    expect(lists[0]!.argv.slice(1)).toEqual(['list', '--limit', '201']);
    expect(lists.at(-1)!.argv.slice(1)).toEqual(['list', '--project', '.', '--limit', '201']);
  });

  test('the list names the journal\u2019s folder once the CLI has said where it is', async ($, on) => {
    // Arrange
    const kept = world(on, { list: line('2026-10-05T143000Z', 'repo', 'Newer') });
    await $.session.start(SESSION);

    // Act
    await $.command.run(journal());
    await kept.clock.settle();
    const drawn = textOf(await $.ui.render(PANE as never));

    // Assert
    expect(drawn).toContain(JOURNAL_DIR);
  });

  test('/agent-journal alone lists the current project newest first', async ($, on) => {
    // Arrange
    const kept = world(on, {
      list: [line('2026-10-04T090000Z', 'repo', 'Older'), line('2026-10-05T143000Z', 'repo', 'Newer')].join('\n'),
    });
    await $.session.start(SESSION);

    // Act
    const result = await $.command.run(journal());
    await kept.clock.settle();
    const drawn = textOf(await $.ui.render(PANE as never));

    // Assert
    expect(result).toEqual({});
    const listed = kept.queries().find((run) => run.argv[1] === 'list')!;
    expect(listed.argv.slice(1)).toEqual(['list', '--project', '.', '--limit', '201']);
    expect(drawn.indexOf('Newer') < drawn.indexOf('Older')).toBe(true);
  });

  test('a pane drawn with a list that never loaded, as after /clear, says it is loading and loads it', async ($, on) => {
    // Arrange
    const kept = world(on, { list: line('2026-10-05T143000Z', 'repo', 'Kept across the clear') });
    await $.session.start(SESSION);

    // Act
    const first = textOf(await $.ui.render(PANE as never));
    await kept.clock.settle();
    const second = textOf(await $.ui.render(PANE as never));

    // Assert
    expect(first.includes('No entries yet.')).toBe(false);
    expect(first.includes('Loading the journal')).toBe(true);
    expect(kept.queries().filter((run) => run.argv[1] === 'list').length).toBe(1);
    expect(second.includes('Kept across the clear')).toBe(true);
  });

  test('the list scrolls its own rows, keeps the engine\u2019s window, and loads the next page near its end', async ($, on) => {
    // Arrange
    const entries = Array.from({ length: 230 }, (_, at) => {
      const day = String(1 + Math.floor(at / 10)).padStart(2, '0');
      return line(`2026-09-${day}T${10 + (at % 10)}0000Z`, 'repo', `Entry ${at}`);
    });
    const kept = world(on, { list: entries.join('\n') });
    await $.session.start(SESSION);
    await $.command.run(journal());
    await kept.clock.settle();
    const first = textOf(await $.ui.render(PANE as never));

    // Act
    const scrolled = await $.ui.scroll({ ...SCROLL, by: 5 } as never);
    const later = textOf(await $.ui.render(PANE as never));
    await $.ui.scroll({ ...SCROLL, by: 1_000 } as never);
    await kept.clock.settle();

    // Assert
    expect(first).toContain('Entry 229');
    expect(first).not.toContain('Entry 100');
    expect(scrolled).toEqual({});
    expect(later).not.toContain('Entry 229');
    expect(later).toContain('Entry 224');
    const pages = kept
      .queries()
      .filter((run) => run.argv[1] === 'list')
      .map((run) => run.argv.slice(2).join(' '));
    expect(pages).toEqual(['--project . --limit 201', '--project . --limit 201 --offset 200']);
  });

  test('the next page asks past the entries loaded and goes under them, oldest last', async ($, on) => {
    // Arrange
    const journalLines = Array.from({ length: 300 }, (_, at) => {
      const day = String(1 + Math.floor(at / 10)).padStart(2, '0');
      const month = at < 150 ? '08' : '09';
      return line(`2026-${month}-${day}T${10 + (at % 10)}0000Z`, 'repo', `Entry ${at}`);
    });
    /** Prints like the CLI: the newest `limit` after skipping `offset`, oldest first. */
    const page = (argv: ReadonlyArray<string>) => {
      const value = (flag: string) => Number(argv[argv.indexOf(flag) + 1] ?? 0);
      const offset = argv.includes('--offset') ? value('--offset') : 0;
      const end = journalLines.length - offset;
      return journalLines.slice(Math.max(end - value('--limit'), 0), end).join('\n');
    };
    const kept = world(on, { list: page });
    await $.session.start(SESSION);
    await $.command.run(journal());
    await kept.clock.settle();
    await $.ui.render(PANE as never);

    // Act
    await $.ui.scroll({ ...SCROLL, by: 1_000 } as never);
    await kept.clock.settle();
    await $.ui.scroll({ ...SCROLL, by: 1_000 } as never);
    const end = textOf(await $.ui.render(PANE as never));

    // Assert
    expect(end).toContain('Entry 0');
    expect(end).not.toContain('Loading older entries');
    const pages = kept
      .queries()
      .filter((run) => run.argv[1] === 'list')
      .map((run) => run.argv.slice(2).join(' '));
    expect(pages).toEqual(['--project . --limit 201', '--project . --limit 201 --offset 200']);
  });

  test('a date unit narrows the list to today\u2019s period, and a step goes one period back', async ($, on) => {
    // Arrange
    const kept = world(on, { list: line('2026-10-05T143000Z', 'repo', 'Did a thing') });
    await $.session.start(SESSION);
    await $.command.run(journal());
    await kept.clock.settle();
    await $.ui.render(PANE as never);
    const month = localDayTime(new Date()).day.slice(0, 7);

    // Act
    await $.ui.press({ plugin: PLUGIN, key: 'date:month' });
    await kept.clock.settle();
    const drawn = textOf(await $.ui.render(PANE as never));
    await $.ui.press({ plugin: PLUGIN, key: 'date:back' });
    await kept.clock.settle();

    // Assert
    const dates = kept
      .queries()
      .filter((run) => run.argv[1] === 'list')
      .map((run) => run.argv[run.argv.indexOf('--date') + 1]);
    const [year, number] = month.split('-').map(Number) as [number, number];
    const before = number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, '0')}`;
    expect(dates.slice(1)).toEqual([month, before]);
    expect(drawn).toContain('‹');
    expect(drawn).toContain('›');
  });

  test('a new entry written to the journal joins the list from the newest page alone', async ($, on) => {
    // Arrange
    let lines = [line('2026-10-04T090000Z', 'repo', 'Older'), line('2026-10-05T143000Z', 'repo', 'Newer')];
    const kept = world(on, { list: () => lines.join('\n') });
    on('tool.call', { tool: 'Write' }, () => ({ result: 'written' }) as never);
    await $.session.start(SESSION);
    await $.command.run(journal());
    await kept.clock.settle();
    await $.ui.render(PANE as never);
    lines = [...lines, line('2026-10-06T080000Z', 'repo', 'Newest')];

    // Act
    await $.tool.call({ tool: 'Write', file_path: `${JOURNAL_DIR}/2026-10-06T080000Z.md`, content: '' } as never);
    await kept.clock.advance(1_000);
    const drawn = textOf(await $.ui.render(PANE as never));

    // Assert
    const runs = kept.queries().map((run) => run.argv.slice(1).join(' '));
    expect(runs).toEqual(['list --project . --limit 201', 'list --project . --limit 200']);
    expect(drawn.indexOf('Newest') < drawn.indexOf('Newer')).toBe(true);
    expect(drawn).toContain('Older');
  });

  test('a write to the journal syncs it, and the journal row says how far the sync got', async ($, on) => {
    // Arrange
    const kept = world(on, { isSyncOn: true, sync: 'committed 2026-10-06T080000Z · pushed to origin/main\n' });
    on('tool.call', { tool: 'Write' }, () => ({ result: 'written' }) as never);
    await $.session.start(SESSION);
    await $.command.run(journal());
    await kept.clock.settle();
    const before = kept.queries().filter((run) => run.argv[1] === 'sync').length;

    // Act
    await $.tool.call({ tool: 'Write', file_path: `${JOURNAL_DIR}/2026-10-06T080000Z.md`, content: '' } as never);
    await $.tool.call({ tool: 'Write', file_path: `${JOURNAL_DIR}/2026-10-06T080001Z.md`, content: '' } as never);
    await kept.clock.advance(1_000);
    await kept.clock.settle();
    const drawn = textOf(await $.ui.render(PANE as never));

    // Assert
    const syncs = kept.queries().filter((run) => run.argv[1] === 'sync');
    expect(syncs.length).toBe(before + 1);
    expect(drawn).toContain('⇅ pushed to origin/main');
  });

  test('the session\u2019s start syncs, and the entries it brings in join the list', async ($, on) => {
    // Arrange
    let release = () => {};
    let lines = [line('2026-10-05T143000Z', 'repo', 'Here')];
    const kept = world(on, {
      isSyncOn: true,
      sync: 'nothing to commit · pulled 1 commit · up to date\n',
      holdSync: new Promise<void>((resolve) => (release = resolve)),
      list: () => lines.join('\n'),
    });
    await $.session.start(SESSION);
    await $.command.run(journal());
    await kept.clock.settle();
    lines = [...lines, line('2026-10-06T080000Z', 'repo', 'Pulled')];

    // Act
    release();
    await kept.clock.settle();
    const drawn = textOf(await $.ui.render(PANE as never));

    // Assert
    const syncs = kept.queries().filter((run) => run.argv[1] === 'sync');
    expect(syncs.map((run) => run.argv.slice(1))).toEqual([['sync']]);
    expect(drawn).toContain('Pulled');
    expect(drawn).toContain('⇅ up to date');
  });

  test('a write to the journal syncs it in a session that never opened the pane', async ($, on) => {
    // Arrange
    const kept = world(on, { isSyncOn: true, sync: 'committed 2026-10-06T080000Z · no remote\n' });
    on('tool.call', { tool: 'Write' }, () => ({ result: 'written' }) as never);
    await $.session.start(SESSION);
    await kept.clock.settle();
    const before = kept.queries().filter((run) => run.argv[1] === 'sync').length;

    // Act
    await $.tool.call({ tool: 'Write', file_path: `${JOURNAL_DIR}/2026-10-06T080000Z.md`, content: '' } as never);
    await kept.clock.advance(1_000);
    await kept.clock.settle();

    // Assert
    expect(kept.queries().filter((run) => run.argv[1] === 'sync').length).toBe(before + 1);
  });

  test('with sync off, neither a write to the journal nor the session\u2019s end runs the CLI for it', async ($, on) => {
    // Arrange
    const kept = world(on);
    on('tool.call', { tool: 'Write' }, () => ({ result: 'written' }) as never);
    await $.session.start(SESSION);
    await kept.clock.settle();

    // Act
    await $.tool.call({ tool: 'Write', file_path: `${JOURNAL_DIR}/2026-10-06T080000Z.md`, content: '' } as never);
    await kept.clock.advance(1_000);
    await kept.clock.settle();
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-1', resume: { id: 'session-1' } } as never);

    // Assert
    expect(kept.runs.filter((run) => run.argv[1] === 'sync').length).toBe(0);
  });

  test('the journal row shows the git icon only when the config turns sync on', async ($, on) => {
    // Arrange
    const kept = world(on);
    await $.session.start(SESSION);

    // Act
    await $.command.run(journal());
    await kept.clock.settle();
    const drawn = textOf(await $.ui.render(PANE as never));

    // Assert
    expect(drawn).toContain(JOURNAL_DIR);
    expect(drawn).not.toContain('⇅');
  });

  test('a write outside the journal does not sync', async ($, on) => {
    // Arrange
    const kept = world(on, { isSyncOn: true });
    on('tool.call', { tool: 'Write' }, () => ({ result: 'written' }) as never);
    await $.session.start(SESSION);
    await $.command.run(journal());
    await kept.clock.settle();
    const before = kept.queries().filter((run) => run.argv[1] === 'sync').length;

    // Act
    await $.tool.call({ tool: 'Write', file_path: '/work/notes.md', content: '' } as never);
    await kept.clock.advance(1_000);
    await kept.clock.settle();

    // Assert
    expect(kept.queries().filter((run) => run.argv[1] === 'sync').length).toBe(before);
  });

  test('the git icon shows from the config alone, and a push that failed adds its reason', async ($, on) => {
    // Arrange
    let release = () => {};
    const kept = world(on, {
      isSyncOn: true,
      sync: 'committed 2026-10-06T080000Z · push failed: could not read Username\n',
      exitCodes: { sync: 3 },
      holdSync: new Promise<void>((resolve) => (release = resolve)),
    });
    on('tool.call', { tool: 'Write' }, () => ({ result: 'written' }) as never);
    await $.session.start(SESSION);
    await $.command.run(journal());
    await kept.clock.settle();
    const before = textOf(await $.ui.render(PANE as never));
    release();

    // Act
    await $.tool.call({ tool: 'Write', file_path: `${JOURNAL_DIR}/2026-10-06T080000Z.md`, content: '' } as never);
    await kept.clock.advance(1_000);
    await kept.clock.settle();
    const drawn = textOf(await $.ui.render(PANE as never));

    // Assert
    expect(before).toContain('⇅ git');
    expect(drawn).toContain('⇅ push failed: could not read Username');
  });

  test('the session\u2019s end syncs what is left', async ($, on) => {
    // Arrange
    const kept = world(on, { isSyncOn: true });
    await $.session.start(SESSION);
    await kept.clock.settle();
    const before = kept.runs.filter((run) => run.argv[1] === 'sync').length;

    // Act
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-1', resume: { id: 'session-1' } } as never);

    // Assert
    const syncs = kept.runs.filter((run) => run.argv[1] === 'sync').map((run) => run.argv.slice(1));
    expect(syncs.length).toBe(before + 1);
    expect(syncs.at(-1)).toEqual(['sync', '--no-pull']);
  });

  test('the session\u2019s end neither waits for a sync under way nor starts another', async ($, on) => {
    // Arrange
    let release = () => {};
    const kept = world(on, { isSyncOn: true, holdSync: new Promise<void>((resolve) => (release = resolve)) });
    on('tool.call', { tool: 'Write' }, () => ({ result: 'written' }) as never);
    await $.session.start(SESSION);
    await kept.clock.settle();
    await $.tool.call({ tool: 'Write', file_path: `${JOURNAL_DIR}/2026-10-06T080000Z.md`, content: '' } as never);
    await kept.clock.advance(1_000);

    // Act
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-1', resume: { id: 'session-1' } } as never);
    const syncs = kept.runs.filter((run) => run.argv[1] === 'sync').length;
    release();

    // Assert
    expect(syncs).toBe(1);
  });

  test('a CLI that lists without ids is named as too old instead of an empty journal', async ($, on) => {
    // Arrange
    const kept = world(on, { list: '2026-10-06 16:04  repo  An entry in the old layout\n' });
    await $.session.start(SESSION);

    // Act
    await $.command.run(journal());
    await kept.clock.settle();
    const drawn = textOf(await $.ui.render(PANE as never));

    // Assert
    expect(drawn).toContain('agent-journal is older than this mod');
    expect(drawn).not.toContain('No entries yet.');
  });

  test('the CLI is always the plugin\u2019s own, never one on PATH, even when its file is not found', async ($, on) => {
    // Arrange
    const kept = world(on, {
      list: line('2026-10-05T143000Z', 'repo', 'Did a thing'),
      lands: (path) => (path.includes('/scripts/') ? undefined : '/repo'),
    });
    await $.session.start(SESSION);

    // Act
    await $.command.run(journal());
    await kept.clock.settle();

    // Assert
    const listed = kept.queries().find((run) => run.argv[1] === 'list');
    expect(listed?.argv[0]).toBe('/repo/scripts/agent-journal');
  });

  test('the CLI of the checkout is found through a linked plugin root', async ($, on) => {
    // Arrange
    const kept = world(on, {
      list: line('2026-10-05T143000Z', 'repo', 'Did a thing'),
      lands: (path) =>
        path === '/repo/scripts/agent-journal' ? path : path.includes('/scripts/') ? undefined : '/repo',
    });
    await $.session.start(SESSION);

    // Act
    await $.command.run(journal());
    await kept.clock.settle();

    // Assert
    const listed = kept.queries().find((run) => run.argv[1] === 'list');
    expect(listed?.argv[0]).toBe('/repo/scripts/agent-journal');
  });

  test('the permission checks of the journal tools are left to the user\u2019s own rules', async ($, on) => {
    // Arrange
    world(on);
    await $.session.start(SESSION);

    // Act
    const verdicts = await Promise.all(
      [TOOL_LIST, TOOL_READ, TOOL_WRITE].map((name) => $.tool.check({ tool: toolName(name), input: {} })),
    );

    // Assert
    expect(verdicts.map((verdict) => verdict.decision)).toEqual(['ask', 'ask', 'ask']);
  });
});
