import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  baseEnv,
  configure,
  context,
  type Fixture,
  fields,
  fixture,
  frontmatter,
  GIT_IDENTITY,
  run,
  tilde,
  worktree,
} from './helpers.ts';

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
    const rules = context(store, { sessionId: 'abc-123', extra: ['--tools', 'agent_journal_'] });

    // Assert
    expect(rules).toContain('`agent_journal_write` tool');
    expect(rules).toContain('- `agent_journal_list` lists entries');
    expect(rules).not.toContain('date -u');
    expect(rules).not.toContain('grep');
    expect(rules).not.toContain('<!--');
    expect(rules).not.toContain('__TOOLS__');
  });

  test(`should list the branch and the commit of the session after the project`, () => {
    // Arrange
    const store = fixture();
    const tree = worktree(store, 'fix-auth');
    const head = execFileSync('git', ['-C', tree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

    // Act
    const result = context(store, { cwd: tree });

    // Assert
    expect(result).toContain(
      `- \`project\`: \`repo\`\n- \`branch\`: \`fix-auth\`\n- \`commit\`: \`${head}\`\n- \`cwd\`:`,
    );
  });

  test(`should drop the commit line before the first commit`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = context(store);

    // Assert
    expect(result).toMatch(/^- `branch`: `.+`$/m);
    expect(result).not.toMatch(/^- `commit`: `/m);
  });

  test(`should give both variants the values of the current session, and point to them from writing and recalling`, () => {
    // Arrange
    const store = fixture();
    const session = { sessionId: 'abc-123' };
    const agent = ['--agent', 'claude/claude-opus-5-5'];

    // Act
    const tools = context(store, { ...session, extra: ['--tools', 'agent_journal_', ...agent] });
    const files = context(store, { ...session, extra: agent });

    // Assert
    for (const rules of [tools, files]) {
      const section = rules.slice(rules.indexOf('### Current session'));
      expect(rules.indexOf('### Current session')).toBeLessThan(rules.indexOf('### Writing an entry'));
      expect(section).toMatch(/^- `cwd`: `~[^`]*`$/m);
      expect(section).toMatch(/^- `host`: `.+`$/m);
      expect(section).toMatch(/^- `user`: `.+`$/m);
      expect(section).toContain('- `agent`: `claude/claude-opus-5-5`');
      expect(section).toContain('- `session_id`: `abc-123`');
    }
    expect(tools).toContain(
      'the project, the branch, the commit, the directory, the host, the user, the agent and the session id',
    );
    expect(tools).toContain('give its value from Current session as the filter');
    expect(files).toContain('Copy each value exactly as it is listed there, character for character');
    expect(files).toContain('search the frontmatter for its value from Current session');
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
    const tools = context(store, { env, extra: ['--tools', 'agent_journal_'] });

    // Assert
    expect(plain).toContain(`utc_yesterday_since=2026-10-04T22:00:00Z\nutc_yesterday_until=2026-10-05T21:59:59Z\n`);
    expect(tools).not.toContain('utc_yesterday_since');
  });

  test(`should keep the rules both variants share`, () => {
    // Arrange
    const store = fixture();

    // Act
    const plain = context(store, { sessionId: 'abc-123' });
    const tools = context(store, { sessionId: 'abc-123', extra: ['--tools', 'agent_journal_'] });

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
    const tools = context(store, { extra: ['--tools', 'agent_journal_'] });

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

describe('the command that reads the repository for an entry file', () => {
  // The lines the rules without tools tell the model to run, as the rendered text gives them.
  function command(store: Fixture): string {
    const rules = context(store);
    const block = /Run these lines as one command[^\n]*\n\n((?: {4}.*\n)+)/.exec(rules)?.[1] ?? '';
    return block.replace(/^ {4}/gm, '');
  }

  // The output read as the rules say: each git line found by its start, so a missing line moves no other.
  function readAsTheRulesSay(output: string): Record<string, string | undefined> {
    const lines = output.split('\n');
    const gitDir = lines.find((line) => line.startsWith('/'));
    const parts = gitDir?.split('/') ?? [];
    const name = parts.at(-1) === '.git' ? parts.at(-2) : parts.at(-1);
    return {
      project: name?.replace(/\.git$/, ''),
      branch: lines.find((line) => line.startsWith('refs/heads/'))?.slice('refs/heads/'.length),
      commit: lines.find((line) => line.startsWith('commit '))?.slice('commit '.length),
    };
  }

  // What the CLI records for the same directory, the reference for an entry written as a file.
  function recorded(store: Fixture, dir: string): Record<string, string | undefined> {
    run(store, ['write', '--summary', 'The reference.', '--cwd', dir]);
    const [name] = readdirSync(store.journalDir);
    const entry = frontmatter(readFileSync(join(store.journalDir, name!), 'utf8'));
    rmSync(join(store.journalDir, name!));
    return { project: entry.project, branch: entry.branch, commit: entry.commit };
  }

  // Throws on a status that is not 0, which an agent reports as a failed command.
  function runIn(store: Fixture, dir: string): string {
    return execFileSync('sh', ['-c', command(store)], { cwd: dir, encoding: 'utf8', env: baseEnv(store) });
  }

  const git = (dir: string, ...args: Array<string>) =>
    execFileSync('git', ['-C', dir, ...args], { env: { ...process.env, ...GIT_IDENTITY } });

  test(`should use no command substitution, which a permission check refuses`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = command(store);

    // Assert
    expect(result.split('\n').filter(Boolean).length).toBe(4);
    expect(result).not.toContain('$(');
    expect(result).not.toContain('`');
  });

  test.each([
    ['a worktree on a branch', (store: Fixture) => worktree(store, 'fix-auth')],
    [
      'a detached HEAD',
      (store: Fixture) => {
        const tree = worktree(store, 'fix-auth');
        git(tree, 'checkout', '-q', '--detach');
        return tree;
      },
    ],
    ['a repository before its first commit', (store: Fixture) => store.repo],
    [
      'a branch that a tag of the same name shares',
      (store: Fixture) => {
        const tree = worktree(store, 'v1');
        git(tree, 'tag', 'v1');
        return tree;
      },
    ],
    [
      'a folder outside a repository',
      (store: Fixture) => {
        const folder = join(store.home, 'plain');
        mkdirSync(folder);
        return folder;
      },
    ],
  ])(`should give the values the CLI records, in %s`, (_, setUp) => {
    // Arrange
    const store = fixture();
    const dir = setUp(store);

    // Act
    const result = readAsTheRulesSay(runIn(store, dir));

    // Assert
    expect(result).toEqual(recorded(store, dir));
  });
});
