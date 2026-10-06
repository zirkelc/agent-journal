import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { type Entry, type Fixture, fails, fixture, output, rows, run, seed, terminal, worktree } from './helpers.js';

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

  test(`should list an entry saved with CRLF line endings`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);
    writeFileSync(
      join(store.journalDir, '2026-08-10T120000Z.md'),
      ['---', 'date: 2026-08-10T12:00:00Z', 'project: nebula', 'summary: "Saved on Windows."', '---', '', 'A CRLF body.', ''].join('\r\n'),
    );

    // Act
    const listed = rows(run(store, ['list', '--project', 'nebula']));
    const found = rows(run(store, ['search', 'crlf body']));

    // Assert
    expect(listed.map((row) => row.summary)).toEqual([
      'Moved per-turn context into a data part, which took cache reuse from 62% to 95%.',
      'Saved on Windows.',
    ]);
    expect(found.map((row) => row.id)).toEqual(['2026-08-10T120000Z']);
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

  test(`should count only the matches it can list`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);
    writeFileSync(join(store.journalDir, '2026-08-03T120000Z.md'), 'No frontmatter here.\n');
    writeFileSync(join(store.journalDir, '2026-08-03T130000Z.md'), '---\nproject: nebula\nsummary: "Later."\n---\n');

    // Act
    const result = fails(store, ['read', '2026-08-03']);

    // Assert
    expect(result.stderr).toContain('matches 2 entries');
    expect(rows(result.stderr).map((row) => row.id)).toEqual(['2026-08-03T091500Z', '2026-08-03T130000Z']);
  });

  test(`should not print a file that is not an entry`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);
    writeFileSync(join(store.journalDir, 'README.md'), '# Journal\n');
    writeFileSync(join(store.journalDir, '2026-08-11T120000Z.md'), 'No frontmatter here.\n');

    // Act
    const readme = fails(store, ['read', 'README']);
    const bare = fails(store, ['read', '2026-08-11']);

    // Assert
    expect(readme.stderr).toContain('no entry matches');
    expect(bare.stderr).toContain('no entry matches');
  });

  test(`should skip a newer file that is not an entry for latest`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);
    writeFileSync(join(store.journalDir, '2026-08-11T120000Z.md'), 'No frontmatter here.\n');

    // Act
    const entry = run(store, ['read', 'latest']);

    // Assert
    expect(entry).toContain('date: 2026-08-09T17:30:00Z');
  });

  test(`should read an entry saved with CRLF line endings`, () => {
    // Arrange
    const store = fixture();
    seed(store, []);
    writeFileSync(
      join(store.journalDir, '2026-08-10T120000Z.md'),
      ['---', 'summary: "Saved on Windows."', '---', ''].join('\r\n'),
    );

    // Act
    const entry = run(store, ['read', '2026-08-10']);

    // Assert
    expect(entry).toContain('Saved on Windows.');
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

/**
 * The complete output, byte for byte, so a change to how entries are found and
 * read cannot change what is printed. Each case combines a filter with a limit,
 * because the limit has to apply to the matches, not to the files.
 */
describe('the exact output', () => {
  test(`should print every entry down a pipe`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = run(store, ['list']);

    // Assert
    expect(listed).toBe(
      [
        '2026-08-03T091500Z\tnebula\tMoved per-turn context into a data part, which took cache reuse from 62% to 95%.',
        '2026-08-05T140000Z\tcheckout-api\tMade full jitter the default on the retry backoff.',
        '2026-08-07T081000Z\t\tSummarised an episode into the required JSON shape.',
        '2026-08-09T173000Z\tcheckout-api\tSplit the checkout form into two steps.',
        '',
      ].join('\n'),
    );
  });

  test(`should keep the most recent matches of a filter, not of all entries`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = run(store, ['list', '--project', 'nebula', '--limit', '1']);

    // Assert
    expect(listed).toBe(
      '2026-08-03T091500Z\tnebula\tMoved per-turn context into a data part, which took cache reuse from 62% to 95%.\n',
    );
  });

  test(`should keep the most recent matches of a search, in order`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = run(store, ['search', 'the', '--limit', '2']);

    // Assert
    expect(listed).toBe(
      [
        '2026-08-07T081000Z\t\tSummarised an episode into the required JSON shape.',
        '2026-08-09T173000Z\tcheckout-api\tSplit the checkout form into two steps.',
        '',
      ].join('\n'),
    );
  });

  test(`should apply a range before the limit`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = run(store, ['list', '--until', '2026-08-06', '--limit', '1']);

    // Assert
    expect(listed).toBe('2026-08-05T140000Z\tcheckout-api\tMade full jitter the default on the retry backoff.\n');
  });

  test(`should align the printed entries to the widest project among them`, () => {
    // Arrange
    const store = fixture();
    /** Older than the limit reaches, so its long name must not widen the column. */
    seed(store, [{ stem: '2026-08-01T080000Z', project: 'a-much-longer-project-name', summary: 'Out of reach.' }, ...ENTRIES]);

    // Act
    const shown = terminal(store, ['list', '--limit', '3'], { env: { NO_COLOR: '1' } });

    // Assert
    expect(shown).toBe(
      [
        '2026-08-05T140000Z  checkout-api  Made full jitter the default on the retry backoff.',
        '2026-08-07T081000Z                Summarised an episode into the required JSON shape.',
        '2026-08-09T173000Z  checkout-api  Split the checkout form into two steps.',
        '',
      ].join('\n'),
    );
  });

});

