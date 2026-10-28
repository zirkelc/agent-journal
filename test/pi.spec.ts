import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI, ExecResult } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, test, vi } from 'vitest';
import agentJournal, {
  capped,
  CLI,
  filterArgs,
  MAX_OUTPUT,
  SECTION,
  TOOL_LIST,
  TOOL_READ,
  TOOL_WRITE,
  TOOLS_ENV,
  withNote,
} from '../pi/extensions/agent-journal.ts';
import {
  baseEnv,
  configure,
  type Fixture,
  fixture,
  frontmatter,
  GIT_IDENTITY,
  output,
  ROOT,
  rows,
  seed,
  tilde,
} from './helpers.ts';

type Handler = (event: any, ctx: any) => unknown;
type Tool = {
  name: string;
  annotations?: Record<string, boolean>;
  execute: (id: string, params: any, signal: undefined, onUpdate: undefined, ctx: any) => Promise<any>;
};

/** The tools Pi starts with, before an extension adds its own. */
const BUILT_IN = ['read', 'bash', 'edit', 'write'];

/**
 * Pi as the extension sees it. Only the boundary is fake: the handlers and the
 * tools are called as Pi calls them, and `exec` runs the real CLI of the
 * package, with the fixture's home, so nothing reads the machine's own config.
 */
function pi(store: Fixture, options: { stopped?: (args: Array<string>) => boolean } = {}) {
  const handlers = new Map<string, Array<Handler>>();
  const tools = new Map<string, Tool>();
  /** The arguments of each CLI run, in the order the extension started them. */
  const runs: Array<Array<string>> = [];
  let active = [...BUILT_IN];
  const api = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerTool: (tool: Tool) => {
      tools.set(tool.name, tool);
      active.push(tool.name);
    },
    getActiveTools: () => [...active],
    setActiveTools: (names: Array<string>) => {
      active = [...names];
    },
    exec: (command: string, args: Array<string>, execOptions: { cwd?: string; timeout?: number } = {}) =>
      new Promise<ExecResult>((done) => {
        runs.push(args);
        /** As Pi ends a run at its timeout: the signal leaves no exit code, and Pi reports code 0. */
        if (options.stopped?.(args)) return done({ stdout: '', stderr: '', code: 0, killed: true });
        execFile(
          command,
          args,
          { cwd: execOptions.cwd, timeout: execOptions.timeout, env: baseEnv(store, GIT_IDENTITY), encoding: 'utf8' },
          (error, stdout, stderr) => {
            const killed = Boolean(error?.killed);
            const code = !error || killed ? 0 : typeof error.code === 'number' ? error.code : 1;
            done({ stdout, stderr, code, killed });
          },
        );
      }),
  };
  agentJournal(api as unknown as ExtensionAPI);

  const setStatus = vi.fn<(key: string, text: string | undefined) => void>();
  const ctx = (options: { hasUI?: boolean } = {}) => ({
    hasUI: options.hasUI ?? true,
    cwd: store.repo,
    model: { id: 'test-model' },
    sessionManager: { getSessionId: () => 'pi-session-1' },
    ui: { setStatus },
  });

  /** Calls each handler of an event in order, and gives back the last result. */
  async function emit(event: string, payload: Record<string, unknown>, context = ctx()): Promise<any> {
    let result: unknown;
    for (const handler of handlers.get(event) ?? []) result = await handler({ type: event, ...payload }, context);
    return result;
  }

  /** Calls a tool as the model would, and gives back its text. */
  async function call(name: string, params: Record<string, unknown>, context = ctx()): Promise<string> {
    const result = await tools.get(name)!.execute('call-1', params, undefined, undefined, context);
    return result.content.map((part: { text: string }) => part.text).join('');
  }

  return {
    emit,
    call,
    ctx,
    setStatus,
    runs,
    tools,
    active: () => active,
    /** As `--tools` or another extension sets them before the session starts. */
    setActive: (names: Array<string>) => api.setActiveTools(names),
  };
}

/** The event of a run on Pi 1.0 and later, which builds the system prompt from sections. */
function runStart() {
  return { systemPrompt: 'base prompt', systemPromptOptions: { cwd: '', sections: {} as Record<string, string> } };
}

function git(cwd: string, ...args: Array<string>): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...GIT_IDENTITY, GIT_CEILING_DIRECTORIES: cwd },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const subjects = (cwd: string): Array<string> => git(cwd, 'log', '--format=%s', '--branches').split('\n');

