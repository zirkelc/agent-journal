import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { configure, context, fields, fixture, run, tilde, worktree } from './helpers.ts';

describe('the rules', () => {
  test(`should frame the rules as a standing instruction rather than as background`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = context(store);

    // Assert
    expect(result.startsWith(`The following is a standing instruction`)).toBe(true);
  });

  test(`should strip the editing note the template carries for its human readers`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = context(store);

    // Assert
    expect(result).not.toContain(`<!--`);
    expect(result).not.toContain(`Edit this file to change the rules`);
  });

  /**
   * The recall commands are only useful if they can be run as written, which
   * means no placeholder may survive into the injected text.
   */
  test(`should resolve every placeholder to the journal directory`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = context(store);

    // Assert
    expect(result).not.toMatch(/__[A-Z][A-Z_]*__/);
    expect(result).toContain(`${store.journalDir}/YYYY-MM-DDTHHMMSSZ.md`);
    expect(result).toContain(`    cd ${store.journalDir}\n`);
  });

  test(`should name the configured directory rather than the default`, () => {
    // Arrange
    const store = fixture();
    const target = join(store.home, 'notes', 'journal');
    configure(store, ['set', 'journal_dir', target]);

    // Act
    const result = context(store);

    // Assert
    expect(result).toContain(`${target}/YYYY-MM-DDTHHMMSSZ.md`);
    expect(result).not.toContain(store.journalDir);
  });

  test(`should print nothing when the instructions are missing`, () => {
    // Arrange
    const store = fixture();
    rmSync(join(store.root, 'templates', 'INSTRUCTIONS.md'));

    // Act
    const result = context(store);

    // Assert
    expect(result).toBe(``);
  });
});

describe('the variant with tools', () => {
  test(`should name the tools with the prefix, and leave out the file and the commands`, () => {
    // Arrange
    const store = fixture();

    // Act
    const rules = context(store, { sessionId: 'abc-123', extra: ['--tools', 'journal_'] });

    // Assert
    expect(rules).toContain('`journal_write` tool');
    expect(rules).toContain('- `journal_list` lists entries');
    expect(rules).not.toContain('date -u');
    expect(rules).not.toContain('grep');
    expect(rules).not.toContain('### Current session');
    expect(rules).not.toContain('<!--');
    expect(rules).not.toContain('__TOOLS__');
  });

  test(`should leave the tools out of the plain variant`, () => {
    // Arrange
    const store = fixture();

    // Act
    const rules = context(store);

    // Assert
    expect(rules).not.toContain('__TOOLS__');
    expect(rules).not.toContain('write` tool. It takes');
    expect(rules).not.toContain('<!--');
    expect(rules).toContain('date -u +%Y-%m-%dT%H:%M:%SZ');
  });

  /**
   * Entry names are UTC, and a day the user names is local, so a model that
   * reads the files needs the UTC bounds of the local days. The tools work
   * them out themselves.
   */
  test(`should give the clock to the plain variant and not to the one with tools`, () => {
    // Arrange
    const store = fixture();
    const env = { AGENT_JOURNAL_NOW: String(Date.parse('2026-10-06T14:15:27Z') / 1_000), TZ: 'Europe/Berlin' };

    // Act
    const plain = context(store, { env });
    const tools = context(store, { env, extra: ['--tools', 'journal_'] });

    // Assert
    expect(plain).toContain(`utc_yesterday_since=2026-10-04T22:00:00Z\nutc_yesterday_until=2026-10-05T21:59:59Z\n`);
    expect(tools).not.toContain('utc_yesterday_since');
  });

  test(`should keep the rules both variants share`, () => {
    // Arrange
    const store = fixture();

    // Act
    const plain = context(store, { sessionId: 'abc-123' });
    const tools = context(store, { sessionId: 'abc-123', extra: ['--tools', 'journal_'] });

    // Assert
    for (const shared of [
      'The following is a standing instruction',
      '### When to write',
      '### When NOT to write',
      'Never write an entry about the entry',
      'The body is the detail the summary had to leave out',
      'Never record a secret',
      'Read the journal when the user asks about past work',
    ]) {
      expect(plain).toContain(shared);
      expect(tools).toContain(shared);
    }
  });

  test(`should not leave two blank lines in a row where a block was`, () => {
    // Arrange
    const store = fixture();

    // Act
    const plain = context(store);
    const tools = context(store, { extra: ['--tools', 'journal_'] });

    // Assert
    expect(plain.includes('\n\n\n')).toBe(false);
    expect(tools.includes('\n\n\n')).toBe(false);
  });
});

