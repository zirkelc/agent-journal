import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
/** `run` here is the installer script, so the one that drives the binary is renamed. */
import { type Fixture, fails, fixture, output as capture, ROOT, run as runBin } from './helpers.js';

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
    expect(output).toContain('ask it to write a journal entry');
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

  test(`should leave a journal that is already configured where it is`, () => {
    // Arrange
    const installed = install();
    const elsewhere = join(installed.home, 'elsewhere');

    // Act
    run(installed.home, ['--prefix', installed.prefix, '--source', ROOT, '--dir', elsewhere]);

    // Assert
    /**
     * One config file serves every agent on the machine and every entry already
     * written, so repointing it silently would take a whole journal out of view.
     */
    const settings = execFileSync(join(installed.binDir, 'aj'), ['config'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: installed.home, XDG_CONFIG_HOME: join(installed.home, 'config') },
    });
    expect(settings).toContain(`journal_dir=${installed.journalDir}`);
    expect(existsSync(elsewhere)).toBe(false);
  });

  test(`should say that the directory it was asked for was not applied`, () => {
    // Arrange
    const installed = install();
    const elsewhere = join(installed.home, 'elsewhere');

    // Act
    const again = run(installed.home, [
      '--prefix',
      installed.prefix,
      '--source',
      ROOT,
      '--dir',
      elsewhere,
    ]);

    // Assert
    /** Without this the entries would go somewhere nobody is looking. */
    expect(again).toContain('left as it is');
    expect(again).toContain('was not applied');
  });

  test(`should not claim a directory was refused when it matches the one set`, () => {
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
    expect(again).toContain('left as it is');
    expect(again).not.toContain('was not applied');
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

/**
 * `agent-journal install` is about other people's software, so every case here
 * builds the machine it expects: a PATH with only what the shell needs, a home
 * with no agent's directory in it, and fake launchers for the agents a case
 * wants to be present.
 *
 * `CODEX_HOME` is cleared explicitly. It is set for real on some machines, and
 * a case about an absent Codex would otherwise pass or fail by accident.
 */
const BARE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

/** A launcher that records that it ran, so a case can tell printing from doing. */
function launcher(store: Fixture, name: string): string {
  const dir = join(store.home, 'fakebin');
  mkdirSync(dir, { recursive: true });

  const marker = join(store.home, `${name}-ran`);
  writeFileSync(join(dir, name), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${marker}"\n`);
  chmodSync(join(dir, name), 0o755);

  return dir;
}

function env(store: Fixture, agents: Array<string>): Record<string, string> {
  const dirs = agents.map((name) => launcher(store, name));
  return {
    PATH: dirs.length ? `${dirs[0]}:${BARE_PATH}` : BARE_PATH,
    CODEX_HOME: '',
  };
}

describe('install', () => {
  test(`should list what it found and what to type for it`, () => {
    // Arrange
    const store = fixture();

    // Act
    const listed = runBin(store, ['install'], { env: env(store, ['codex']) });

    // Assert
    expect(listed).toContain('Codex detected');
    expect(listed).toContain('agent-journal install codex');
    expect(listed).not.toContain('Claude Code detected');
  });

  test(`should say so when there is no agent to wire up`, () => {
    // Arrange
    const store = fixture();

    // Act
    const listed = runBin(store, ['install'], { env: env(store, []) });

    // Assert
    expect(listed).toContain('No agent detected');
    /** The journal still works without an agent, so the message should say so. */
    expect(listed).toContain('agent-journal write');
  });

  test(`should offer the commands to run by hand as well`, () => {
    // Arrange
    const store = fixture();

    // Act
    const listed = runBin(store, ['install'], { env: env(store, ['codex']) });

    // Assert
    expect(listed).toContain('codex plugin marketplace add zirkelc/agent-journal');
    expect(listed).toContain('codex plugin add agent-journal@zirkelc');
  });

  test(`should find Codex through CODEX_HOME when no launcher is on PATH`, () => {
    // Arrange
    const store = fixture();
    const codexHome = join(store.home, 'elsewhere', 'codex');
    mkdirSync(codexHome, { recursive: true });

    // Act
    const listed = runBin(store, ['install'], { env: { PATH: BARE_PATH, CODEX_HOME: codexHome } });

    // Assert
    expect(listed).toContain('Codex detected');
  });

  test(`should print the steps but run nothing when asked to dry run`, () => {
    // Arrange
    const store = fixture();
    const environment = env(store, ['codex']);

    // Act
    const printed = runBin(store, ['install', 'codex', '--dry-run'], { env: environment });

    // Assert
    expect(printed).toContain('codex plugin add agent-journal@zirkelc');
    expect(printed).toContain('nothing was run');
    expect(existsSync(join(store.home, 'codex-ran'))).toBe(false);
  });

  test(`should run the agent's own plugin commands when told to`, () => {
    // Arrange
    const store = fixture();

    // Act
    runBin(store, ['install', 'codex'], { env: env(store, ['codex']) });

    // Assert
    const ran = readFileSync(join(store.home, 'codex-ran'), 'utf8');
    expect(ran).toContain('plugin marketplace add zirkelc/agent-journal');
    expect(ran).toContain('plugin add agent-journal@zirkelc');
  });

  test(`should leave the trust step to the person, and say so`, () => {
    // Arrange
    const store = fixture();

    // Act
    const printed = runBin(store, ['install', 'codex'], { env: env(store, ['codex']) });

    // Assert
    /**
     * The review is what stops anything arranging to run a command at every
     * session start. An installer that did it for you would defeat it.
     */
    expect(printed).toContain('/hooks');
  });

  test(`should refuse an agent it does not know`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = fails(store, ['install', 'gemini'], { env: env(store, []) });

    // Assert
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not an agent this knows');
  });

  test(`should refuse to wire up an agent that is not on this machine`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = fails(store, ['install', 'codex'], { env: env(store, []) });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not look installed');
  });

  test(`should fail loudly when the agent's own command fails`, () => {
    // Arrange
    const store = fixture();
    const dir = join(store.home, 'fakebin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'codex'), '#!/bin/sh\nexit 3\n');
    chmodSync(join(dir, 'codex'), 0o755);

    // Act
    const result = capture(store, ['install', 'codex'], {
      env: { PATH: `${dir}:${BARE_PATH}`, CODEX_HOME: '' },
    });

    // Assert
    /** Without this it would report success while having wired up nothing. */
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Failed to install plugin: codex plugin marketplace add zirkelc/agent-journal');
  });
});

describe('the install header', () => {
  test(`should print on every form of the command`, () => {
    // Arrange
    const store = fixture();
    const banner = '█▀█ █▀▀ █▀▀';

    // Act
    const listed = runBin(store, ['install'], { env: env(store, ['codex']) });
    const named = runBin(store, ['install', 'codex', '--dry-run'], { env: env(store, ['codex']) });

    // Assert
    expect(listed).toContain(banner);
    expect(named).toContain(banner);
  });

  test(`should be printed once when the shell installer runs it`, () => {
    // Arrange
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'agent-journal-install-')));

    // Act
    const output = run(home, ['--prefix', join(home, 'opt'), '--source', ROOT]);

    // Assert
    /**
     * The installer prints the banner itself and then runs the command that also
     * prints it, so it suppresses the second copy rather than showing two.
     */
    expect(output.split('█▀█ █▀▀ █▀▀').length - 1).toBeLessThanOrEqual(1);
  });
});