/** A journal with sync on and one entry committed. A remote that does not exist makes the push fail. */
function synced(store: Fixture, origin?: string): void {
  seed(store, [{ stem: '2026-10-11T090000Z', project: 'demo', summary: 'First.' }]);
  output(store, ['sync', 'init', ...(origin ? [origin] : [])], { env: GIT_IDENTITY });
}

const SECOND = { stem: '2026-10-11T100000Z', project: 'demo', summary: 'Second.' };

/** The id in the write tool's answer. */
const idOf = (answer: string): string => /(\d{4}-\d{2}-\d{2}T\d{6}Z)/.exec(answer)![1]!;

describe('the rules', () => {
  test(`should run the CLI copy in its own package`, () => {
    // Assert
    expect(CLI).toBe(join(ROOT, 'pi', 'scripts', 'agent-journal'));
  });

  test(`should add the rules for the tools as a system prompt section`, async () => {
    // Arrange
    const store = fixture();
    const host = pi(store);
    const event = runStart();

    // Act
    await host.emit('session_start', { reason: 'startup' });
    const result = await host.emit('before_agent_start', event);

    // Assert
    expect(result).toBeUndefined();
    const rules = event.systemPromptOptions.sections[SECTION]!;
    expect(rules).toContain(`\`${TOOL_WRITE}\` tool`);
    expect(rules).toContain(`\`${TOOL_READ}\``);
    expect(rules).not.toContain('date -u');
  });

  test(`should give the rules for the tools the agent and the id of the session, for the filters`, async () => {
    // Arrange
    const store = fixture();
    const host = pi(store);
    const event = runStart();

    // Act
    await host.emit('session_start', { reason: 'startup' });
    await host.emit('before_agent_start', event);

    // Assert
    const rules = event.systemPromptOptions.sections[SECTION]!;
    expect(rules).toContain(`\`${TOOL_LIST}\``);
    expect(rules).toContain('- `agent`: `pi/test-model`');
    expect(rules).toContain('- `session_id`: `pi-session-1`');
  });

  test(`should add the rules at the end of the system prompt when Pi has no sections`, async () => {
    // Arrange
    const store = fixture();
    const host = pi(store);

    // Act
    await host.emit('session_start', { reason: 'startup' });
    const result = await host.emit('before_agent_start', { systemPrompt: 'base prompt', systemPromptOptions: {} });

    // Assert
    expect(result.systemPrompt.startsWith('base prompt\n\n')).toBe(true);
    expect(result.systemPrompt).toContain(`\`${TOOL_WRITE}\` tool`);
  });

  test(`should add the rules at the end of the system prompt when Pi gives no options at all`, async () => {
    // Arrange
    const store = fixture();
    const host = pi(store);

    // Act
    await host.emit('session_start', { reason: 'startup' });
    const result = await host.emit('before_agent_start', { systemPrompt: 'base prompt' });

    // Assert
    expect(result.systemPrompt.startsWith('base prompt\n\n')).toBe(true);
  });

  test(`should give no rules and no tools to a session without a UI, such as a subagent in print mode`, async () => {
    // Arrange
    const store = fixture();
    const host = pi(store);
    const event = runStart();

    // Act
    await host.emit('session_start', { reason: 'startup' }, host.ctx({ hasUI: false }));
    const result = await host.emit('before_agent_start', event, host.ctx({ hasUI: false }));

    // Assert
    expect(result).toBeUndefined();
    expect(event.systemPromptOptions.sections).toEqual({});
    expect(host.active()).toEqual(BUILT_IN);
  });
});

