import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { type Entry, fails, fixture, output, rows, run, seed, terminal, worktree } from './helpers.js';

/**
 * A week of entries across three projects, with one written outside a
 * repository so the empty-project case is covered everywhere.
 */
const ENTRIES: Array<Entry> = [
  {
    stem: '2026-08-03T091500Z',
    project: 'nebula',
    summary: 'Moved per-turn context into a data part, which took cache reuse from 62% to 95%.',
    cwd: '~/Developer/nebula',
    body: 'The system prompt changed every turn, so the prefix never matched.',
  },
  {
    stem: '2026-08-05T140000Z',
    project: 'checkout-api',
    summary: 'Made full jitter the default on the retry backoff.',
    cwd: '~/Developer/checkout-api',
    body: 'Equal jitter keeps a floor under the delay, and the floor is what synchronises the wave.',
  },
  {
    stem: '2026-08-07T081000Z',
    summary: 'Summarised an episode into the required JSON shape.',
    cwd: '~/Downloads',
    body: 'No repository, so no project.',
  },
  {
    stem: '2026-08-09T173000Z',
    project: 'checkout-api',
    summary: 'Split the checkout form into two steps.',
    cwd: '~/Developer/checkout-api.worktrees/two-step',
    body: 'The one-page version lost people at the address field.',
  },
];

describe('list', () => {
  test(`should print one line per entry, oldest first`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = rows(run(store, ['list']));

    // Assert
    expect(listed.length).toBe(4);
    expect(listed[0].id).toBe('2026-08-03T091500Z');
    expect(listed[3].id).toBe('2026-08-09T173000Z');
  });

  test(`should list when given no command at all`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = rows(run(store, []));

    // Assert
    expect(listed.length).toBe(4);
  });

  test(`should keep the most recent when limited`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = rows(run(store, ['list', '--limit', '2']));

    // Assert
    expect(listed.length).toBe(2);
    expect(listed[0].id).toBe('2026-08-07T081000Z');
    expect(listed[1].id).toBe('2026-08-09T173000Z');
  });

  test(`should leave the project column empty for an entry written outside a repository`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = run(store, ['list']).split('\n');

    // Assert
    expect(listed[2]).toBe('2026-08-07T081000Z\t\tSummarised an episode into the required JSON shape.');
  });

  test(`should separate the columns with single tabs down a pipe`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = run(store, ['list']).split('\n');

    // Assert
    expect(listed[0]).toBe(
      '2026-08-03T091500Z\tnebula\tMoved per-turn context into a data part, which took cache reuse from 62% to 95%.',
    );
  });

  test(`should turn a tab inside a summary into a space so the columns hold`, () => {
    // Arrange
    const store = fixture();
    seed(store, [{ stem: '2026-08-03T091500Z', project: 'nebula', summary: 'Before\tafter.' }]);

    // Act
    const listed = rows(run(store, ['list']));

    // Assert
    expect(listed.length).toBe(1);
    expect(listed[0].summary).toBe('Before after.');
  });

  test(`should turn a tab inside a project into a space so the columns hold`, () => {
    // Arrange
    const store = fixture();
    seed(store, [{ stem: '2026-08-03T091500Z', project: 'a\tb', summary: 'Written by hand.' }]);

    // Act
    const listed = rows(run(store, ['list']));

    // Assert
    expect(listed.length).toBe(1);
    expect(listed[0].project).toBe('a b');
  });

  test(`should filter by project`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = rows(run(store, ['list', '--project', 'checkout-api']));

    // Assert
    expect(listed.length).toBe(2);
    expect(listed.every((row) => row.project === 'checkout-api')).toBe(true);
  });

  test(`should treat a date as a prefix of the timestamp`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const day = rows(run(store, ['list', '--date', '2026-08-05']));
    const month = rows(run(store, ['list', '--date', '2026-08']));

    // Assert
    expect(day.length).toBe(1);
    expect(day[0].summary).toBe('Made full jitter the default on the retry backoff.');
    expect(month.length).toBe(4);
  });

  test(`should filter a range by day`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = rows(run(store, ['list', '--since', '2026-08-05', '--until', '2026-08-07']));

    // Assert
    expect(listed.length).toBe(2);
    expect(listed[0].id).toBe('2026-08-05T140000Z');
    expect(listed[1].id).toBe('2026-08-07T081000Z');
  });

  test(`should match a directory and everything under it`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = rows(run(store, ['list', '--cwd', '~/Developer/checkout-api']));

    // Assert
    expect(listed.length).toBe(2);
    expect(listed[1].summary).toBe('Split the checkout form into two steps.');
  });

  test(`should read a relative day, on whichever date implementation is here`, () => {
    // Arrange
    const store = fixture();
    const stamp = (daysAgo: number) =>
      new Date(Date.now() - daysAgo * 86_400_000).toISOString().replace(/[:.]/g, '').slice(0, 17);

    seed(store, [
      { stem: `${stamp(30)}Z`, summary: 'A month ago.' },
      { stem: `${stamp(0)}Z`, summary: 'Today.' },
    ]);

    // Act
    const listed = rows(run(store, ['list', '--since', '7d']));

    // Assert
    /**
     * `date` cannot subtract days portably, so this is the case that fails on
     * whichever of BSD and GNU was not the one it was written on.
     */
    expect(listed.length).toBe(1);
    expect(listed[0].summary).toBe('Today.');
  });

  test(`should refuse a date prefix together with a range`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const result = fails(store, ['list', '--date', '2026-08', '--since', '2026-08-05']);

    // Assert
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not both');
  });

  test(`should refuse a day it cannot read`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const result = fails(store, ['list', '--since', 'last tuesday']);

    // Assert
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not a day');
  });

  test(`should say so when the journal is empty, rather than printing nothing`, () => {
    // Arrange
    const store = fixture();
    seed(store, []);

    // Act
    const result = output(store, ['list']);

    // Assert
    /** Advice, not a failure, so it goes to stderr and the exit code stays 0. */
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('no entries yet');
  });

  test(`should stay silent when a filter matched nothing but the journal has entries`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = run(store, ['list', '--date', '2019']);

    // Assert
    expect(listed).toBe('');
  });

  test(`should ignore files that are not entries`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);
    writeFileSync(join(store.journalDir, 'README.md'), '# Journal\n\nNotes about this directory.\n');

    // Act
    const listed = rows(run(store, ['list']));

    // Assert
    expect(listed.length).toBe(4);
  });
});