describe('files that are not entries it can read', () => {
  /** awk cannot read a directory and stops, on BSD and on mawk alike. */
  test(`should name a directory that is named like an entry and list the rest`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);
    const folder = join(store.journalDir, '2026-08-04T000000Z.md');
    mkdirSync(folder);

    // Act
    const result = output(store, ['list']);

    // Assert
    expect(result.status).toBe(0);
    expect(rows(result.stdout).length).toBe(4);
    expect(result.stderr).toContain(`${folder} is a directory, not an entry`);
  });

  /** Root reads any file whatever its mode, so the case cannot be made there. */
  test.skipIf(process.getuid?.() === 0)(`should warn about an entry it cannot read and list the rest`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);
    const locked = join(store.journalDir, '2026-08-04T000000Z.md');
    writeFileSync(locked, '---\nsummary: "Locked."\n---\n');
    chmodSync(locked, 0o000);

    // Act
    const result = output(store, ['list']);

    // Assert
    expect(result.status).toBe(0);
    expect(rows(result.stdout).length).toBe(4);
    expect(result.stderr).toContain('cannot read');
    expect(result.stderr).toContain('2026-08-04T000000Z.md');
  });

  test(`should match a search across line breaks in the body`, () => {
    // Arrange
    const store = fixture();
    seed(store, [
      { stem: '2026-08-03T091500Z', project: 'nebula', summary: 'Short lines.', body: 'one\ntwo\nthree\nfour' },
      { stem: '2026-08-04T091500Z', project: 'nebula', summary: 'Other.', body: 'one two four' },
    ]);

    // Act
    const listed = rows(run(store, ['search', 'one two three four']));

    // Assert
    expect(listed.map((row) => row.summary)).toEqual(['Short lines.']);
  });
});

/**
 * Days are the user's local days. In Berlin in August a day starts at 22:00
 * UTC the evening before, so each entry sits one second either side of a local
 * midnight.
 */
