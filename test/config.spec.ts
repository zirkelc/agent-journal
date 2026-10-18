import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { configure, FAKE_ID_USER, FAKE_LOCAL_HOST_NAME, FAKE_LOGIN, fails, fixture, settings } from './helpers.ts';

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

  test(`should create the default directory once journal_dir is unset`, () => {
    // Arrange
    const store = fixture();
    configure(store, ['set', 'journal_dir', join(store.home, 'notes', 'journal')]);

    // Act
    configure(store, ['unset', 'journal_dir']);

    // Assert
    expect(existsSync(store.journalDir)).toBe(true);
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

  /** A value that was set stays where it is, even when it is the shipped default, so a later default does not move it. */
  test(`should keep the key when the value is the default`, () => {
    // Arrange
    const store = fixture();

    // Act
    configure(store, ['set', 'journal_dir', store.journalDir]);
    const result = settings(store);

    // Assert
    expect(result.journal_dir_from).toBe(`config`);
    expect(readFileSync(result.config_file, 'utf8')).toContain(`journal_dir=${store.journalDir}\n`);
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
    const lines = readFileSync(result.config_file, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('journal_dir='));
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

describe('the machine and the account', () => {
  test(`should take the local host name and the login name when neither is set`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = settings(store);

    // Assert
    expect(result.host).toBe(FAKE_LOCAL_HOST_NAME);
    expect(result.user).toBe(FAKE_LOGIN);
  });

  test(`should take the node name without its domain where there is no local host name`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = settings(store, { env: { AJ_TEST_LOCAL_HOST_NAME: '' } });

    // Assert
    expect(result.host).toBe('test-node');
  });

  test(`should ask the system for the user when the environment names none`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = settings(store, { env: { LOGNAME: undefined, USER: undefined } });

    // Assert
    expect(result.user).toBe(FAKE_ID_USER);
  });

  test(`should take a name that was set over the system's`, () => {
    // Arrange
    const store = fixture();

    // Act
    configure(store, ['set', 'host', 'macbook']);
    configure(store, ['set', 'user', 'john.doe@corp.example.com']);
    const result = settings(store);

    // Assert
    expect(result.host).toBe('macbook');
    expect(result.user).toBe('john.doe@corp.example.com');
  });

  // Empty is off, so the key stays in the file. Without it, the system's name would come back.
  test(`should keep an empty host in the file and resolve it to none`, () => {
    // Arrange
    const store = fixture();

    // Act
    configure(store, ['set', 'host', '']);
    const result = settings(store);

    // Assert
    expect(result.host).toBe('');
    expect(readFileSync(result.config_file, 'utf8')).toContain('\nhost=\n');
  });

  test(`should give the system's name back once the key is unset`, () => {
    // Arrange
    const store = fixture();
    configure(store, ['set', 'user', '']);

    // Act
    configure(store, ['unset', 'user']);
    const result = settings(store);

    // Assert
    expect(result.user).toBe(FAKE_LOGIN);
    expect(readFileSync(result.config_file, 'utf8')).not.toMatch(/^user=/m);
  });

  test(`should remove the key on unset, whatever the environment holds`, () => {
    // Arrange
    const store = fixture();
    configure(store, ['set', 'host', 'macbook']);

    // Act
    configure(store, ['unset', 'host'], { env: { keep_empty: '1' } });
    const result = settings(store);

    // Assert
    expect(result.host).toBe(FAKE_LOCAL_HOST_NAME);
    expect(readFileSync(result.config_file, 'utf8')).not.toMatch(/^host=/m);
  });

  test(`should refuse a name that would break the quotes around it`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = fails(store, ['config', 'set', 'host', 'a"b']);

    // Assert
    expect(result.status).toBe(2);
    expect(settings(store).host).toBe(FAKE_LOCAL_HOST_NAME);
  });

  test(`should resolve a name edited into the file by hand to none when it cannot be quoted`, () => {
    // Arrange
    const store = fixture();
    mkdirSync(join(store.home, 'config', 'agent-journal'), { recursive: true });
    writeFileSync(join(store.home, 'config', 'agent-journal', 'config'), 'user=a\\b\n');

    // Act
    const result = settings(store);

    // Assert
    expect(result.user).toBe('');
  });

  test(`should read a config saved with CRLF line endings`, () => {
    // Arrange
    const store = fixture();
    mkdirSync(join(store.home, 'config', 'agent-journal'), { recursive: true });
    writeFileSync(join(store.home, 'config', 'agent-journal', 'config'), 'host=macbook\r\nsync=git\r\n');

    // Act
    const result = settings(store);

    // Assert
    expect(result.host).toBe('macbook');
    expect(result.sync).toBe('git');
  });
});
