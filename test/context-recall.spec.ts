import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { fields, fixture, output, recall, run, tilde, type Fixture } from './helpers.ts';

/**
 * Tuesday 2026-10-06 16:15:27 in Berlin. The locale's language `zz` is installed
 * nowhere, so the week start comes from the region in the name, as it does in
 * the time tests.
 */
const NOW = String(Date.parse('2026-10-06T14:15:27Z') / 1_000);

function recallAt(store: Fixture, locale = 'zz_DE.UTF-8'): string {
  return recall(store, { env: { AGENT_JOURNAL_NOW: NOW, TZ: 'Europe/Berlin', LC_ALL: locale } });
}

describe('context --recall', () => {
  test(`should tell a reader about entries and nothing about writing them`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = recallAt(store);

    // Assert
    expect(result.startsWith(`## Journal`)).toBe(true);
    expect(result).toContain(`Never write, edit or delete an entry.`);
    expect(result).not.toContain(`standing instruction`);
    expect(result).not.toContain(`### Writing an entry`);
  });

  test(`should strip the editing note the template carries for its human readers`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = recallAt(store);

    // Assert
    expect(result).not.toContain(`<!--`);
  });

  test(`should resolve every placeholder`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = recallAt(store);

    // Assert
    expect(result).not.toMatch(/__[A-Z][A-Z_]*__/);
    expect(result).toContain(`Entries are in \`${store.journalDir}\``);
  });

  test(`should give the clock and the calendar of one instant`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = recallAt(store);

    // Assert
    expect(result).toContain(`local_now=2026-10-06T16:15:27+02:00\n`);
    expect(result).toContain(`local_weekday=Tuesday\n`);
    expect(result).toContain(`utc_now=2026-10-06T14:15:27Z\n`);
    expect(result).toContain(`local_last_week=2026-09-28T00:00:00+02:00 2026-10-04T23:59:59+02:00\n`);
  });

  /** The reader is told to pass a range as it is, so the filters must take it. */
  test(`should give ranges the filters take as they are`, () => {
    // Arrange
    const store = fixture();
    const env = { AGENT_JOURNAL_NOW: NOW, TZ: 'Europe/Berlin', LC_ALL: 'zz_DE.UTF-8' };
    mkdirSync(store.journalDir, { recursive: true });
    writeFileSync(
      join(store.journalDir, '2026-09-30T100000Z.md'),
      '---\ndate: 2026-09-30T10:00:00Z\nsummary: "Last week"\n---\n',
    );
    /** 00:30 on Monday 2026-10-05 in Berlin, so yesterday, though its id carries the date before. */
    writeFileSync(
      join(store.journalDir, '2026-10-04T223000Z.md'),
      '---\ndate: 2026-10-04T22:30:00Z\nsummary: "Yesterday"\n---\n',
    );
    const text = recall(store, { env });
    const ranges = [
      ...text.matchAll(/^(?:local|utc)_(?:today|yesterday|this_week|last_week|this_month|last_month)=(\S+) (\S+)$/gm),
    ];

    // Act
    const results = ranges.map(([, since, until]) =>
      output(store, ['list', '--since', since!, '--until', until!], { env }),
    );

    // Assert
    expect(ranges.length).toBe(12);
    expect(results.every((result) => result.status === 0)).toBe(true);
    expect(results.filter((result) => result.stdout.includes('2026-09-30T100000Z')).length).toBe(4);
    expect(results.filter((result) => result.stdout.includes('2026-10-04T223000Z')).length).toBe(6);
  });

  test(`should name the first day of the week the region uses`, () => {
    // Arrange
    const store = fixture();

    // Act
    const monday = recallAt(store, 'zz_DE.UTF-8');
    const sunday = recallAt(store, 'zz_US.UTF-8');

    // Assert
    expect(monday).toContain(`local_week_start=Monday\n`);
    expect(sunday).toContain(`local_week_start=Sunday\n`);
  });

  test(`should name the current project and directory`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = recallAt(store);

    // Assert
    expect(result).toContain(`- \`project\`: \`repo\``);
    expect(result).toContain(`- \`cwd\`: \`${tilde(store, store.repo)}\``);
  });

  test(`should show an example entry`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = recallAt(store);

    // Assert
    expect(result).toContain(`date: 2026-01-11T14:30:00Z\nproject: my-lib\nsummary: "Shipped`);
  });

  test(`should pass the session id of the session the question comes from`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = recall(store, {
      sessionId: '4eb89b17-6f7f-4264-95d4-ea5313ef277e',
      env: { AGENT_JOURNAL_NOW: NOW, TZ: 'Europe/Berlin' },
    });

    // Assert
    expect(result).toContain(`- \`session_id\`: \`4eb89b17-6f7f-4264-95d4-ea5313ef277e\``);
  });

  test(`should name the agent of the session the question comes from`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = run(store, ['context', '--recall', '--cwd', store.repo, '--agent', 'claude/opus-5'], {
      env: { AGENT_JOURNAL_NOW: NOW, TZ: 'Europe/Berlin' },
    });

    // Assert
    expect(fields(result).agent).toBe('claude/opus-5');
  });

  test(`should take the session id line out when none is given`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = recallAt(store);

    // Assert
    expect(result).not.toContain(`- \`session_id\`: \``);
  });

  test(`should take the project line out outside a repository`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = recall(store, { cwd: store.home, env: { AGENT_JOURNAL_NOW: NOW, TZ: 'Europe/Berlin' } });

    // Assert
    expect(result).not.toContain(`- \`project\`: \``);
    expect(result).toContain(`- \`cwd\`: \`~\``);
  });

  test(`should print nothing when the template is missing`, () => {
    // Arrange
    const store = fixture();
    rmSync(join(store.root, 'templates', 'RECALL.md'));

    // Act
    const result = recallAt(store);

    // Assert
    expect(result).toBe(``);
  });

  test(`should fail without printing when the clock cannot be read`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = output(store, ['context', '--recall', '--cwd', store.repo], {
      env: { AGENT_JOURNAL_NOW: 'not-a-number', TZ: 'Europe/Berlin' },
    });

    // Assert
    expect(result.stdout).toBe(``);
    expect(result.status).toBe(1);
  });
});
