import { describe, expect, test } from 'claude-code/testing';
import { localDayTime } from '../hooks/format.js';
import { busyNotice } from '../hooks/journal.js';
import { AGENT_TYPE, COMMAND, PANE_ID, PLUGIN, TOOL_LIST, TOOL_READ, TOOL_SEARCH, toolName } from '../hooks/names.js';
import { journal, JOURNAL_DIR, line, PANE, RECALL, SESSION, textOf, world } from './world.js';

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

describe('register', () => {
  test('registers the three tools, the hidden agent and the command at session start', async ($, on) => {
    // Arrange
    const kept = world(on);

    // Act
    await $.session.start(SESSION);

    // Assert
    expect(kept.registered.tools).toEqual(['list', 'search', 'read']);
    expect(kept.registered.commands).toEqual([COMMAND]);
    expect(kept.registered.agents.length).toBe(1);
    const agent = kept.registered.agents[0]!;
    expect(agent.model).toBe('haiku');
    expect(agent.tools).toEqual([toolName(TOOL_LIST), toolName(TOOL_SEARCH), toolName(TOOL_READ)]);
    expect(agent.disallowedTools).toEqual(['Write', 'Edit', 'NotebookEdit', 'Bash']);
  });

  test('the search agent is hidden from the main model and its tools are deferred, matched by their names', async ($, on) => {
    // Arrange
    world(on);
    on('tool.describe', ($, e) => ({ name: e.tool, description: '', isDeferred: false }) as never);
    await $.session.start(SESSION);

    // Act
    const offer = await $.agent.offer({ agent: AGENT_TYPE, description: '', source: 'plugin' } as never);
    const tools = await Promise.all(
      [TOOL_LIST, TOOL_SEARCH, TOOL_READ].map((name) =>
        $.tool.describe({ tool: toolName(name), description: 'Reads the journal.' } as never),
      ),
    );

    // Assert
    expect(offer.isOffered).toBe(false);
    expect(tools.map((tool) => (tool as { isDeferred: boolean }).isDeferred)).toEqual([true, true, true]);
  });

  test('a list call runs the CLI in the session directory with the filters', async ($, on) => {
    // Arrange
    const kept = world(on, { list: line('2026-10-05T143000Z', 'repo', 'Did a thing') });
    await $.session.start(SESSION);

    // Act
    const result = await $.tool.call({ tool: toolName(TOOL_LIST), since: '2026-09-28', project: '.' } as never);

    // Assert
    expect(kept.runs.length).toBe(1);
    expect(kept.runs[0]!.argv.slice(1)).toEqual(['list', '--since', '2026-09-28', '--project', '.', '--limit', '50']);
    expect(kept.runs[0]!.init?.cwd).toBe('/work');
    expect(JSON.stringify(result)).toContain('Did a thing');
  });

  test('a search text that would read as a flag is refused before the CLI runs', async ($, on) => {
    // Arrange
    const kept = world(on);
    await $.session.start(SESSION);

    // Act
    const result = await $.tool.call({ tool: toolName(TOOL_SEARCH), text: '--all' } as never);

    // Assert
    expect(kept.runs.length).toBe(0);
    expect(JSON.stringify(result)).toContain('must not start with');
  });

  test('a read call takes only an entry id', async ($, on) => {
    // Arrange
    const kept = world(on);
    await $.session.start(SESSION);

    // Act
    const results = await Promise.all(
      ['../secrets', '2026-10-07'].map((id) => $.tool.call({ tool: toolName(TOOL_READ), id } as never)),
    );

    // Assert
    expect(kept.runs.length).toBe(0);
    for (const result of results) expect(JSON.stringify(result)).toContain('not an entry id');
  });

  test('/journal with a question opens the pane and asks the agent with the recall text', async ($, on) => {
    // Arrange
    const kept = world(on, { context: RECALL });
    await $.session.start(SESSION);

    // Act
    const result = await $.command.run(journal('what did we fix last week?'));
    await kept.clock.settle();

    // Assert
    expect(result.text).not.toContain('did not start');
    expect(kept.opened.map((open) => open.id)).toEqual([PANE_ID]);
    const drawn = textOf(await $.ui.render(PANE as never));
    expect(drawn).toContain('› what did we fix last week?');
    const recall = kept.runs.find((run) => run.argv[1] === 'context')!;
    expect(recall.argv.slice(1)).toEqual([
      'context',
      '--recall',
      '--cwd',
      '/work',
      '--session-id',
      'session-1',
      '--agent',
      'claude/opus-5-5',
    ]);
    expect(kept.spawned.length).toBe(1);
    expect(JSON.stringify(kept.spawned[0])).toContain(`"subagent_type":"${AGENT_TYPE}"`);
    expect((kept.spawned[0] as { prompt: string }).prompt).toContain('The recall text.');
    expect((kept.spawned[0] as { prompt: string }).prompt).toContain('what did we fix last week?');
    expect((kept.spawned[0] as { prompt: string }).prompt).toContain('pass `project` `.`');
  });

  test('a spawn that gives no agent fails its question and leaves the chat free for the next', async ($, on) => {
    // Arrange
    const kept = world(on, { context: RECALL });
    await $.session.start(SESSION);

    // Act
    const first = await $.command.run(journal('first?'));
    const second = await $.command.run(journal('second?'));
    await kept.clock.settle();

    // Assert
    expect(first.text).toBe('The search started without an agent to wait for.');
    expect(second.text).toBe('The search started without an agent to wait for.');
    expect(kept.spawned.length).toBe(2);
  });

  test('a question while another is open starts nothing and says so, in the reply and under the input', async ($, on) => {
    // Arrange
    let release = () => {};
    const holdSpawn = new Promise<void>((resolve) => (release = resolve));
    const kept = world(on, { context: RECALL, holdSpawn });
    await $.session.start(SESSION);
    const first = $.command.run(journal('first?'));
    for (let turn = 0; turn < 50 && kept.spawned.length === 0; turn++) await Promise.resolve();

    // Act
    const reply = await $.command.run(journal('second?'));
    await $.ui.render(PANE as never);
    await $.ui.input({ plugin: PLUGIN, key: 'ask', text: 'third?' });
    const drawn = textOf(await $.ui.render(PANE as never));
    release();
    await first;

    // Assert
    expect(reply.text).toBe(busyNotice('second?'));
    expect(kept.spawned.length).toBe(1);
    expect(drawn).toContain(busyNotice('third?'));
  });

  test('a suggested question in the pane is asked through the slash command', async ($, on) => {
    // Arrange
    const kept = world(on, { context: RECALL });
    await $.session.start(SESSION);
    await $.command.run(journal());
    await kept.clock.settle();
    await $.ui.render(PANE as never);
    await $.ui.press({ plugin: PLUGIN, key: 'open-ask' });
    await $.ui.render(PANE as never);

    // Act
    await $.ui.press({ plugin: PLUGIN, key: 'suggest:0' });
    await kept.clock.settle();

    // Assert
    expect(kept.spawned.length).toBe(1);
    expect((kept.spawned[0] as { prompt: string }).prompt).toContain('What did we do today?');
  });

  test('a recall the CLI cannot give fails the question without starting the agent', async ($, on) => {
    // Arrange
    const kept = world(on, { failing: 'context' });
    await $.session.start(SESSION);

    // Act
    await $.command.run(journal('anything?'));
    await kept.clock.settle();
    const drawn = textOf(await $.ui.render(PANE as never));

    // Assert
    expect(kept.spawned.length).toBe(0);
    expect(drawn).toContain('context failed');
  });

  test('/journal alone lists the current project newest first', async ($, on) => {
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
    const listed = kept.runs.find((run) => run.argv[1] === 'list')!;
    expect(listed.argv.slice(1)).toEqual(['list', '--project', '.', '--limit', '201']);
    expect(drawn.indexOf('Newer') < drawn.indexOf('Older')).toBe(true);
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
    const pages = kept.runs.filter((run) => run.argv[1] === 'list').map((run) => run.argv.slice(2).join(' '));
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
    const pages = kept.runs.filter((run) => run.argv[1] === 'list').map((run) => run.argv.slice(2).join(' '));
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
    const dates = kept.runs
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
    const runs = kept.runs.map((run) => run.argv.slice(1).join(' '));
    expect(runs).toEqual(['list --project . --limit 201', 'config', 'list --project . --limit 200']);
    expect(drawn.indexOf('Newest') < drawn.indexOf('Newer')).toBe(true);
    expect(drawn).toContain('Older');
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

  test('the CLI of the checkout is found through a linked plugin root', async ($, on) => {
    // Arrange
    const kept = world(on, {
      list: line('2026-10-05T143000Z', 'repo', 'Did a thing'),
      lands: (path) => (path === '/repo/bin/agent-journal' ? path : path.includes('/bin/') ? undefined : '/repo'),
    });
    await $.session.start(SESSION);

    // Act
    await $.tool.call({ tool: toolName(TOOL_LIST) } as never);

    // Assert
    expect(kept.runs[0]!.argv[0]).toBe('/repo/bin/agent-journal');
  });

  test('a spawn of the search agent by this mod is allowed, any other goes on to the checks', async ($, on) => {
    // Arrange
    world(on);
    on('tool.check', () => ({ decision: 'ask', reason: 'the engine decides' }));
    await $.session.start(SESSION);

    // Act
    const other = await $.tool.check({ tool: 'Agent', input: { subagent_type: 'general-purpose' } });
    const tool = await $.tool.check({ tool: toolName(TOOL_LIST), input: {} });

    // Assert
    expect(other.decision).toBe('ask');
    expect(tool.decision).toBe('allow');
  });
});