describe('the tools', () => {
  /** Pi asks for no approval, but a permission extension decides by these hints. */
  test(`should mark the read tools as read-only, and the write tool as not destructive`, () => {
    // Arrange
    const host = pi(fixture());

    // Act
    const hints = (name: string) => host.tools.get(name)!.annotations;

    // Assert
    expect(hints(TOOL_LIST)!.readOnlyHint).toBe(true);
    expect(hints(TOOL_READ)!.readOnlyHint).toBe(true);
    expect(hints(TOOL_WRITE)).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  test(`should write an entry with the values of the session, and answer with its id`, async () => {
    // Arrange
    const store = fixture();
    const host = pi(store);
    await host.emit('session_start', { reason: 'startup' });

    // Act
    const answer = await host.call(TOOL_WRITE, { summary: 'Wrote it through the tool.', body: 'The body.' });

    // Assert
    const text = readFileSync(join(store.journalDir, `${idOf(answer)}.md`), 'utf8');
    const fields = frontmatter(text);
    expect(fields.project).toBe('repo');
    expect(fields.summary).toBe('Wrote it through the tool.');
    expect(fields.cwd).toBe(tilde(store, store.repo));
    expect(fields.agent).toBe('pi/test-model');
    expect(fields.session_id).toBe('pi-session-1');
    expect(text.endsWith('---\n\nThe body.\n')).toBe(true);
  });

  /** The CLI refuses these too, but it keeps a draft folder for each one, and a model that retries makes many. */
  test.each([['x'.repeat(201)], ['Said "done".'], ['Two\nlines.']])(
    `should refuse the summary %j before the CLI runs`,
    async (summary) => {
      // Arrange
      const store = fixture();
      const host = pi(store);

      // Act
      const result = host.call(TOOL_WRITE, { summary, body: 'The body.' });

      // Assert
      await expect(result).rejects.toThrow();
      expect(host.runs.filter((args) => args[0] === 'write').length).toBe(0);
    },
  );

  test(`should write a summary of exactly 200 characters`, async () => {
    // Arrange
    const store = fixture();
    const host = pi(store);

    // Act
    const answer = await host.call(TOOL_WRITE, { summary: 'x'.repeat(200), body: 'The body.' });

    // Assert
    expect(answer).toMatch(/^Wrote the journal entry \d{4}-\d{2}-\d{2}T\d{6}Z\.$/);
  });

  test(`should fail the call when the CLI refuses the entry`, async () => {
    // Arrange
    const store = fixture();
    const host = pi(store);

    // Act
    const result = host.call(TOOL_WRITE, { summary: 'x'.repeat(201), body: 'The body.' });

    // Assert
    await expect(result).rejects.toThrow();
  });

  test(`should commit the entry after the write tool when sync is on`, async () => {
    // Arrange
    const store = fixture();
    synced(store);
    const host = pi(store);
    await host.emit('session_start', { reason: 'startup' });

    // Act
    const answer = await host.call(TOOL_WRITE, { summary: 'Synced by the tool.', body: 'The body.' });

    // Assert
    await vi.waitFor(() => expect(subjects(store.journalDir)[0]).toBe(`journal: ${idOf(answer)} Synced by the tool.`), {
      timeout: 5_000,
    });
  });

  test(`should list the entries of one project, as many as asked for`, async () => {
    // Arrange
    const store = fixture();
    seed(store, [
      { stem: '2026-10-10T090000Z', project: 'demo', summary: 'Old.' },
      { stem: '2026-10-11T090000Z', project: 'other', summary: 'Elsewhere.' },
      { stem: '2026-10-12T090000Z', project: 'demo', summary: 'New.' },
      { stem: '2026-10-13T090000Z', project: 'demo', summary: 'Newest.' },
    ]);
    const host = pi(store);

    // Act
    const answer = await host.call(TOOL_LIST, { project: 'demo', limit: 2 });

    // Assert
    expect(rows(answer).map((row) => row.summary)).toEqual(['New.', 'Newest.']);
  });

  test(`should search the summaries and bodies, with every term a regex that must match`, async () => {
    // Arrange
    const store = fixture();
    seed(store, [
      { stem: '2026-10-10T090000Z', project: 'demo', summary: 'One.', body: 'About the rate limit.\nAnd the retry.' },
      { stem: '2026-10-11T090000Z', project: 'demo', summary: 'Two.', body: 'About the rate limit only.' },
      { stem: '2026-10-12T090000Z', project: 'demo', summary: 'Three.', body: 'About something else.' },
    ]);
    const host = pi(store);

    // Act
    const answer = await host.call(TOOL_LIST, { terms: ['RATE|nothing', 'retry'] });

    // Assert
    expect(answer).toBe('2026-10-10T090000Z\tdemo\tOne.\tAbout the rate limit.');
  });

  test(`should read the terms as text when they are fixed`, async () => {
    // Arrange
    const store = fixture();
    seed(store, [
      { stem: '2026-10-10T090000Z', project: 'demo', summary: 'Called retry(3) twice.' },
      { stem: '2026-10-11T090000Z', project: 'demo', summary: 'Called retry once.' },
    ]);
    const host = pi(store);

    // Act
    const answer = await host.call(TOOL_LIST, { terms: ['retry(3)'], fixed: true });

    // Assert
    expect(rows(answer).map((row) => row.id)).toEqual(['2026-10-10T090000Z']);
  });

  test(`should fail a list that the timeout stopped, rather than give its part as the answer`, async () => {
    // Arrange
    const store = fixture();
    seed(store, [{ stem: '2026-10-10T090000Z', project: 'demo', summary: 'One.' }]);
    const host = pi(store, { stopped: (args) => args[0] === 'list' });

    // Act
    const result = host.call(TOOL_LIST, {});

    // Assert
    await expect(result).rejects.toThrow();
  });

  test(`should refuse a term that the CLI would read as an option`, async () => {
    // Arrange
    const host = pi(fixture());

    // Act
    const result = host.call(TOOL_LIST, { terms: ['--all'] });

    // Assert
    await expect(result).rejects.toThrow();
  });

  test(`should say which offset gives the older matches that the limit left out`, async () => {
    // Arrange
    const store = fixture();
    seed(store, [
      { stem: '2026-10-10T090000Z', project: 'demo', summary: 'One.' },
      { stem: '2026-10-11T090000Z', project: 'demo', summary: 'Two.' },
    ]);
    const host = pi(store);

    // Act
    const answer = await host.call(TOOL_LIST, { limit: 1 });

    // Assert
    expect(answer).toBe(
      '2026-10-11T090000Z\tdemo\tTwo.\nmatches 1 to 1 of 2, counted from the newest. 1 older match, back to 2026-10-10, is not in this result: call again with offset 1 before you answer about it.',
    );
  });

  test(`should keep the short note on the older matches when their count fails`, async () => {
    // Arrange
    const store = fixture();
    seed(store, [
      { stem: '2026-10-10T090000Z', project: 'demo', summary: 'One.' },
      { stem: '2026-10-11T090000Z', project: 'demo', summary: 'Two.' },
    ]);
    const host = pi(store, { stopped: (args) => args.includes('--by') });

    // Act
    const answer = await host.call(TOOL_LIST, { limit: 1 });

    // Assert
    expect(answer).toBe(
      '2026-10-11T090000Z\tdemo\tTwo.\nmatches 1 to 1, counted from the newest; call again with offset 1 for older ones',
    );
  });

  test(`should filter a list, and the entries of a period, by directory, host, user and agent`, async () => {
    // Arrange
    const store = fixture();
    const here = { cwd: '~/Developer/demo', host: 'laptop', user: 'me', agent: 'claude/claude-opus-5-5' };
    seed(store, [
      { stem: '2026-10-10T090000Z', project: 'demo', summary: 'Here.', ...here },
      { stem: '2026-10-10T100000Z', project: 'demo', summary: 'Other dir.', ...here, cwd: '~/Developer/other' },
      { stem: '2026-10-10T110000Z', project: 'demo', summary: 'Other host.', ...here, host: 'build-box' },
      { stem: '2026-10-10T120000Z', project: 'demo', summary: 'Other user.', ...here, user: 'ci' },
      { stem: '2026-10-10T130000Z', project: 'demo', summary: 'Other agent.', ...here, agent: 'pi/claude-sonnet-5-5' },
    ]);
    const host = pi(store);
    const filters = { cwd: '~/Developer/demo', host: 'lap*', user: 'me', agent: 'claude-opus-*' };

    // Act
    const listed = await host.call(TOOL_LIST, filters);
    const read = await host.call(TOOL_READ, { which: ['2026-10-10'], ...filters });
    const other = await host.call(TOOL_LIST, { host: 'build-box' });

    // Assert
    expect(rows(listed).map((row) => row.summary)).toEqual(['Here.']);
    expect([...read.matchAll(/^summary: "(.+)"$/gm)].map((match) => match[1])).toEqual(['Here.']);
    expect(rows(other).map((row) => row.summary)).toEqual(['Other host.']);
  });

  test(`should count every match for each project with by, also beyond the default limit`, async () => {
    // Arrange
    const store = fixture();
    /** 60 entries, more than the default limit: 40 of demo and 20 of other. */
    seed(
      store,
      Array.from({ length: 60 }, (_, index) => ({
        stem: `2026-10-${String(10 + Math.floor(index / 10)).padStart(2, '0')}T${String(8 + (index % 10)).padStart(2, '0')}0000Z`,
        project: index % 3 === 2 ? 'other' : 'demo',
        summary: `Entry ${index}.`,
      })),
    );
    const host = pi(store);

    // Act
    const answer = await host.call(TOOL_LIST, { by: 'project' });

    // Assert
    expect(answer).toBe('40\tdemo\n20\tother\ntotal\t60');
  });

  test(`should refuse by together with a limit, because a count reads every match`, async () => {
    // Arrange
    const store = fixture();
    seed(store, [{ stem: '2026-10-10T090000Z', project: 'demo', summary: 'One.' }]);
    const host = pi(store);

    // Act
    const result = host.call(TOOL_LIST, { by: 'project', limit: 10 });

    // Assert
    await expect(result).rejects.toThrow();
  });

  test(`should drop the oldest lines of a list that is too long, and say which offset gives them`, async () => {
    // Arrange
    const store = fixture();
    /** 100 entries with summaries of 500 characters, 50,000 characters in all. */
    const stems = Array.from(
      { length: 100 },
      (_, index) =>
        `2026-10-${String(1 + Math.floor(index / 10)).padStart(2, '0')}T${String(8 + (index % 10)).padStart(2, '0')}0000Z`,
    );
    seed(
      store,
      stems.map((stem, index) => ({ stem, project: 'demo', summary: `${index} ${'y'.repeat(495)}` })),
    );
    const host = pi(store);

    // Act
    const answer: string = await host.call(TOOL_LIST, { limit: 100, offset: 5 });

    // Assert
    const lines = answer.split('\n');
    const shown = rows(answer);
    expect(answer.length).toBeLessThanOrEqual(MAX_OUTPUT);
    expect(shown.at(-1)!.id).toBe(stems.at(-6));
    expect(shown[0]!.id).toBe(stems.at(-5 - shown.length));
    const next = 5 + shown.length;
    expect(lines.at(-1)).toBe(
      `matches 6 to ${next} of 100, counted from the newest. ${100 - next} older matches, back to 2026-10-01, are not in this result: call again with offset ${next} before you answer about them.`,
    );
  });

  test(`should say so when nothing matches`, async () => {
    // Arrange
    const store = fixture();
    seed(store, [{ stem: '2026-10-10T090000Z', project: 'demo', summary: 'One.' }]);
    const host = pi(store);

    // Act
    const answer = await host.call(TOOL_LIST, { terms: ['nowhere'] });

    // Assert
    expect(answer).toBe('No entries match.');
  });

  test(`should say that the journal is empty, without a blank first line`, async () => {
    // Arrange
    const store = fixture();
    seed(store, []);
    const host = pi(store);

    // Act
    const listed = await host.call(TOOL_LIST, {});
    const searched = await host.call(TOOL_LIST, { terms: ['deploy'] });

    // Assert
    const empty = `no entries yet in ${store.journalDir}\nyour agent writes them on its own, or write one with: agent-journal write`;
    expect(listed).toBe(empty);
    expect(searched).toBe(empty);
  });

  test(`should count a total of 0 in an empty journal, and say that it is empty`, async () => {
    // Arrange
    const store = fixture();
    seed(store, []);
    const host = pi(store);

    // Act
    const answer = await host.call(TOOL_LIST, { by: 'project' });

    // Assert
    expect(answer).toBe(
      `total\t0\nno entries yet in ${store.journalDir}\nyour agent writes them on its own, or write one with: agent-journal write`,
    );
  });

  test(`should count a total of 0 when nothing matches`, async () => {
    // Arrange
    const store = fixture();
    seed(store, [{ stem: '2026-10-10T090000Z', project: 'demo', summary: 'One.' }]);
    const host = pi(store);

    // Act
    const answer = await host.call(TOOL_LIST, { by: 'project', project: 'other' });

    // Assert
    expect(answer).toBe('total\t0');
  });

  test(`should answer that nothing matches when the latest entry of an empty journal is read`, async () => {
    // Arrange
    const store = fixture();
    seed(store, []);
    const host = pi(store);

    // Act
    const answer = await host.call(TOOL_READ, { which: ['latest'] });

    // Assert
    expect(answer).toBe(`no entries in ${store.journalDir}`);
  });

  test.each([
    [TOOL_LIST, {}],
    [TOOL_LIST, { by: 'project' }],
    [TOOL_READ, { which: ['latest'] }],
  ])(`should fail the call when the journal folder does not exist: %s %j`, async (tool, params) => {
    // Arrange
    const store = fixture();
    const missing = join(store.home, 'nowhere');
    configure(store, ['set', 'journal_dir', missing]);
    /** Setting the folder creates it, so it goes again: a folder deleted or unmounted later. */
    rmSync(missing, { recursive: true });
    const host = pi(store);

    // Act
    const result = host.call(tool, params);

    // Assert
    await expect(result).rejects.toThrow();
  });

  /** The candidates are on stderr, and the model needs their ids to read the one it means. */
  test(`should give the candidates when an id prefix matches several entries`, async () => {
    // Arrange
    const store = fixture();
    seed(store, [
      { stem: '2026-10-10T090000Z', project: 'demo', summary: 'One.' },
      { stem: '2026-10-10T091500Z', project: 'demo', summary: 'Two.' },
    ]);
    const host = pi(store);

    // Act
    const answer = await host.call(TOOL_READ, { which: ['2026-10-10T09'] });

    // Assert
    expect(answer).toBe(
      '2026-10-10T09 matches 2 entries:\n2026-10-10T090000Z\tdemo\tOne.\n2026-10-10T091500Z\tdemo\tTwo.',
    );
  });

  test(`should read one entry in full`, async () => {
    // Arrange
    const store = fixture();
    seed(store, [{ stem: '2026-10-10T090000Z', project: 'demo', summary: 'One.', body: 'The whole body.' }]);
    const host = pi(store);

    // Act
    const answer = await host.call(TOOL_READ, { which: ['2026-10-10T090000Z'] });

    // Assert
    expect(answer).toBe(readFileSync(join(store.journalDir, '2026-10-10T090000Z.md'), 'utf8').trim());
  });

  /** The filters and the page work only for a period, and the CLI refuses them with ids. */
  test(`should read an entry by id when the model also gives filters and a page`, async () => {
    // Arrange
    const store = fixture();
    seed(store, [{ stem: '2026-10-10T090000Z', project: 'demo', summary: 'One.', body: 'The whole body.' }]);
    const host = pi(store);

    // Act
    const answer = await host.call(TOOL_READ, { which: ['2026-10-10T090000Z'], project: 'demo', limit: 5, offset: 1 });

    // Assert
    expect(answer).toBe(readFileSync(join(store.journalDir, '2026-10-10T090000Z.md'), 'utf8').trim());
  });

  test(`should read several entries in the order given`, async () => {
    // Arrange
    const store = fixture();
    seed(store, [
      { stem: '2026-10-10T090000Z', project: 'demo', summary: 'One.' },
      { stem: '2026-10-11T090000Z', project: 'demo', summary: 'Two.' },
    ]);
    const host = pi(store);
    const file = (stem: string) => readFileSync(join(store.journalDir, `${stem}.md`), 'utf8');

    // Act
    const answer = await host.call(TOOL_READ, { which: ['2026-10-11T090000Z', '2026-10-10T09'] });

    // Assert
    expect(answer).toBe(`${file('2026-10-11T090000Z').trim()}\n\n${file('2026-10-10T090000Z').trim()}`);
  });

  test(`should read every entry of a period of one project, oldest first`, async () => {
    // Arrange
    const store = fixture();
    seed(store, [
      { stem: '2026-09-30T120000Z', project: 'demo', summary: 'Before.' },
      { stem: '2026-10-10T120000Z', project: 'demo', summary: 'First.' },
      { stem: '2026-10-11T120000Z', project: 'other', summary: 'Elsewhere.' },
      { stem: '2026-10-12T120000Z', project: 'demo', summary: 'Second.' },
    ]);
    const host = pi(store);

    // Act
    const answer = await host.call(TOOL_READ, { which: ['2026-10'], project: 'demo' });

    // Assert
    expect([...answer.matchAll(/^summary: "(.+)"$/gm)].map((match) => match[1])).toEqual(['First.', 'Second.']);
  });

  test(`should page back through a period with the offset that its note names`, async () => {
    // Arrange
    const store = fixture();
    seed(store, [
      { stem: '2026-10-10T120000Z', project: 'demo', summary: 'First.' },
      { stem: '2026-10-11T120000Z', project: 'demo', summary: 'Second.' },
    ]);
    const host = pi(store);
    const summaries = (answer: string) => [...answer.matchAll(/^summary: "(.+)"$/gm)].map((match) => match[1]);

    // Act
    const newest = await host.call(TOOL_READ, { which: ['2026-10'], limit: 1 });
    const older = await host.call(TOOL_READ, { which: ['2026-10'], limit: 1, offset: 1 });

    // Assert
    expect(summaries(newest)).toEqual(['Second.']);
    expect(newest).toContain('call again with offset 1 for older ones');
    expect(summaries(older)).toEqual(['First.']);
  });

  test(`should give the summaries of a period that is too long to read whole`, async () => {
    // Arrange
    const store = fixture();
    /** 30 entries of 2,000 characters each, every half hour from 06:00 UTC on. */
    const stems = Array.from(
      { length: 30 },
      (_, index) =>
        `2026-10-10T${String(6 + Math.floor(index / 2)).padStart(2, '0')}${index % 2 === 0 ? '00' : '30'}00Z`,
    );
    seed(
      store,
      stems.map((stem, index) => ({ stem, project: 'demo', summary: `Entry ${index}.`, body: 'x'.repeat(2_000) })),
    );
    const host = pi(store);

    // Act
    const answer: string = await host.call(TOOL_READ, { which: ['2026-10-10'], project: 'demo' });

    // Assert
    expect(answer.split('\n')[0]).toMatch(
      /^The entries of 2026-10-10 are \d+ characters, more than one result holds\./,
    );
    expect(rows(answer).map((row) => row.summary)).toEqual(stems.map((_, index) => `Entry ${index}.`));
    expect(answer).not.toContain('xxxx');
  });

  test(`should give the summaries of the page that the call asked for, when that page is too long to read whole`, async () => {
    // Arrange
    const store = fixture();
    /** 30 entries of 5,000 characters each, every half hour from 06:00 UTC on, so 10 of them are too long already. */
    const stems = Array.from(
      { length: 30 },
      (_, index) =>
        `2026-10-10T${String(6 + Math.floor(index / 2)).padStart(2, '0')}${index % 2 === 0 ? '00' : '30'}00Z`,
    );
    seed(
      store,
      stems.map((stem, index) => ({ stem, project: 'demo', summary: `Entry ${index}.`, body: 'x'.repeat(5_000) })),
    );
    const host = pi(store);

    // Act
    const answer: string = await host.call(TOOL_READ, { which: ['2026-10-10'], limit: 10, offset: 10 });

    // Assert
    /** Newest first, the offset skips entries 29 to 20, and the limit keeps 19 to 10. */
    expect(rows(answer).map((row) => row.summary)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Entry ${10 + index}.`),
    );
  });

  test(`should say so for an entry that does not exist`, async () => {
    // Arrange
    const store = fixture();
    seed(store, [{ stem: '2026-10-10T090000Z', project: 'demo', summary: 'One.' }]);
    const host = pi(store);

    // Act
    const answer = await host.call(TOOL_READ, { which: ['2020-01-01T000000Z'] });

    // Assert
    expect(answer).toBe('no entry matches 2020-01-01T000000Z');
  });
});

describe('without the tools', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test(`should register no tool when the environment turns them off`, () => {
    // Arrange
    vi.stubEnv(TOOLS_ENV, 'off');

    // Act
    const host = pi(fixture());

    // Assert
    expect(host.tools.size).toBe(0);
    expect(host.active()).toEqual(BUILT_IN);
  });

  test(`should give the rules for files, with the values of the session`, async () => {
    // Arrange
    vi.stubEnv(TOOLS_ENV, 'off');
    const store = fixture();
    const host = pi(store);
    const event = runStart();

    // Act
    await host.emit('session_start', { reason: 'startup' });
    await host.emit('before_agent_start', event);

    // Assert
    const rules = event.systemPromptOptions.sections[SECTION]!;
    expect(rules).toContain('date -u');
    expect(rules).toContain('- `agent`: `pi/test-model`');
    expect(rules).toContain('- `session_id`: `pi-session-1`');
    expect(rules).not.toContain(TOOL_WRITE);
  });

  test(`should give the rules for files when the journal tools are not active, as with --tools read,bash`, async () => {
    // Arrange
    const store = fixture();
    const host = pi(store);
    host.setActive(['read', 'bash']);
    const event = runStart();

    // Act
    await host.emit('session_start', { reason: 'startup' });
    await host.emit('before_agent_start', event);

    // Assert
    const rules = event.systemPromptOptions.sections[SECTION]!;
    expect(rules).toContain('date -u');
    expect(rules).not.toContain(TOOL_WRITE);
  });

  test(`should keep the tools for any other value`, () => {
    // Arrange
    vi.stubEnv(TOOLS_ENV, 'on');

    // Act
    const host = pi(fixture());

    // Assert
    expect([...host.tools.keys()]).toEqual([TOOL_WRITE, TOOL_LIST, TOOL_READ]);
  });
});

describe('the filters and the output', () => {
  test(`should give the CLI only the filters that were set, and the default limit`, () => {
    // Act
    const args = filterArgs({ since: '7d', project: ' ', offset: 0 });

    // Assert
    expect(args).toEqual(['--since', '7d', '--limit', '50']);
  });

  test(`should not ask for more than the most entries`, () => {
    // Act
    const args = filterArgs({ limit: 1_000, offset: 20 });

    // Assert
    expect(args).toEqual(['--limit', '200', '--offset', '20']);
  });

  test(`should add the note on stderr after the output`, () => {
    // Act
    const text = withNote('a\tb\tc\n', 'the note\n');

    // Assert
    expect(text).toBe('a\tb\tc\nthe note');
  });

  test(`should cut a long output and say so`, () => {
    // Act
    const text = capped('x'.repeat(MAX_OUTPUT + 1));

    // Assert
    expect(text.startsWith('x'.repeat(MAX_OUTPUT))).toBe(true);
    expect(text.endsWith('narrow the filters to see the rest.')).toBe(true);
  });
});

describe('the start of the session', () => {
  test(`should pull the entries of another machine when sync is on`, async () => {
    // Arrange
    const store = fixture();
    const origin = join(store.home, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', origin]);
    synced(store, origin);
    const other = join(store.home, 'other');
    execFileSync('git', ['clone', '-q', '-b', git(store.journalDir, 'branch', '--show-current'), origin, other]);
    writeFileSync(join(other, `${SECOND.stem}.md`), '---\nsummary: "Other machine."\n---\n');
    git(other, 'add', '.');
    git(other, 'commit', '-q', '-m', 'other');
    git(other, 'push', '-q');
    const host = pi(store);

    // Act
    await host.emit('session_start', { reason: 'startup' });

    // Assert
    await vi.waitFor(() => expect(existsSync(join(store.journalDir, `${SECOND.stem}.md`))).toBe(true), {
      timeout: 10_000,
    });
  }, 15_000);

  test(`should show a pull that failed in the footer`, async () => {
    // Arrange
    const store = fixture();
    const origin = join(store.home, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', origin]);
    synced(store, origin);
    renameSync(origin, join(store.home, 'moved.git'));
    const host = pi(store);

    // Act
    await host.emit('session_start', { reason: 'startup' });

    // Assert
    await vi.waitFor(
      () => {
        const [key, text] = host.setStatus.mock.calls.at(-1) ?? [];
        expect(key).toBe('agent-journal');
        expect(text).toMatch(/^journal sync failed: nothing to commit · pull failed: .+$/);
      },
      { timeout: 10_000 },
    );
  }, 15_000);

  test(`should not sync in a session without a UI, such as a subagent in print mode`, async () => {
    // Arrange
    const store = fixture();
    synced(store);
    const host = pi(store);

    // Act
    await host.emit('session_start', { reason: 'startup' }, host.ctx({ hasUI: false }));
    await host.emit('session_shutdown', { reason: 'quit' }, host.ctx({ hasUI: false }));

    // Assert
    expect(host.runs.filter((args) => args[0] === 'sync').length).toBe(1);
  });
});

describe('the end of the session', () => {
  test(`should commit what was written another way`, async () => {
    // Arrange
    const store = fixture();
    synced(store);
    const host = pi(store);
    await host.emit('session_start', { reason: 'startup' });
    seed(store, [SECOND]);

    // Act
    await host.emit('session_shutdown', { reason: 'quit' });

    // Assert
    expect(subjects(store.journalDir)[0]).toBe(`journal: ${SECOND.stem} Second.`);
    expect(host.runs.filter((args) => args[0] === 'sync').at(-1)).toEqual(['sync', '--no-pull']);
  });

  test(`should show a push that failed in the footer`, async () => {
    // Arrange
    const store = fixture();
    synced(store, join(store.home, 'missing.git'));
    const host = pi(store);
    await host.emit('session_start', { reason: 'startup' });
    /** The sync at the start fails too, and ends before the second entry is written. */
    await vi.waitFor(() => expect(host.setStatus.mock.calls.length).toBe(1), { timeout: 10_000 });
    seed(store, [SECOND]);

    // Act
    await host.emit('session_shutdown', { reason: 'quit' });

    // Assert
    const [key, text] = host.setStatus.mock.calls.at(-1)!;
    expect(key).toBe('agent-journal');
    expect(text).toMatch(/^journal sync failed: committed 2026-10-11T100000Z · push failed: .+$/);
  });

  test(`should show a sync that the timeout stopped in the footer`, async () => {
    // Arrange
    const store = fixture();
    synced(store);
    const host = pi(store, { stopped: (args) => args[0] === 'sync' });
    await host.emit('session_start', { reason: 'startup' });

    // Act
    await host.emit('session_shutdown', { reason: 'quit' });

    // Assert
    expect(host.setStatus.mock.calls.at(-1)).toEqual(['agent-journal', 'journal sync failed: did not finish']);
  });

  test(`should not sync when sync is off`, async () => {
    // Arrange
    const store = fixture();
    const host = pi(store);
    await host.emit('session_start', { reason: 'startup' });

    // Act
    await host.emit('session_shutdown', { reason: 'quit' });

    // Assert
    expect(host.setStatus.mock.calls.length).toBe(0);
  });
});
