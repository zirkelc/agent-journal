import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { configure, context, fields, fixture, run, tilde } from './helpers.ts';

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
    expect(result).toContain(`grep '^summary:' ${store.journalDir}/2026-01-*.md`);
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
    rmSync(join(store.root, 'INSTRUCTIONS.md'));

    // Act
    const result = context(store);

    // Assert
    expect(result).toBe(``);
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
    writeFileSync(join(store.repo, 'seed.txt'), 'seed\n');
    const git = (...args: Array<string>) =>
      execFileSync('git', ['-C', store.repo, ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'test',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'test',
          GIT_COMMITTER_EMAIL: 'test@example.com',
        },
      });
    git('add', '-A');
    git('commit', '-qm', 'seed');
    const tree = join(store.home, 'wt-feature');
    git('worktree', 'add', '-q', '-b', 'feature', tree);

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
  test(`should record which agent and model the session is`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = fields(run(store, ['context', '--cwd', store.repo, '--agent', 'claude/opus-5']));

    // Assert
    expect(result.agent).toBe('claude/opus-5');
  });

  test(`should take the whole line out when no agent is given`, () => {
    // Arrange
    const store = fixture();

    // Act
    const rendered = run(store, ['context', '--cwd', store.repo]);

    // Assert
    /** A label with nothing after it would read as a field the model must invent. */
    expect(fields(rendered).agent).toBe(undefined);
    expect(rendered).not.toContain('agent:');
  });
});
