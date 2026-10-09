import { describe, expect, test } from 'claude-code/testing';
import {
  colorOf,
  column,
  dayHeading,
  instantOf,
  isLatest,
  localDayTime,
  periodText,
  stepped,
  withUnit,
  parseEntry,
  splitSources,
  PROJECT_COLORS,
} from '../hooks/format.js';

describe('format', () => {
  test('a unit chosen from all dates is today\u2019s period, and one chosen from a past period lands on its newest end', () => {
    // Arrange
    const today = '2026-10-09';

    // Act
    const month = withUnit({ unit: 'all', value: '' }, 'month', today);
    const fromPastYear = withUnit({ unit: 'year', value: '2025' }, 'month', today);
    const fromFebruary = withUnit({ unit: 'month', value: '2024-02' }, 'day', today);
    const all = withUnit(month, 'all', today);

    // Assert
    expect(month).toEqual({ unit: 'month', value: '2026-10' });
    expect(fromPastYear).toEqual({ unit: 'month', value: '2025-12' });
    expect(fromFebruary).toEqual({ unit: 'day', value: '2024-02-29' });
    expect(all).toEqual({ unit: 'all', value: '' });
  });

  test('a step goes one period back or forward across year and month ends', () => {
    // Act
    const results = [
      stepped({ unit: 'year', value: '2026' }, -1),
      stepped({ unit: 'month', value: '2026-01' }, -1),
      stepped({ unit: 'month', value: '2025-12' }, 1),
      stepped({ unit: 'day', value: '2026-03-01' }, -1),
    ];

    // Assert
    expect(results.map((one) => one.value)).toEqual(['2025', '2025-12', '2026-01', '2026-02-28']);
  });

  test('the period today is in is the newest, and a period reads as a person says it', () => {
    // Arrange
    const today = '2026-10-09';

    // Act
    const newest = [
      isLatest({ unit: 'month', value: '2026-10' }, today),
      isLatest({ unit: 'month', value: '2026-09' }, today),
    ];
    const texts = [
      periodText({ unit: 'year', value: '2026' }),
      periodText({ unit: 'month', value: '2026-10' }),
      periodText({ unit: 'day', value: '2026-10-07' }),
    ];

    // Assert
    expect(newest).toEqual([true, false]);
    expect(texts).toEqual(['2026', 'October 2026', 'Wednesday 2026-10-07']);
  });

  test('an entry id is the UTC instant it names', () => {
    // Act
    const instant = instantOf('2026-10-04T223000Z');

    // Assert
    expect(instant?.toISOString()).toBe('2026-10-04T22:30:00.000Z');
    expect(instantOf('not-an-id')).toBe(undefined);
  });

  test('a time is shown on the local day it falls on', () => {
    // Act
    const result = localDayTime(new Date('2026-10-04T22:30:00Z'), 'Europe/Berlin');

    // Assert
    expect(result).toEqual({ day: '2026-10-05', time: '00:30' });
  });

  test('a day heading names today and yesterday', () => {
    // Arrange
    const now = new Date('2026-10-07T10:00:00Z');

    // Act
    const headings = ['2026-10-07', '2026-10-06', '2026-10-05'].map((day) => dayHeading(day, now, 'Europe/Berlin'));

    // Assert
    expect(headings).toEqual(['Today, Wednesday 2026-10-07', 'Yesterday, Tuesday 2026-10-06', 'Monday 2026-10-05']);
  });

  test('a project keeps its color, and the colors are not red', () => {
    // Act
    const first = colorOf('nebula');
    const again = colorOf('nebula');

    // Assert
    expect(first).toBe(again);
    expect(PROJECT_COLORS.includes(first)).toBe(true);
    expect(PROJECT_COLORS.every((color) => /^#[0-9a-f]{6}$/.test(color))).toBe(true);
  });

  test('a column is cut or padded to its width', () => {
    // Act
    const result = [column('nebula', 8), column('claude-quick-actions', 8)];

    // Assert
    expect(result).toEqual(['nebula  ', 'claude-…']);
  });

  test('an entry splits into its fields and its body', () => {
    // Act
    const parsed = parseEntry(
      '---\ndate: 2026-10-07T08:04:08Z\nproject: nebula\nsummary: "Wrote the plan: \\"four\\" phases."\n---\n\nThe body.\n',
    );

    // Assert
    expect(parsed.fields).toEqual({
      date: '2026-10-07T08:04:08Z',
      project: 'nebula',
      summary: 'Wrote the plan: "four" phases.',
    });
    expect(parsed.body).toBe('The body.');
  });

  test('the Sources line comes off the answer and names its entries', () => {
    // Act
    const result = splitSources('You fixed the race.\n\nSources: 2026-10-05T143000Z, 2026-10-04T090000Z\n');

    // Assert
    expect(result).toEqual({ text: 'You fixed the race.', ids: ['2026-10-05T143000Z', '2026-10-04T090000Z'] });
  });

  test('a bold Sources line counts too', () => {
    // Act
    const result = splitSources('Done.\n**Sources:** 2026-10-05T143000Z');

    // Assert
    expect(result).toEqual({ text: 'Done.', ids: ['2026-10-05T143000Z'] });
  });

  test('an answer without a Sources line keeps its text, and its ids are the sources', () => {
    // Act
    const result = splitSources('See 2026-10-05T143000Z for the fix.');

    // Assert
    expect(result).toEqual({ text: 'See 2026-10-05T143000Z for the fix.', ids: ['2026-10-05T143000Z'] });
  });
});
