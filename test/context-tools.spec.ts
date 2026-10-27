import { describe, expect, test } from 'vitest';
import { context, fixture, run } from './helpers.ts';

const PREFIX = 'mcp__agent-journal__';

/** The rules for an agent that has the journal's own tools. */
function withTools(store: ReturnType<typeof fixture>): string {
  return run(store, ['context', '--cwd', store.repo, '--session-id', 'abc-123', '--tools', PREFIX]);
}

describe('the rules with tools', () => {
  test(`should name the write tool and the three recall tools by the prefix given`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = withTools(store);

    // Assert
    for (const name of ['write', 'list', 'search', 'read']) expect(result).toContain(`\`${PREFIX}${name}\``);
  });

  test(`should not tell the agent to write a file, read the clock, or recall with ls and grep`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = withTools(store);

    // Assert
    expect(result).not.toContain('`Write`');
    expect(result).not.toContain('date -u');
    expect(result).not.toContain('YYYY-MM-DDTHHMMSSZ.md');
    expect(result).not.toMatch(/^\s*(grep|ls) /m);
    expect(result).not.toContain(store.journalDir);
  });

  test(`should keep the rules both variants share`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = withTools(store);
    const plain = context(store, { sessionId: 'abc-123' });

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
      expect(result).toContain(shared);
      expect(plain).toContain(shared);
    }
  });

  test(`should leave no marker, placeholder or doubled blank line in either variant`, () => {
    // Arrange
    const store = fixture();

    // Act
    const variants = [withTools(store), context(store, { sessionId: 'abc-123' })];

    // Assert
    for (const variant of variants) {
      expect(variant).not.toContain('<!--');
      expect(variant).not.toMatch(/__[A-Z][A-Z_]*__/);
      expect(variant).not.toContain('\n\n\n');
    }
  });

  test(`should keep the plain variant on files, the clock and ls and grep`, () => {
    // Arrange
    const store = fixture();

    // Act
    const plain = context(store, { sessionId: 'abc-123' });

    // Assert
    expect(plain).toContain('Use the `Write` tool to create the file');
    expect(plain).toContain('date -u +%Y-%m-%dT%H:%M:%SZ');
    expect(plain).toContain(`ls ${store.journalDir} | tail -20`);
    expect(plain).toContain('- `session_id`: `abc-123`');
    expect(plain).not.toContain(PREFIX);
  });
});
