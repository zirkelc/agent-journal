import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { configure, fixture, settings } from './helpers.ts';

describe('defaults', () => {
  test(`should resolve the journal directory under home when nothing is configured`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = settings(store);

    // Assert
    expect(result.journal_dir).toBe(store.journalDir);
    expect(result.journal_dir_from).toBe(`default`);
  });

  test(`should not create a config file just by reading the settings`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = settings(store);

    // Assert
    expect(existsSync(result.config_file)).toBe(false);
  });
});

describe('writing', () => {
  test(`should report a configured directory as coming from the config`, () => {
    // Arrange
    const store = fixture();
    const target = join(store.home, 'notes', 'journal');

    // Act
    configure(store, ['set', 'journal_dir', target]);
    const result = settings(store);

    // Assert
    expect(result.journal_dir).toBe(target);
    expect(result.journal_dir_from).toBe(`config`);
  });

  test(`should create the directory it was just pointed at`, () => {
    // Arrange
    const store = fixture();
    const target = join(store.home, 'notes', 'journal');

    // Act
    configure(store, ['set', 'journal_dir', target]);

    // Assert
    expect(existsSync(target)).toBe(true);
  });

  test(`should expand a leading tilde`, () => {
    // Arrange
    const store = fixture();

    // Act
    configure(store, ['set', 'journal_dir', '~/notes/journal']);
    const result = settings(store);

    // Assert
    expect(result.journal_dir).toBe(join(store.home, 'notes', 'journal'));
  });

  /**
   * Accepting a default must not pin it, otherwise changing the shipped default
   * later reaches nobody who ever ran the setup.
   */
  test(`should drop the key when the value is the default`, () => {
    // Arrange
    const store = fixture();

    // Act
    configure(store, ['set', 'journal_dir', store.journalDir]);
    const result = settings(store);

    // Assert
    expect(result.journal_dir_from).toBe(`default`);
    expect(readFileSync(result.config_file, 'utf8')).not.toContain(`journal_dir=`);
  });

  test(`should return to the default when the key is unset`, () => {
    // Arrange
    const store = fixture();
    configure(store, ['set', 'journal_dir', join(store.home, 'notes')]);

    // Act
    configure(store, ['unset', 'journal_dir']);
    const result = settings(store);

    // Assert
    expect(result.journal_dir).toBe(store.journalDir);
    expect(result.journal_dir_from).toBe(`default`);
  });

  test(`should replace a key in place rather than append a second copy`, () => {
    // Arrange
    const store = fixture();

    // Act
    configure(store, ['set', 'journal_dir', join(store.home, 'one')]);
    configure(store, ['set', 'journal_dir', join(store.home, 'two')]);
    const result = settings(store);

    // Assert
    const lines = readFileSync(result.config_file, 'utf8').split('\n').filter((l) => l.startsWith('journal_dir='));
    expect(lines.length).toBe(1);
    expect(result.journal_dir).toBe(join(store.home, 'two'));
  });

  test(`should refuse a key that is not a setting`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = () => configure(store, ['set', 'store', 'project']);

    // Assert
    expect(result).toThrow();
  });
});

describe('forward compatibility', () => {
  /**
   * Both versions exist on one machine during any upgrade, so a key this version
   * has never heard of must neither break a session nor be lost by a write.
   */
  test(`should ignore an unknown key and keep it when writing another`, () => {
    // Arrange
    const store = fixture();
    const configFile = join(store.home, 'config', 'agent-journal', 'config');
    mkdirSync(join(store.home, 'config', 'agent-journal'), { recursive: true });
    writeFileSync(configFile, '# mine\nstore=project\njournal_dir=/old\n');

    // Act
    configure(store, ['set', 'journal_dir', join(store.home, 'new')]);
    const result = settings(store);

    // Assert
    expect(result.journal_dir).toBe(join(store.home, 'new'));
    const written = readFileSync(configFile, 'utf8');
    expect(written).toContain(`store=project`);
    expect(written).toContain(`# mine`);
  });
});