describe('search', () => {
  test(`should match a summary`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = rows(run(store, ['search', 'jitter']));

    // Assert
    expect(listed.length).toBe(1);
    expect(listed[0].summary).toBe('Made full jitter the default on the retry backoff.');
  });

  test(`should match a body`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = rows(run(store, ['search', 'address field']));

    // Assert
    expect(listed.length).toBe(1);
    expect(listed[0].summary).toBe('Split the checkout form into two steps.');
  });

  test(`should ignore case`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = rows(run(store, ['search', 'JITTER']));

    // Assert
    expect(listed.length).toBe(1);
  });

  test(`should combine a query with a filter`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = rows(run(store, ['search', 'the', '--project', 'checkout-api']));

    // Assert
    expect(listed.length).toBe(2);
  });
});

describe('read', () => {
  test(`should print the newest entry for latest`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const entry = run(store, ['read', 'latest']);

    // Assert
    expect(entry).toContain('date: 2026-08-09T17:30:00Z');
    expect(entry).toContain('The one-page version lost people at the address field.');
  });

  test(`should print one entry by its full name`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const entry = run(store, ['read', '2026-08-03T091500Z']);

    // Assert
    expect(entry).toContain('project: nebula');
  });

  test(`should list the matches rather than guess when a prefix is ambiguous`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const result = fails(store, ['read', '2026-08']);

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('matches 4 entries');
  });

  test(`should show ids that tell apart two matches from the same minute`, () => {
    // Arrange
    const store = fixture();
    seed(store, [
      { stem: '2026-08-03T091512Z', project: 'nebula', summary: 'First.', cwd: '~/Developer/nebula', body: '' },
      { stem: '2026-08-03T091547Z', project: 'nebula', summary: 'Second.', cwd: '~/Developer/nebula', body: '' },
    ]);

    // Act
    const result = fails(store, ['read', '2026-08-03T0915']);

    // Assert
    const listed = rows(result.stderr);
    expect(listed.map((row) => row.id)).toEqual(['2026-08-03T091512Z', '2026-08-03T091547Z']);
  });

  test(`should keep stdout empty when a prefix is ambiguous`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const result = output(store, ['read', '2026-08']);

    // Assert
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
  });

  test(`should lay the matches out for a terminal on stderr when stdout is redirected`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const shown = terminal(store, ['read', '2026-08'], { stdoutTo: '/dev/null', env: { NO_COLOR: '1' } });

    // Assert
    expect(shown.split('\n')[1]).toBe(
      '2026-08-03T091500Z  nebula        Moved per-turn context into a data part, which took cache reuse from 62% to 95%.',
    );
  });

  test(`should fail when nothing matches`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const result = fails(store, ['read', '2019-01-01']);

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no entry matches');
  });
});

