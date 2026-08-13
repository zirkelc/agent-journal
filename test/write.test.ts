import { chmodSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { type Fixture, fails, fixture, frontmatter, rows, run, tilde } from './helpers.js';

/**
 * A stand-in for `$EDITOR`: it fills the summary in and appends a body, the way
 * a person would, without needing a terminal to do it on.
 */
function editor(store: Fixture, summary: string, body = 'What was decided, and why.'): string {
  const path = join(store.home, 'fake-editor');

  writeFileSync(
    path,
    [
      '#!/bin/sh',
      `awk '{ sub(/^summary: ""$/, "summary: \\"${summary}\\""); print }' "$1" > "$1.new"`,
      'mv "$1.new" "$1"',
      `printf '%s\\n' '${body}' >> "$1"`,
      '',
    ].join('\n'),
  );
  chmodSync(path, 0o755);

  return path;
}

/** The one entry a case has written. */
function written(store: Fixture): { name: string; text: string } {
  const names = readdirSync(store.journalDir);
  expect(names.length).toBe(1);
  return { name: names[0], text: readFileSync(join(store.journalDir, names[0]), 'utf8') };
}

describe('write', () => {
  test(`should write an entry from a summary given on the command line`, () => {
    // Arrange
    const store = fixture();

    // Act
    run(store, ['write', '-m', 'Added the write command.'], { at: store.repo });

    // Assert
    const entry = written(store);
    expect(frontmatter(entry.text).summary).toBe('Added the write command.');
  });

  test(`should take the body from stdin`, () => {
    // Arrange
    const store = fixture();

    // Act
    run(store, ['write', '-m', 'Added the write command.'], {
      at: store.repo,
      stdin: 'The detail the summary had to leave out.\n',
    });

    // Assert
    expect(written(store).text).toContain('The detail the summary had to leave out.');
  });

  test(`should use one instant for both the filename and the date field`, () => {
    // Arrange
    const store = fixture();

    // Act
    run(store, ['write', '-m', 'One clock read.'], { at: store.repo });

    // Assert
    const entry = written(store);
    const stem = entry.name.replace(/\.md$/, '');
    expect(frontmatter(entry.text).date.replace(/:/g, '')).toBe(stem);
  });

  test(`should record the project and directory the session is in`, () => {
    // Arrange
    const store = fixture();

    // Act
    run(store, ['write', '-m', 'Filed under the repository it was written in.'], { at: store.repo });

    // Assert
    const fields = frontmatter(written(store).text);
    expect(fields.project).toBe('repo');
    expect(fields.cwd).toBe(tilde(store, store.repo));
  });

  test(`should leave the project out when the work is outside a repository`, () => {
    // Arrange
    const store = fixture();

    // Act
    run(store, ['write', '-m', 'No repository here.'], { at: store.home });

    // Assert
    expect(frontmatter(written(store).text).project).toBeUndefined();
  });

  test(`should be listed once written`, () => {
    // Arrange
    const store = fixture();

    // Act
    run(store, ['write', '-m', 'Round trips through list.'], { at: store.repo });
    const listed = rows(run(store, ['list']));

    // Assert
    expect(listed.length).toBe(1);
    expect(listed[0].summary).toBe('Round trips through list.');
  });

  test(`should take a piped line as the whole entry`, () => {
    // Arrange
    const store = fixture();

    // Act
    run(store, ['write'], { at: store.repo, stdin: 'Piped straight in.\n' });

    // Assert
    expect(frontmatter(written(store).text).summary).toBe('Piped straight in.');
  });

  test(`should split a piped entry into its first line and the rest`, () => {
    // Arrange
    const store = fixture();

    // Act
    run(store, ['write'], {
      at: store.repo,
      stdin: 'The summary line.\n\nThe body, which the summary left out.\nAnd more of it.\n',
    });

    // Assert
    const entry = written(store).text;
    expect(frontmatter(entry).summary).toBe('The summary line.');
    expect(entry).toContain('---\n\nThe body, which the summary left out.\nAnd more of it.\n');
  });

  test(`should file the entry under a named project rather than the resolved one`, () => {
    // Arrange
    const store = fixture();

    // Act
    run(store, ['write', '-m', 'Filed elsewhere.', '--project', 'nebula'], { at: store.repo });

    // Assert
    expect(frontmatter(written(store).text).project).toBe('nebula');
  });

  test(`should record a session id when given one`, () => {
    // Arrange
    const store = fixture();

    // Act
    run(store, ['write', '-m', 'From a session.', '--session-id', 'abc-123'], { at: store.repo });

    // Assert
    expect(frontmatter(written(store).text).session_id).toBe('abc-123');
  });

  test(`should leave the session id out when there is none`, () => {
    // Arrange
    const store = fixture();

    // Act
    run(store, ['write', '-m', 'Written by a person.'], { at: store.repo });

    // Assert
    expect(frontmatter(written(store).text).session_id).toBeUndefined();
  });

  test(`should wait for a free second rather than overwrite an entry`, () => {
    // Arrange
    const store = fixture();

    // Act
    run(store, ['write', '-m', 'First in this second.'], { at: store.repo });
    run(store, ['write', '-m', 'Second in this second.'], { at: store.repo });

    // Assert
    const names = readdirSync(store.journalDir);
    expect(names.length).toBe(2);
    expect(new Set(names).size).toBe(2);
  });

  test(`should refuse a project that would break the frontmatter`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = fails(store, ['write', '-m', 'Fine.', '--project', 'a: b'], { at: store.repo });

    // Assert
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('colon');
  });

  test(`should refuse a summary longer than 200 characters`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = fails(store, ['write', '-m', 'x'.repeat(201)], { at: store.repo });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('201 characters');
    expect(readdirSync(store.journalDir).length).toBe(0);
  });

  test(`should refuse a summary containing a double quote`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = fails(store, ['write', '-m', 'he said "no"'], { at: store.repo });

    // Assert
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('quote');
  });

  test(`should open the editor when no summary is given`, () => {
    // Arrange
    const store = fixture();

    // Act
    run(store, ['write'], {
      at: store.repo,
      env: { EDITOR: editor(store, 'Written through the editor.') },
    });

    // Assert
    const fields = frontmatter(written(store).text);
    expect(fields.summary).toBe('Written through the editor.');
  });

  test(`should strip the guidance comment the template carried`, () => {
    // Arrange
    const store = fixture();

    // Act
    run(store, ['write'], {
      at: store.repo,
      env: { EDITOR: editor(store, 'Written through the editor.') },
    });

    // Assert
    const text = written(store).text;
    expect(text).not.toContain('<!--');
    expect(text).toContain('---\n\nWhat was decided, and why.');
  });

  test(`should refuse an entry the editor left without a summary`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = fails(store, ['write'], { at: store.repo, env: { EDITOR: 'true' } });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('summary is empty');
    expect(readdirSync(store.journalDir).length).toBe(0);
  });
});