describe('running an agent bit by bit', () => {
  /** A launcher that says something, so a case can see it reach the screen. */
  function talkative(store: Fixture, says: string, exit = 0): Record<string, string> {
    const dir = join(store.home, 'fakebin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'codex'), `#!/bin/sh\necho '${says}'\nexit ${exit}\n`);
    chmodSync(join(dir, 'codex'), 0o755);
    return { PATH: `${dir}:${BARE_PATH}`, CODEX_HOME: '' };
  }

  test(`should show what each command said for itself`, () => {
    // Arrange
    const store = fixture();

    // Act
    const printed = runBin(store, ['install', 'codex'], {
      env: talkative(store, 'Added marketplace zirkelc.'),
    });

    // Assert
    /**
     * These are somebody else's commands running under this one's name, so
     * swallowing their output leaves the install looking like it hung.
     */
    expect(printed).toContain('Installing Codex plugin...');
    expect(printed).toContain('Added marketplace zirkelc.');
    expect(printed).toContain('Codex plugin installed!');
  });

  test(`should report the exit code when a command fails`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = capture(store, ['install', 'codex'], {
      env: talkative(store, 'Error: no such marketplace', 3),
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Error: no such marketplace');
    /** With no terminal there is no spinner to turn into a cross, so say the code. */
    expect(result.stdout).toContain('exit 3');
  });

  test(`should stop at the first failure rather than run the rest`, () => {
    // Arrange
    const store = fixture();

    // Act
    const result = capture(store, ['install', 'codex'], {
      env: talkative(store, 'nope', 1),
    });

    // Assert
    expect(result.stdout).toContain('marketplace add');
    expect(result.stdout).not.toContain('plugin add agent-journal@zirkelc');
  });
});