describe('the bare form', () => {
  test(`should take a filter with no command in front of it`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = rows(run(store, ['--project', 'checkout-api']));

    // Assert
    expect(listed.length).toBe(2);
  });

  test(`should explain itself on stdout when asked`, () => {
    // Arrange
    const store = fixture();

    // Act
    const asked = run(store, ['help']);
    const flag = run(store, ['--help']);

    // Assert
    expect(asked).toContain('usage: agent-journal');
    expect(flag).toBe(asked);
  });

  test(`should explain itself on stderr and fail when it was a mistake`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = fails(store, ['nonsense']);

    // Assert
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: agent-journal');
  });
});

describe('the current project', () => {
  /**
   * The fixture repository is named `repo`, so that is what the session-start
   * hook files its entries under, from the main checkout and every worktree.
   */
  const REPO_ENTRIES: Array<Entry> = [
    { stem: '2026-08-03T091500Z', project: 'repo', summary: 'From the main checkout.', cwd: '~/repo' },
    { stem: '2026-08-05T140000Z', project: 'nebula', summary: 'Another project.', cwd: '~/nebula' },
    { stem: '2026-08-07T081000Z', project: 'repo', summary: 'From a worktree.', cwd: '~/wt-feature' },
  ];

  test(`should list every entry of the repository from inside a worktree`, () => {
    // Arrange
    const store = fixture();
    const tree = worktree(store, 'wt-feature');
    seed(store, REPO_ENTRIES);

    // Act
    const listed = rows(run(store, ['list', '--project', '.'], { at: tree }));

    // Assert
    expect(listed.map((row) => row.summary)).toEqual(['From the main checkout.', 'From a worktree.']);
  });

  test(`should resolve the same project for search`, () => {
    // Arrange
    const store = fixture();
    const tree = worktree(store, 'wt-feature');
    seed(store, REPO_ENTRIES);

    // Act
    const listed = rows(run(store, ['search', 'from', '--project', '.'], { at: tree }));

    // Assert
    expect(listed.map((row) => row.summary)).toEqual(['From the main checkout.', 'From a worktree.']);
  });

  test(`should still narrow by directory when given a cwd as well`, () => {
    // Arrange
    const store = fixture();
    seed(store, REPO_ENTRIES);

    // Act
    const listed = rows(run(store, ['list', '--project', '.', '--cwd', '~/wt-feature'], { at: store.repo }));

    // Assert
    expect(listed.map((row) => row.summary)).toEqual(['From a worktree.']);
  });

  test(`should fail outside a repository rather than list everything`, () => {
    // Arrange
    const store = fixture();
    seed(store, REPO_ENTRIES);

    // Act
    const result = fails(store, ['list', '--project', '.'], { at: store.home });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not in a repository');
  });

  test(`should leave a command that takes no project alone`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = output(store, ['config', '--project', '.'], { at: store.home });

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('journal_dir=');
  });
});

describe('in a terminal', () => {
  test(`should align the columns with the project padded to the widest name`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const shown = terminal(store, ['list'], { env: { NO_COLOR: '1' } }).split('\n');

    // Assert
    expect(shown[0]).toBe(
      '2026-08-03T091500Z  nebula        Moved per-turn context into a data part, which took cache reuse from 62% to 95%.',
    );
    expect(shown[2]).toBe('2026-08-07T081000Z                Summarised an episode into the required JSON shape.');
  });

  test(`should cut a summary to the width of the terminal`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const shown = terminal(store, ['list'], { cols: 60, env: { NO_COLOR: '1' } }).split('\n');

    // Assert
    expect(shown[0]).toBe('2026-08-03T091500Z  nebula        Moved per-turn context …');
  });

  test(`should prefer an exported COLUMNS to the size of the terminal`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const shown = terminal(store, ['list'], { cols: 200, env: { NO_COLOR: '1', COLUMNS: '60' } }).split('\n');

    // Assert
    expect(shown[0]).toBe('2026-08-03T091500Z  nebula        Moved per-turn context …');
  });

  test(`should colour the id and the project unless NO_COLOR is set`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const shown = terminal(store, ['list']).split('\n');

    // Assert
    expect(shown[0]).toBe(
      '\x1b[2m2026-08-03T091500Z\x1b[0m  \x1b[36mnebula      \x1b[0m  Moved per-turn context into a data part, which took cache reuse from 62% to 95%.',
    );
  });
});