describe('this session', () => {
  test(`should name the project after the repository`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = fields(context(store));

    // Assert
    expect(result[`project`]).toBe(`repo`);
    expect(result[`cwd`]).toBe(tilde(store, store.repo));
  });

  test(`should resolve the same project from a subdirectory`, () => {
    // Arrange
    const store = fixture();
    const nested = join(store.repo, 'packages', 'core');
    mkdirSync(nested, { recursive: true });

    // Act
    const result = fields(context(store, { cwd: nested }));

    // Assert
    expect(result[`project`]).toBe(`repo`);
    expect(result[`cwd`]).toBe(tilde(store, nested));
  });

  /**
   * A worktree's own root is named after its branch, so resolving identity from
   * the working tree would file one repository under a project per branch.
   */
  test(`should keep the repository name inside a worktree`, () => {
    // Arrange
    const store = fixture();
    const tree = worktree(store, 'wt-feature');

    // Act
    const result = fields(context(store, { cwd: tree }));

    // Assert
    expect(result[`project`]).toBe(`repo`);
    expect(result[`cwd`]).toBe(tilde(store, tree));
  });

  /**
   * A bare directory is not a project, and filing one as `Downloads` would
   * dilute the only field whose job is grouping. `cwd` still records it.
   */
  test(`should omit the project outside a repository`, () => {
    // Arrange
    const store = fixture();
    const loose = join(store.home, 'scratch');
    mkdirSync(loose, { recursive: true });

    // Act
    const result = fields(context(store, { cwd: loose }));

    // Assert
    expect(result[`project`]).toBe(undefined);
    expect(result[`cwd`]).toBe(tilde(store, loose));
  });

  /** Entries record `cwd` in the readable form, as every existing entry does. */
  test(`should abbreviate the working directory against home`, () => {
    // Arrange
    const store = fixture();
    const inside = join(store.home, 'Developer', 'thing');
    mkdirSync(inside, { recursive: true });

    // Act
    const result = fields(context(store, { cwd: inside, env: { HOME: store.home } }));

    // Assert
    expect(result[`cwd`]).toBe(`~/Developer/thing`);
  });

  /** The path lands in frontmatter, and one that reads `.` records nothing. */
  test(`should absolutise a relative working directory`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = fields(run(store, ['context', '--cwd', '.'], { at: store.repo }));

    // Assert
    expect(result[`cwd`]).toBe(tilde(store, store.repo));
  });

  test(`should pass the session id through`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = fields(context(store, { sessionId: 'abc-123' }));

    // Assert
    expect(result[`session_id`]).toBe(`abc-123`);
  });

  /** An agent with no session id must not produce an entry claiming one. */
  test(`should omit the session id when the adapter gives none`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = context(store, { sessionId: '' });

    // Assert
    expect(fields(result).session_id).toBe(undefined);
    expect(fields(result).project).toBe(`repo`);
  });
});

describe('the agent', () => {
  test(`should record which agent and model the session is, with the model's API id`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = fields(run(store, ['context', '--cwd', store.repo, '--agent', 'claude/claude-opus-5[1m]']));

    // Assert
    expect(result.agent).toBe('claude/claude-opus-5');
  });

  test(`should take the whole line out when no agent is given`, () => {
    // Arrange
    const store = fixture();

    // Act
    const rendered = run(store, ['context', '--cwd', store.repo]);

    // Assert
    /** A label with nothing after it would read as a field the model must invent. */
    expect(fields(rendered).agent).toBe(undefined);
    expect(rendered).not.toContain('- `agent`: `');
  });
});

describe('the machine and the account', () => {
  test(`should give the host and the user that are set`, () => {
    // Arrange
    const store = fixture();
    configure(store, ['set', 'host', 'cookiebox']);
    configure(store, ['set', 'user', 'agent']);

    // Act
    const result = fields(context(store));

    // Assert
    expect(result.host).toBe('cookiebox');
    expect(result.user).toBe('agent');
  });

  test(`should take the whole line out when a name is set to none`, () => {
    // Arrange
    const store = fixture();
    configure(store, ['set', 'host', '']);
    configure(store, ['set', 'user', '']);

    // Act
    const rendered = context(store);

    // Assert
    expect(fields(rendered).host).toBe(undefined);
    expect(fields(rendered).user).toBe(undefined);
    expect(rendered).not.toContain('- `host`: `');
    expect(rendered).not.toContain('- `user`: `');
  });
});
