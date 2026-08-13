import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ROOT } from './helpers.js';

const INSTALLER = join(ROOT, 'install.sh');

type Install = {
  home: string;
  prefix: string;
  binDir: string;
  dataDir: string;
  journalDir: string;
};

/**
 * A real install into a scratch prefix, from this checkout rather than from
 * GitHub, so the case needs no network and tests the working copy.
 */
function install(extra: Array<string> = []): Install {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'agent-journal-install-')));
  const prefix = join(home, 'opt');
  const journalDir = join(home, 'journal');

  run(home, ['--prefix', prefix, '--source', ROOT, '--dir', journalDir, ...extra]);

  return {
    home,
    prefix,
    binDir: join(prefix, 'bin'),
    dataDir: join(prefix, 'share', 'agent-journal'),
    journalDir,
  };
}

function run(home: string, args: Array<string>): string {
  return execFileSync('sh', [INSTALLER, ...args], {
    encoding: 'utf8',
    input: '',
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, 'config'),
    },
  });
}

describe('install.sh', () => {
  test(`should link both names at the checkout it installed`, () => {
    // Arrange, Act
    const installed = install();

    // Assert
    for (const name of ['agent-journal', 'aj']) {
      const link = join(installed.binDir, name);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(realpathSync(link)).toBe(join(installed.dataDir, 'bin', 'agent-journal'));
    }
  });

  test(`should render the instruction when run through the symlink`, () => {
    // Arrange
    const installed = install();

    // Act
    const rendered = execFileSync(join(installed.binDir, 'aj'), ['context', '--cwd', ROOT], {
      encoding: 'utf8',
      env: { ...process.env, HOME: installed.home, XDG_CONFIG_HOME: join(installed.home, 'config') },
    });

    // Assert
    expect(rendered).toContain('## Journal');
    expect(rendered).toContain(installed.journalDir);
  });

  test(`should point the configuration at the directory it was given`, () => {
    // Arrange
    const installed = install();

    // Act
    const settings = execFileSync(join(installed.binDir, 'aj'), ['config'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: installed.home, XDG_CONFIG_HOME: join(installed.home, 'config') },
    });

    // Assert
    expect(settings).toContain(`journal_dir=${installed.journalDir}`);
    expect(existsSync(installed.journalDir)).toBe(true);
  });

  test(`should say where entries go and how to move them`, () => {
    // Arrange, Act
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'agent-journal-install-')));
    const journalDir = join(home, 'journal');
    const output = run(home, ['--prefix', join(home, 'opt'), '--source', ROOT, '--dir', journalDir]);

    // Assert
    expect(output).toContain(`Journal lives in ${journalDir}`);
    expect(output).toContain('agent-journal config set journal_dir');
  });

  test(`should ask nothing, so a pipe with no terminal behind it still finishes`, () => {
    // Arrange
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'agent-journal-install-')));

    // Act
    const output = run(home, ['--prefix', join(home, 'opt'), '--source', ROOT]);

    // Assert
    expect(output).toContain('Try: aj');
    expect(existsSync(join(home, 'agent-journal'))).toBe(true);
  });

  test(`should say how to reach the commands when the bin directory is off PATH`, () => {
    // Arrange, Act
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'agent-journal-install-')));
    const output = run(home, [
      '--prefix',
      join(home, 'opt'),
      '--source',
      ROOT,
      '--dir',
      join(home, 'journal'),
    ]);

    // Assert
    expect(output).toContain('is not on your PATH');
    expect(output).toContain(join(home, 'opt', 'bin'));
  });

  test(`should update rather than fail when run a second time`, () => {
    // Arrange
    const installed = install();

    // Act
    const again = run(installed.home, [
      '--prefix',
      installed.prefix,
      '--source',
      ROOT,
      '--dir',
      installed.journalDir,
    ]);

    // Assert
    expect(again).toContain('are linked into');
    expect(realpathSync(join(installed.binDir, 'aj'))).toBe(
      join(installed.dataDir, 'bin', 'agent-journal'),
    );
  });
});