describe('local days', () => {
  const BERLIN: Array<Entry> = [
    { stem: '2026-07-31T215959Z', summary: 'July, last second.' },
    { stem: '2026-07-31T220000Z', summary: 'August, first second.' },
    { stem: '2026-08-04T215959Z', summary: 'The 4th, last second.' },
    { stem: '2026-08-04T220000Z', summary: 'The 5th, first second.' },
    { stem: '2026-08-05T215959Z', summary: 'The 5th, last second.' },
    { stem: '2026-08-05T220000Z', summary: 'The 6th, first second.' },
  ];

  function summaries(store: Fixture, args: Array<string>, env: Record<string, string> = {}): Array<string> {
    return rows(run(store, ['list', '--all', ...args], { env: { TZ: 'Europe/Berlin', ...env } })).map(
      (row) => row.summary,
    );
  }

  test(`should start --since at local midnight`, () => {
    // Arrange
    const store = fixture();
    seed(store, BERLIN);

    // Act
    const listed = summaries(store, ['--since', '2026-08-05']);

    // Assert
    expect(listed).toEqual(['The 5th, first second.', 'The 5th, last second.', 'The 6th, first second.']);
  });

  test(`should end --until at the last second of the local day`, () => {
    // Arrange
    const store = fixture();
    seed(store, BERLIN);

    // Act
    const listed = summaries(store, ['--until', '2026-08-04']);

    // Assert
    expect(listed).toEqual(['July, last second.', 'August, first second.', 'The 4th, last second.']);
  });

  test(`should take a local day for --date`, () => {
    // Arrange
    const store = fixture();
    seed(store, BERLIN);

    // Act
    const listed = summaries(store, ['--date', '2026-08-05']);

    // Assert
    expect(listed).toEqual(['The 5th, first second.', 'The 5th, last second.']);
  });

  test(`should take a local month and a local year for --date`, () => {
    // Arrange
    const store = fixture();
    seed(store, BERLIN);

    // Act
    const month = summaries(store, ['--date', '2026-08']);
    const july = summaries(store, ['--date', '2026-07']);
    const year = summaries(store, ['--date', '2026']);

    // Assert
    expect(month.length).toBe(5);
    expect(july).toEqual(['July, last second.']);
    expect(year.length).toBe(6);
  });

  test(`should read today from the local clock`, () => {
    // Arrange
    const store = fixture();
    seed(store, BERLIN);
    /** 01:30 on the 6th in Berlin, still the 5th in UTC. */
    const now = { AGENT_JOURNAL_NOW: String(Date.parse('2026-08-05T23:30:00Z') / 1_000) };

    // Act
    const today = summaries(store, ['--since', 'today'], now);
    const yesterday = summaries(store, ['--since', '1d', '--until', '1d'], now);

    // Assert
    expect(today).toEqual(['The 6th, first second.']);
    expect(yesterday).toEqual(['The 5th, first second.', 'The 5th, last second.']);
  });

  test(`should refuse a --date with a time and point to read`, () => {
    // Arrange
    const store = fixture();
    seed(store, BERLIN);

    // Act
    const result = fails(store, ['list', '--date', '2026-08-05T22']);

    // Assert
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('agent-journal read');
  });

  test(`should refuse a day that is not a date`, () => {
    // Arrange
    const store = fixture();
    seed(store, BERLIN);

    // Act
    const month = fails(store, ['list', '--since', '2026-13-01']);
    const february = fails(store, ['list', '--date', '2026-02-29']);
    const april = fails(store, ['list', '--until', '2026-04-31']);

    // Assert
    expect(month.status).toBe(2);
    expect(february.status).toBe(2);
    expect(april.status).toBe(2);
  });

  test(`should take the 29th of February in a leap year`, () => {
    // Arrange
    const store = fixture();
    seed(store, [{ stem: '2028-02-29T120000Z', summary: 'Leap day.' }]);

    // Act
    const listed = summaries(store, ['--date', '2028-02-29']);

    // Assert
    expect(listed).toEqual(['Leap day.']);
  });

  /** A leading zero would read as octal in shell arithmetic, where 08 and 09 do not exist. */
  test(`should take the 8th and the 9th of a month`, () => {
    // Arrange
    const store = fixture();
    seed(store, [
      { stem: '2026-08-08T120000Z', summary: 'The 8th.' },
      { stem: '2026-09-09T120000Z', summary: 'The 9th.' },
    ]);

    // Act
    const since = summaries(store, ['--since', '2026-08-08', '--until', '2026-09-09']);
    const day = summaries(store, ['--date', '2026-09-09']);
    const month = summaries(store, ['--date', '2026-09']);

    // Assert
    expect(since).toEqual(['The 8th.', 'The 9th.']);
    expect(day).toEqual(['The 9th.']);
    expect(month).toEqual(['The 9th.']);
  });

  test(`should count days with a leading zero in decimal`, () => {
    // Arrange
    const store = fixture();
    seed(store, BERLIN);
    const now = { AGENT_JOURNAL_NOW: String(Date.parse('2026-08-13T12:00:00Z') / 1_000) };

    // Act
    const eight = summaries(store, ['--since', '08d'], now);
    const ten = summaries(store, ['--since', '010d'], now);

    // Assert
    expect(eight).toEqual(['The 5th, first second.', 'The 5th, last second.', 'The 6th, first second.']);
    expect(ten).toEqual(summaries(store, ['--since', '10d'], now));
  });

  test(`should take a day before any entry as no limit`, () => {
    // Arrange
    const store = fixture();
    seed(store, BERLIN);

    // Act
    const far = summaries(store, ['--since', '30000d']);
    const before = summaries(store, ['--since', '1969-12-31']);

    // Assert
    expect(far.length).toBe(6);
    expect(before.length).toBe(6);
  });

  /**
   * Havana moves its clocks from 00:00 to 01:00 on 8 March 2026, so that day
   * has no midnight and starts at 01:00. GNU date refuses the missing time,
   * BSD date moves it forward.
   */
  test(`should start a day that has no midnight at its first local time`, () => {
    // Arrange
    const store = fixture();
    seed(store, [
      { stem: '2026-03-08T045959Z', summary: 'The 7th, last second.' },
      { stem: '2026-03-08T050000Z', summary: 'The 8th, first second.' },
    ]);

    // Act
    const listed = summaries(store, ['--date', '2026-03-08'], { TZ: 'America/Havana' });

    // Assert
    expect(listed).toEqual(['The 8th, first second.']);
  });
});

