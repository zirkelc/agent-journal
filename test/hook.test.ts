import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { context, fields, fixture, HOOK, hook } from './helpers.ts';

describe('output', () => {
  test(`should deliver the rules as SessionStart context`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = hook(store);

    // Assert
    expect(result?.hookSpecificOutput.hookEventName).toBe(`SessionStart`);
    expect(result?.hookSpecificOutput.additionalContext).toContain(`EVERY session, you MUST write`);
  });

  /**
   * The rules reach the model and nothing reaches the user: nobody needs to be
   * told about their own configuration at every session start.
   */
  test(`should not print a banner to the user`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = hook(store);

    // Assert
    expect(result?.systemMessage).toBe(undefined);
  });

  test(`should carry the session id and directory the payload reported`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = fields(hook(store, { sessionId: 'xyz-789' })!.hookSpecificOutput.additionalContext);

    // Assert
    expect(result[`session_id`]).toBe(`xyz-789`);
    expect(result[`project`]).toBe(`repo`);
  });

  /**
   * The fields arrive as one stream, and an absent id leaves one line rather
   * than two, so a naive split hands the working directory over as the id.
   */
  test(`should omit the session id when the payload carries none`, () => {
    // Arrange
    const store = fixture();
    const payload = JSON.stringify({ cwd: store.repo, hook_event_name: 'SessionStart' });

    // Act
    const result = hook(store, { stdin: payload })!.hookSpecificOutput.additionalContext;

    // Assert
    expect(fields(result).session_id).toBe(undefined);
    expect(fields(result)[`project`]).toBe(`repo`);
  });

  test(`should read the fields out of pretty-printed JSON`, () => {
    // Arrange
    const store = fixture();
    const payload = JSON.stringify({ session_id: 'p-1', cwd: store.repo }, null, 2);

    // Act
    const result = fields(hook(store, { stdin: payload })!.hookSpecificOutput.additionalContext);

    // Assert
    expect(result[`session_id`]).toBe(`p-1`);
  });
});

describe('escaping', () => {
  /**
   * The one genuinely error-prone piece. The instructions are prose, so they will
   * contain quotes, backslashes and tabs sooner or later, and a hook that emits
   * invalid JSON costs them entirely while looking like it ran.
   */
  test(`should round-trip the instructions through JSON unchanged`, () => {
    // Arrange
    const nasty = [
      '# Rules',
      '',
      'A quote: "double" and \'single\'.',
      'A backslash: C:\\Users\\x and a regex \\d+ and \\\\ doubled.',
      'A tab:\tand a backtick: `code`.',
      'Underscores that are not a known key: __NOPE__ stays.',
      'Unicode: naïve — ✓',
      '',
      'Directory is __JOURNAL_DIR__.',
    ].join('\n');
    const store = fixture(nasty);

    // Act
    const delivered = hook(store)!.hookSpecificOutput.additionalContext;
    const direct = context(store, { sessionId: 'abc-123' });

    // Assert
    expect(delivered).toBe(direct.trimEnd());
    expect(delivered).toContain(`A backslash: C:\\Users\\x and a regex \\d+ and \\\\ doubled.`);
    expect(delivered).toContain(`A quote: "double" and 'single'.`);
    expect(delivered).toContain(`A tab:\tand a backtick: \`code\`.`);
  });
});

describe('failure', () => {
  /** A session must start even when everything here is broken. */
  const silent = (store: ReturnType<typeof fixture>, input: string): string =>
    execFileSync(HOOK, [], {
      encoding: 'utf8',
      input,
      env: { ...process.env, HOME: store.home, XDG_CONFIG_HOME: join(store.home, 'config'), CLAUDE_PLUGIN_ROOT: store.root },
    });

  test(`should say nothing and succeed when the instructions are missing`, () => {
    // Arrange
    const store = fixture();
    rmSync(join(store.root, 'INSTRUCTIONS.md'));

    // Act
    const result = silent(store, JSON.stringify({ cwd: store.repo }));

    // Assert
    expect(result).toBe(``);
  });

  test(`should survive stdin that is not JSON`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = silent(store, 'not json at all');

    // Assert
    expect(() => JSON.parse(result)).not.toThrow();
  });

  test(`should survive empty stdin`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = silent(store, '');

    // Assert
    expect(() => JSON.parse(result)).not.toThrow();
  });

  test(`should say nothing and succeed when the core is gone`, () => {
    // Arrange
    const store = fixture();
    rmSync(store.bin);

    // Act
    const result = silent(store, JSON.stringify({ cwd: store.repo }));

    // Assert
    expect(result).toBe(``);
  });
});
