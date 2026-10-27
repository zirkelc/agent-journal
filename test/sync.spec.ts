import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { configure, type Fixture, fails, fixture, GIT_IDENTITY, output, seed, settings } from './helpers.ts';

function git(cwd: string, ...args: Array<string>): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...GIT_IDENTITY, GIT_CEILING_DIRECTORIES: cwd },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** `sync` with the identity, as both streams and the status. */
function sync(store: Fixture, args: Array<string> = []) {
  return output(store, ['sync', ...args], { env: GIT_IDENTITY });
}

/** Whether a path is a symlink, which `existsSync` cannot tell when it points nowhere. */
function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** A bare repository to push to, as a remote on another machine would be. */
function remote(store: Fixture, name = 'remote.git'): string {
  const path = join(store.home, name);
  execFileSync('git', ['init', '-q', '--bare', path]);
  return path;
}

/** The subjects of a repository's commits on every branch, newest first, since a bare remote's HEAD can name another branch than the one pushed. */
const subjects = (cwd: string): Array<string> => git(cwd, 'log', '--format=%s', '--branches').split('\n');

/** The branch the journal's repository is on, which the fixture's git names by its own default. */
const branchOf = (store: Fixture): string => git(store.journalDir, 'branch', '--show-current');

const ENTRY = { stem: '2026-10-11T090000Z', project: 'demo', summary: 'Added sync.' };

describe('setting', () => {
  test(`should report sync as off when nothing is configured`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = settings(store);

    // Assert
    expect(result.sync).toBe(`off`);
  });

  test(`should refuse a sync value other than git`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = fails(store, ['config', 'set', 'sync', 'svn']);

    // Assert
    expect(result.status).toBe(2);
  });

  test(`should turn sync off when the key is unset`, () => {
    // Arrange
    const store = fixture();
    configure(store, ['set', 'sync', 'git']);

    // Act
    configure(store, ['unset', 'sync']);

    // Assert
    expect(settings(store).sync).toBe(`off`);
  });
});

