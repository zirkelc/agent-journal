import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { type Entry, fails, fixture, output, rows, run, seed } from './helpers.js';

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
    expect(listed[0].when).toBe('2026-08-03 09:15');
    expect(listed[3].when).toBe('2026-08-09 17:30');
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
    expect(listed[0].when).toBe('2026-08-07 08:10');
    expect(listed[1].when).toBe('2026-08-09 17:30');
  });

  test(`should leave the project column empty for an entry written outside a repository`, () => {
    // Arrange
    const store = fixture();
    seed(store, ENTRIES);

    // Act
    const listed = rows(run(store, ['list']));

    // Assert
    expect(listed[2].project).toBe('');
    expect(listed[2].summary).toBe('Summarised an episode into the required JSON shape.');
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
    expect(listed[0].when).toBe('2026-08-05 14:00');
    expect(listed[1].when).toBe('2026-08-07 08:10');
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
      { stem: `${stamp(30).slice(0, 15)}Z`, summary: 'A month ago.' },
      { stem: `${stamp(0).slice(0, 15)}Z`, summary: 'Today.' },
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
