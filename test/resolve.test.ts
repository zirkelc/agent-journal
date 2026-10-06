import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { fixture, output, run, type Fixture } from './helpers.js';

/**
 * A fixed clock, zone and locale. The locale names use the language `zz`, which
 * no system has installed, so the week start comes from the region in the name
 * on macOS and Linux alike. `HOME` is the fixture, so the developer's own macOS
 * settings are never read.
 */
function resolve(
  store: Fixture,
  at: string,
  options: { now: string; tz?: string; locale?: string },
): Record<string, string> {
  const out = run(store, ['resolve'], {
    at,
    env: {
      AGENT_JOURNAL_NOW: String(Date.parse(options.now) / 1_000),
      TZ: options.tz ?? 'Europe/Berlin',
      LC_ALL: options.locale ?? 'zz_DE.UTF-8',
    },
  });
  const result: Record<string, string> = {};
  for (const line of out.split('\n')) {
    if (!line) continue;
    const index = line.indexOf('=');
    result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}

describe('resolve', () => {
  test(`should print every value for one instant`, () => {
    // Arrange
    const store = fixture();

    // Act
    const out = run(store, ['resolve'], {
      at: store.repo,
      env: { AGENT_JOURNAL_NOW: '1791216602', TZ: 'Europe/Berlin', LC_ALL: 'zz_DE.UTF-8' },
    });

    // Assert
    expect(out).toBe(
      [
        'local_now=2026-10-05T18:10:02+02:00',
        'local_date=2026-10-05',
        'local_time=18:10:02',
        'local_weekday=Monday',
        'local_week_start=Monday',
        'local_timezone=Europe/Berlin',
        'local_utc_offset=+02:00',
        'utc_now=2026-10-05T16:10:02Z',
        'utc_date=2026-10-05',
        'utc_time=16:10:02',
        'local_today=2026-10-05',
        'utc_today=2026-10-04T22:00:00Z 2026-10-05T21:59:59Z',
        'local_yesterday=2026-10-04',
        'utc_yesterday=2026-10-03T22:00:00Z 2026-10-04T21:59:59Z',
        'local_this_week=2026-10-05T00:00:00+02:00 2026-10-11T23:59:59+02:00',
        'utc_this_week=2026-10-04T22:00:00Z 2026-10-11T21:59:59Z',
        'local_last_week=2026-09-28T00:00:00+02:00 2026-10-04T23:59:59+02:00',
        'utc_last_week=2026-09-27T22:00:00Z 2026-10-04T21:59:59Z',
        'local_this_month=2026-10-01T00:00:00+02:00 2026-10-31T23:59:59+01:00',
        'utc_this_month=2026-09-30T22:00:00Z 2026-10-31T22:59:59Z',
        'local_last_month=2026-09-01T00:00:00+02:00 2026-09-30T23:59:59+02:00',
        'utc_last_month=2026-08-31T22:00:00Z 2026-09-30T21:59:59Z',
        'project=repo',
        'cwd=~/repo',
        'journal_dir=~/agent-journal',
        '',
      ].join('\n'),
    );
  });

  test(`should take the local date when it is already tomorrow in the zone`, () => {
    // Arrange
    const store = fixture();

    // Act
    const values = resolve(store, store.repo, { now: '2026-10-05T22:30:00Z' });

    // Assert
    expect(values.local_date).toBe('2026-10-06');
    expect(values.local_time).toBe('00:30:00');
    expect(values.local_weekday).toBe('Tuesday');
    expect(values.utc_date).toBe('2026-10-05');
    expect(values.local_today).toBe('2026-10-06');
    expect(values.utc_today).toBe('2026-10-05T22:00:00Z 2026-10-06T21:59:59Z');
  });

  test(`should give the day of a change to winter time 25 hours`, () => {
    // Arrange
    const store = fixture();

    // Act
    const values = resolve(store, store.repo, { now: '2026-10-25T10:00:00Z' });

    // Assert
    expect(values.local_utc_offset).toBe('+01:00');
    expect(values.utc_today).toBe('2026-10-24T22:00:00Z 2026-10-25T22:59:59Z');
    expect(values.local_this_week).toBe('2026-10-19T00:00:00+02:00 2026-10-25T23:59:59+01:00');
  });

  test(`should cross a year boundary for the week and the month`, () => {
    // Arrange
    const store = fixture();

    // Act
    const values = resolve(store, store.repo, { now: '2027-01-01T11:00:00Z' });

    // Assert
    expect(values.local_weekday).toBe('Friday');
    expect(values.local_yesterday).toBe('2026-12-31');
    expect(values.local_this_week).toBe('2026-12-28T00:00:00+01:00 2027-01-03T23:59:59+01:00');
    expect(values.local_last_week).toBe('2026-12-21T00:00:00+01:00 2026-12-27T23:59:59+01:00');
    expect(values.local_this_month).toBe('2027-01-01T00:00:00+01:00 2027-01-31T23:59:59+01:00');
    expect(values.local_last_month).toBe('2026-12-01T00:00:00+01:00 2026-12-31T23:59:59+01:00');
    expect(values.utc_last_month).toBe('2026-11-30T23:00:00Z 2026-12-31T22:59:59Z');
  });

  test(`should end February on the 29th in a leap year`, () => {
    // Arrange
    const store = fixture();

    // Act
    const values = resolve(store, store.repo, { now: '2028-03-10T12:00:00Z' });

    // Assert
    expect(values.local_last_month).toBe('2028-02-01T00:00:00+01:00 2028-02-29T23:59:59+01:00');
    expect(values.local_this_month).toBe('2028-03-01T00:00:00+01:00 2028-03-31T23:59:59+02:00');
    expect(values.utc_this_month).toBe('2028-02-29T23:00:00Z 2028-03-31T21:59:59Z');
  });

  test(`should print UTC as its own zone`, () => {
    // Arrange
    const store = fixture();

    // Act
    const values = resolve(store, store.repo, { now: '2026-10-05T16:10:02Z', tz: 'UTC' });

    // Assert
    expect(values.local_now).toBe('2026-10-05T16:10:02+00:00');
    expect(values.local_timezone).toBe('UTC');
    expect(values.local_utc_offset).toBe('+00:00');
    expect(values.utc_today).toBe('2026-10-05T00:00:00Z 2026-10-05T23:59:59Z');
  });

  test(`should name the zone from the system when TZ is not set`, () => {
    // Arrange
    const store = fixture();

    // Act
    const out = run(store, ['resolve'], {
      at: store.repo,
      env: { AGENT_JOURNAL_NOW: '1791216602', LC_ALL: 'C', TZ: undefined },
    });

    // Assert
    expect(out).toContain('utc_now=2026-10-05T16:10:02Z\n');
  });

  test(`should give a day that has no midnight its first local time`, () => {
    // Arrange
    const store = fixture();

    // Act
    const values = resolve(store, store.repo, { now: '2026-03-08T15:00:00Z', tz: 'America/Havana' });

    // Assert
    expect(values.utc_today).toBe('2026-03-08T05:00:00Z 2026-03-09T03:59:59Z');
  });

  /** A `date` that can read the clock but convert no day, as on a system with neither variant. */
  test(`should fail rather than print empty ranges when a day cannot be converted`, () => {
    // Arrange
    const store = fixture();
    const shim = join(store.home, 'shim');
    mkdirSync(shim);
    const real = execFileSync('sh', ['-c', 'command -v date'], { encoding: 'utf8' }).trim();
    writeFileSync(
      join(shim, 'date'),
      `#!/bin/sh\ncase "$*" in *:00:00*) exit 1 ;; esac\nexec ${real} "$@"\n`,
    );
    chmodSync(join(shim, 'date'), 0o755);

    // Act
    const result = output(store, ['resolve'], {
      at: store.repo,
      env: { AGENT_JOURNAL_NOW: '1791216602', PATH: `${shim}:${process.env.PATH}` },
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
  });

  test(`should leave the project empty outside a repository`, () => {
    // Arrange
    const store = fixture();
    const loose = join(store.home, 'scratch');
    mkdirSync(loose);

    // Act
    const values = resolve(store, loose, { now: '2026-10-05T16:10:02Z' });

    // Assert
    expect(values.project).toBe('');
    expect(values.cwd).toBe('~/scratch');
  });
});

describe('the first day of the week', () => {
  test(`should start the week on Sunday in a region that does`, () => {
    // Arrange
    const store = fixture();

    // Act
    const values = resolve(store, store.repo, { now: '2026-10-05T16:10:02Z', locale: 'zz_US.UTF-8' });

    // Assert
    expect(values.local_week_start).toBe('Sunday');
    expect(values.local_this_week).toBe('2026-10-04T00:00:00+02:00 2026-10-10T23:59:59+02:00');
    expect(values.local_last_week).toBe('2026-09-27T00:00:00+02:00 2026-10-03T23:59:59+02:00');
  });

  test(`should start the week on Saturday in a region that does`, () => {
    // Arrange
    const store = fixture();

    // Act
    const values = resolve(store, store.repo, { now: '2026-10-05T16:10:02Z', locale: 'zz_EG.UTF-8' });

    // Assert
    expect(values.local_week_start).toBe('Saturday');
    expect(values.local_this_week).toBe('2026-10-03T00:00:00+02:00 2026-10-09T23:59:59+02:00');
  });

  test(`should read the region after a script in the locale name`, () => {
    // Arrange
    const store = fixture();

    // Act
    const values = resolve(store, store.repo, { now: '2026-10-05T16:10:02Z', locale: 'zz_Latn_US.UTF-8' });

    // Assert
    expect(values.local_week_start).toBe('Sunday');
  });

  test(`should fall back to Monday when no region can be read`, () => {
    // Arrange
    const store = fixture();

    // Act
    const values = resolve(store, store.repo, { now: '2026-10-05T16:10:02Z', locale: 'C.UTF-8' });

    // Assert
    expect(values.local_week_start).toBe('Monday');
    expect(values.local_this_week).toBe('2026-10-05T00:00:00+02:00 2026-10-11T23:59:59+02:00');
  });

  /** The macOS settings live in a property list under `HOME`, written here with the system's own tool. */
  describe.skipIf(process.platform !== 'darwin')('on macOS', () => {
    function settings(store: Fixture, ...edits: Array<Array<string>>): void {
      const plist = join(store.home, 'Library', 'Preferences', '.GlobalPreferences.plist');
      mkdirSync(join(store.home, 'Library', 'Preferences'), { recursive: true });
      execFileSync('plutil', ['-create', 'binary1', plist]);
      for (const edit of edits) execFileSync('plutil', ['-insert', ...edit, plist]);
    }

    test(`should take the region of AppleLocale over the language and the environment`, () => {
      // Arrange
      const store = fixture();
      settings(store, ['AppleLocale', '-string', 'en_US@rg=dezzzz']);

      // Act
      const values = resolve(store, store.repo, { now: '2026-10-05T16:10:02Z', locale: 'zz_US.UTF-8' });

      // Assert
      expect(values.local_week_start).toBe('Monday');
      expect(values.local_this_week).toBe('2026-10-05T00:00:00+02:00 2026-10-11T23:59:59+02:00');
    });

    test(`should take the country of AppleLocale when it names no region`, () => {
      // Arrange
      const store = fixture();
      settings(store, ['AppleLocale', '-string', 'en_US']);

      // Act
      const values = resolve(store, store.repo, { now: '2026-10-05T16:10:02Z' });

      // Assert
      expect(values.local_week_start).toBe('Sunday');
    });

    test(`should take an explicit first weekday over every region`, () => {
      // Arrange
      const store = fixture();
      settings(
        store,
        ['AppleLocale', '-string', 'en_US@rg=dezzzz'],
        ['AppleFirstWeekday', '-json', '{"gregorian":1}'],
      );

      // Act
      const values = resolve(store, store.repo, { now: '2026-10-05T16:10:02Z' });

      // Assert
      expect(values.local_week_start).toBe('Sunday');
      expect(values.local_this_week).toBe('2026-10-04T00:00:00+02:00 2026-10-10T23:59:59+02:00');
    });
  });
});