describe('sync', () => {
  test(`should do nothing while sync is off`, () => {
    // Arrange
    const store = fixture();
    seed(store, [ENTRY]);

    // Act
    const result = sync(store);

    // Assert
    expect(result).toEqual({ stdout: `sync is off\n`, stderr: ``, status: 0 });
    expect(existsSync(join(store.journalDir, '.git'))).toBe(false);
  });

  test(`should fail when sync is on and the folder is in no repository`, () => {
    // Arrange
    const store = fixture();
    seed(store, [ENTRY]);
    configure(store, ['set', 'sync', 'git']);

    // Act
    const result = sync(store);

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`sync init`);
  });

  test(`should name a single new entry in the commit`, () => {
    // Arrange
    const store = fixture();
    seed(store, [ENTRY]);

    // Act
    const result = sync(store, ['init']);

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`committed 2026-10-11T090000Z · no remote\n`);
    expect(subjects(store.journalDir)).toEqual([`journal: 2026-10-11T090000Z Added sync.`]);
    expect(settings(store).sync).toBe(`git`);
  });

  test(`should commit every file in the folder, not only entries`, () => {
    // Arrange
    const store = fixture();
    seed(store, [ENTRY]);
    writeFileSync(join(store.journalDir, 'README.md'), 'My journal.\n');

    // Act
    const result = sync(store, ['init']);

    // Assert
    expect(result.stdout).toBe(`committed 2 files · no remote\n`);
    expect(git(store.journalDir, 'ls-files').split('\n')).toEqual([`2026-10-11T090000Z.md`, `README.md`]);
  });

  test(`should push to the remote init was given`, () => {
    // Arrange
    const store = fixture();
    const origin = remote(store);
    seed(store, [ENTRY]);

    // Act
    const result = sync(store, ['init', origin]);

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`committed 2026-10-11T090000Z · pushed to origin/${branchOf(store)}\n`);
    expect(subjects(origin)).toEqual([`journal: 2026-10-11T090000Z Added sync.`]);
  });

  test(`should say there is nothing to do when everything is committed and pushed`, () => {
    // Arrange
    const store = fixture();
    seed(store, [ENTRY]);
    sync(store, ['init', remote(store)]);

    // Act
    const result = sync(store);

    // Assert
    expect(result.stdout).toBe(`nothing to commit · up to date\n`);
  });

  test(`should keep the commit and fail with 3 when the push fails`, () => {
    // Arrange
    const store = fixture();
    seed(store, [ENTRY]);
    sync(store, ['init', join(store.home, 'missing.git')]);
    seed(store, [{ stem: '2026-10-11T100000Z', summary: 'Second.' }]);

    // Act
    const result = sync(store);

    // Assert
    expect(result.status).toBe(3);
    expect(result.stdout).toMatch(/^committed 2026-10-11T100000Z · push failed: .+\n$/);
    expect(subjects(store.journalDir)[0]).toBe(`journal: 2026-10-11T100000Z Second.`);
  });

  test(`should push what an earlier failed push left behind`, () => {
    // Arrange
    const store = fixture();
    seed(store, [ENTRY]);
    const origin = join(store.home, 'later.git');
    sync(store, ['init', origin]);
    execFileSync('git', ['init', '-q', '--bare', origin]);

    // Act
    const result = sync(store);

    // Assert
    expect(result.stdout).toBe(`nothing to commit · pushed to origin/${branchOf(store)}\n`);
    expect(subjects(origin)).toEqual([`journal: 2026-10-11T090000Z Added sync.`]);
  });

  test(`should take in what another machine pushed first, then push`, () => {
    // Arrange
    const store = fixture();
    const origin = remote(store);
    seed(store, [ENTRY]);
    sync(store, ['init', origin]);
    const other = join(store.home, 'other');
    const branch = git(store.journalDir, 'branch', '--show-current');
    execFileSync('git', ['clone', '-q', '-b', branch, origin, other]);
    writeFileSync(join(other, '2026-10-11T093000Z.md'), '---\nsummary: "Other machine."\n---\n');
    git(other, 'add', '.');
    git(other, 'commit', '-q', '-m', 'other');
    git(other, 'push', '-q');
    seed(store, [{ stem: '2026-10-11T100000Z', summary: 'This machine.' }]);

    // Act
    const result = sync(store);

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`committed 2026-10-11T100000Z · pushed to origin/${branch}\n`);
    expect(subjects(origin)).toEqual([
      `journal: 2026-10-11T100000Z This machine.`,
      `other`,
      `journal: 2026-10-11T090000Z Added sync.`,
    ]);
  });

  test(`should refuse a journal folder inside a larger repository, and leave sync off`, () => {
    // Arrange
    const store = fixture();
    const notes = join(store.home, 'notes');
    mkdirSync(notes);
    git(notes, 'init', '-q');
    configure(store, ['set', 'journal_dir', join(notes, 'journal')]);
    writeFileSync(join(notes, 'journal', '2026-10-11T090000Z.md'), '---\nsummary: "Inside notes."\n---\n');

    // Act
    const result = sync(store, ['init', remote(store)]);

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`is inside the repository ~/notes`);
    expect(settings(store).sync).toBe(`off`);
    expect(git(notes, 'remote')).toBe(``);
    expect(git(notes, 'status', '--porcelain')).toBe(`?? journal/`);
  });

  test(`should refuse a journal folder that a larger repository has come to hold`, () => {
    // Arrange
    const store = fixture();
    const notes = join(store.home, 'notes');
    mkdirSync(notes);
    git(notes, 'init', '-q');
    configure(store, ['set', 'journal_dir', join(notes, 'journal')]);
    configure(store, ['set', 'sync', 'git']);
    writeFileSync(join(notes, 'journal', '2026-10-11T090000Z.md'), '---\nsummary: "Inside notes."\n---\n');

    // Act
    const result = sync(store);

    // Assert
    expect(result.status).toBe(1);
    expect(git(notes, 'status', '--porcelain')).toBe(`?? journal/`);
  });

  test(`should commit nothing on a detached HEAD, where the entry would leave the folder at the next checkout`, () => {
    // Arrange
    const store = fixture();
    seed(store, [ENTRY]);
    sync(store, ['init']);
    git(store.journalDir, 'checkout', '-q', '--detach');
    seed(store, [{ stem: '2026-10-11T100000Z', summary: 'Second.' }]);

    // Act
    const result = sync(store);

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`HEAD is detached`);
    expect(subjects(store.journalDir).length).toBe(1);
  });

  test(`should take in a remote that already has commits on the first push, and set the upstream`, () => {
    // Arrange
    const store = fixture();
    const origin = remote(store);
    seed(store, [ENTRY]);
    sync(store, ['init']);
    const other = join(store.home, 'other');
    execFileSync('git', ['init', '-q', '-b', branchOf(store), other]);
    writeFileSync(join(other, 'README.md'), 'My journal.\n');
    git(other, 'add', '.');
    git(other, 'commit', '-q', '-m', 'readme');
    git(other, 'push', '-q', origin, 'HEAD');
    git(store.journalDir, 'remote', 'add', 'origin', origin);

    // Act
    const first = sync(store);
    seed(store, [{ stem: '2026-10-11T100000Z', summary: 'Second.' }]);
    const second = sync(store);

    // Assert
    expect(first).toEqual({
      stdout: `nothing to commit · pushed to origin/${branchOf(store)}\n`,
      stderr: ``,
      status: 0,
    });
    expect(second.stdout).toBe(`committed 2026-10-11T100000Z · pushed to origin/${branchOf(store)}\n`);
    expect(subjects(origin)).toEqual([
      `journal: 2026-10-11T100000Z Second.`,
      `journal: 2026-10-11T090000Z Added sync.`,
      `readme`,
    ]);
  });

  test(`should name the rejected ref as the reason, not the remote it was pushed to`, () => {
    // Arrange
    const store = fixture();
    const origin = remote(store);
    seed(store, [ENTRY]);
    sync(store, ['init', origin]);
    const other = join(store.home, 'other');
    execFileSync('git', ['clone', '-q', '-b', branchOf(store), origin, other]);
    writeFileSync(join(other, '2026-10-11T090000Z.md'), '---\nsummary: "Changed elsewhere."\n---\n');
    git(other, 'commit', '-q', '-am', 'other');
    git(other, 'push', '-q');
    writeFileSync(join(store.journalDir, '2026-10-11T090000Z.md'), '---\nsummary: "Changed here."\n---\n');

    // Act
    const result = sync(store);

    // Assert
    expect(result.status).toBe(3);
    expect(result.stdout).toMatch(/· push failed: \[rejected\] \S+ -> \S+ \(fetch first\)\n$/);
    expect(existsSync(join(store.journalDir, '.git', 'rebase-merge'))).toBe(false);
  });

  test(`should commit without asking for a signature`, () => {
    // Arrange
    const store = fixture();
    seed(store, [ENTRY]);
    sync(store, ['init']);
    git(store.journalDir, 'config', 'commit.gpgsign', 'true');
    git(store.journalDir, 'config', 'gpg.program', join(store.home, 'no-such-gpg'));
    seed(store, [{ stem: '2026-10-11T100000Z', summary: 'Second.' }]);

    // Act
    const result = sync(store);

    // Assert
    expect(result.stdout).toBe(`committed 2026-10-11T100000Z · no remote\n`);
  });

  test(`should run the person's own ssh command in batch mode, and leave a GIT_SSH program alone`, () => {
    // Arrange
    const store = fixture();
    const bin = join(store.home, 'bin');
    mkdirSync(bin);
    const logged = join(store.home, 'ssh.log');
    for (const name of ['ssh', 'wrapper']) {
      writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> '${logged}'\nexit 1\n`);
      chmodSync(join(bin, name), 0o755);
    }
    seed(store, [ENTRY]);
    sync(store, ['init', 'ssh://example.invalid/journal.git']);
    git(store.journalDir, 'config', 'core.sshCommand', `${join(bin, 'ssh')} -i key`);

    // Act
    sync(store);
    git(store.journalDir, 'config', '--unset', 'core.sshCommand');
    output(store, ['sync'], { env: { ...GIT_IDENTITY, GIT_SSH: join(bin, 'wrapper') } });

    // Assert
    const calls = readFileSync(logged, 'utf8').trim().split('\n');
    expect(calls.every((call) => call.startsWith('ssh ') === call.includes('-o BatchMode=yes'))).toBe(true);
    expect(calls.some((call) => call.startsWith('ssh -i key -o BatchMode=yes'))).toBe(true);
    expect(calls.some((call) => call.startsWith('wrapper '))).toBe(true);
    expect(calls.some((call) => call.startsWith('wrapper ') && call.includes('BatchMode'))).toBe(false);
  });

  test(`should commit nothing while a merge is open`, () => {
    // Arrange
    const store = fixture();
    seed(store, [ENTRY]);
    sync(store, ['init']);
    writeFileSync(join(store.journalDir, '.git', 'MERGE_HEAD'), `${git(store.journalDir, 'rev-parse', 'HEAD')}\n`);
    seed(store, [{ stem: '2026-10-11T100000Z', summary: 'Second.' }]);

    // Act
    const result = sync(store);

    // Assert
    expect(result.status).toBe(1);
    expect(subjects(store.journalDir).length).toBe(1);
  });

  test(`should take over a lock whose process is gone, quietly`, () => {
    // Arrange
    const store = fixture();
    seed(store, [ENTRY]);
    sync(store, ['init']);
    const lock = join(store.journalDir, '.git', 'agent-journal-sync.lock');
    symlinkSync('999999', lock);
    seed(store, [{ stem: '2026-10-11T100000Z', summary: 'Second.' }]);

    // Act
    const result = sync(store);

    // Assert
    expect(result).toEqual({ stdout: `committed 2026-10-11T100000Z · no remote\n`, stderr: ``, status: 0 });
    expect(existsSync(lock) || isLink(lock)).toBe(false);
  });

  test(`should take over a lock older than any sync, even when its pid is in use again`, () => {
    // Arrange
    const store = fixture();
    seed(store, [ENTRY]);
    sync(store, ['init']);
    const lock = join(store.journalDir, '.git', 'agent-journal-sync.lock');
    symlinkSync(String(process.pid), lock);
    execFileSync('touch', ['-h', '-t', '202001010000', lock]);
    seed(store, [{ stem: '2026-10-11T100000Z', summary: 'Second.' }]);

    // Act
    const result = sync(store);

    // Assert
    expect(result.stdout).toBe(`committed 2026-10-11T100000Z · no remote\n`);
  });

  test(`should refuse an origin that points somewhere else`, () => {
    // Arrange
    const store = fixture();
    sync(store, ['init', remote(store, 'one.git')]);

    // Act
    const result = sync(store, ['init', remote(store, 'two.git')]);

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`origin already points at`);
  });
});

describe('write', () => {
  test(`should commit the entry it wrote, with the path alone on stdout`, () => {
    // Arrange
    const store = fixture();
    sync(store, ['init']);

    // Act
    const result = output(store, ['write', '--summary', 'Synced on write.'], { at: store.repo, env: GIT_IDENTITY });

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\/\d{4}-\d{2}-\d{2}T\d{6}Z\.md\n$/);
    expect(result.stderr).toMatch(/^committed \S+Z · no remote\n$/);
    expect(subjects(store.journalDir)[0]).toMatch(/^journal: \S+Z Synced on write\.$/);
  });

  test(`should leave the sync to the caller with --no-sync, and commit nothing`, () => {
    // Arrange
    const store = fixture();
    sync(store, ['init']);

    // Act
    const result = output(store, ['write', '--summary', 'Synced later.', '--no-sync'], {
      at: store.repo,
      env: GIT_IDENTITY,
    });

    // Assert
    expect(result.status).toBe(0);
    expect(result.stderr).toBe(``);
    expect(git(store.journalDir, 'status', '--porcelain')).toMatch(/^\?\? \S+Z\.md$/);
  });

  test(`should not fail the write when the sync fails`, () => {
    // Arrange
    const store = fixture();
    configure(store, ['set', 'sync', 'git']);

    // Act
    const result = output(store, ['write', '--summary', 'No repository.'], { at: store.repo, env: GIT_IDENTITY });

    // Assert
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(`is not a git repository`);
  });

  test(`should not sync while sync is off`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = output(store, ['write', '--summary', 'Off.'], { at: store.repo, env: GIT_IDENTITY });

    // Assert
    expect(result.stderr).toBe(``);
  });
});
