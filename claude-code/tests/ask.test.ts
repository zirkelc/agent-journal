import { describe, expect, test } from 'claude-code/testing';
import { busyNotice } from '../hooks/journal.js';
import {
  AGENT_TYPE,
  COMMAND,
  COMMAND_DESCRIPTION,
  IS_ASK_ON,
  PANE_ID,
  PLUGIN,
  TOOL_LIST,
  TOOL_READ,
  TOOL_SEARCH,
  toolName,
} from '../hooks/names.js';
import { journal, line, PANE, RECALL, SESSION, textOf, world } from './world.js';

/**
 * The pane's questions: the search agent, its three tools and the Ask view.
 * They are off while IS_ASK_ON is false (its comment says why). The kit has
 * no skip, so the tests of the pane's questions are defined only while they
 * are on, and the tests of the pane without them only while they are off.
 */
if (IS_ASK_ON) {
  describe('ask', () => {
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
      expect(agent.model).toBe('inherit');
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

    test('a search text that would read as a flag is refused before the CLI runs', async ($, on) => {
      // Arrange
      const kept = world(on);
      await $.session.start(SESSION);

      // Act
      const result = await $.tool.call({ tool: toolName(TOOL_SEARCH), text: '--all' } as never);

      // Assert
      expect(kept.queries().length).toBe(0);
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
      expect(kept.queries().length).toBe(0);
      for (const result of results) expect(JSON.stringify(result)).toContain('not an entry id');
    });

    test('/agent-journal with a question opens the pane and asks the agent with the recall text', async ($, on) => {
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
      const recall = kept.queries().find((run) => run.argv[1] === 'context')!;
      expect(recall.argv.slice(1)).toEqual([
        'context',
        '--recall',
        '--cwd',
        '/work',
        '--session-id',
        'session-1',
        '--agent',
        'claude/claude-opus-5-5[1m]',
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

    test('a question goes to Haiku until another model is picked in the Ask view, and the pick is stored', async ($, on) => {
      // Arrange
      const kept = world(on, { context: RECALL });
      await $.session.start(SESSION);
      await $.command.run(journal());
      await kept.clock.settle();
      await $.ui.render(PANE as never);
      await $.ui.press({ plugin: PLUGIN, key: 'open-ask' });
      await $.ui.render(PANE as never);
      await $.ui.press({ plugin: PLUGIN, key: 'suggest:0' });
      await kept.clock.settle();
      const first = kept.spawned[0] as { model?: string };

      // Act
      await $.ui.press({ plugin: PLUGIN, key: 'model:sonnet' });
      await kept.clock.settle();
      const drawn = await $.ui.render(PANE as never);
      await $.ui.input({ plugin: PLUGIN, key: 'ask', text: 'and on Sonnet?' });
      await kept.clock.settle();

      // Assert
      expect(first.model).toBe('haiku');
      expect(kept.spawned.length).toBe(2);
      expect((kept.spawned[1] as { model?: string }).model).toBe('sonnet');
      expect(kept.stored.get('model')).toBe('sonnet');
      expect(JSON.stringify(drawn)).toContain('Session (opus-5-5)');
    });

    test('a question asked on the session\u2019s model names no model, so the agent type\u2019s inherit applies', async ($, on) => {
      // Arrange
      const kept = world(on, { context: RECALL });
      kept.stored.set('model', 'inherit');
      await $.session.start(SESSION);

      // Act
      await $.command.run(journal('anything?'));
      await kept.clock.settle();

      // Assert
      expect(kept.spawned.length).toBe(1);
      expect((kept.spawned[0] as { model?: string }).model).toBe(undefined);
    });

    test('a stored model the Ask view no longer offers counts as Haiku', async ($, on) => {
      // Arrange
      const kept = world(on, { context: RECALL });
      kept.stored.set('model', 'gpt-4');
      await $.session.start(SESSION);

      // Act
      await $.command.run(journal('anything?'));
      await kept.clock.settle();

      // Assert
      expect((kept.spawned[0] as { model?: string }).model).toBe('haiku');
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

    test('the permission checks of the search agent and its tools are left to the user’s own rules', async ($, on) => {
      // Arrange
      world(on);
      on('tool.check', () => ({ decision: 'ask', reason: 'the engine decides' }));
      await $.session.start(SESSION);

      // Act
      const spawn = await $.tool.check({ tool: 'Agent', input: { subagent_type: AGENT_TYPE } });
      const tools = await Promise.all(
        [TOOL_LIST, TOOL_SEARCH, TOOL_READ].map((name) => $.tool.check({ tool: toolName(name), input: {} })),
      );

      // Assert
      expect(spawn.decision).toBe('ask');
      expect(tools.map((verdict) => verdict.decision)).toEqual(['ask', 'ask', 'ask']);
    });
  });
} else {
  describe('ask, off', () => {
    test('while the pane answers no questions, the command alone is registered, to open the journal', async ($, on) => {
      // Arrange
      const kept = world(on);

      // Act
      await $.session.start(SESSION);

      // Assert
      expect(kept.registered.commands).toEqual([COMMAND]);
      expect(kept.registered.tools).toEqual([]);
      expect(kept.registered.agents.length).toBe(0);
      expect(COMMAND_DESCRIPTION).toBe('Open the journal');
    });

    test('/agent-journal with text after it, while the pane answers no questions, only opens the pane', async ($, on) => {
      // Arrange
      const kept = world(on);
      await $.session.start(SESSION);

      // Act
      const result = await $.command.run(journal('what did we fix last week?'));

      // Assert
      expect(result).toEqual({});
      expect(kept.opened.map((open) => open.id)).toEqual([PANE_ID]);
      expect(kept.spawned.length).toBe(0);
    });
  });
}
