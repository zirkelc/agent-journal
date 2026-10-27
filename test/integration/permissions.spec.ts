import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { TOOL_WRITE, toolName } from '../../claude-code/hooks/names.ts';
import { ROOT } from '../helpers.ts';
import { ISOLATED_ARGS, removeLeftovers, SESSION_TIMEOUT_MS, setup } from './session.ts';

const WRITE_TOOL = toolName(TOOL_WRITE);

const MODES = ['default', 'acceptEdits', 'dontAsk', 'plan', 'auto', 'bypassPermissions'] as const;
type Mode = (typeof MODES)[number];

const RULES = ['none', 'allow', 'ask', 'deny'] as const;
type Rule = (typeof RULES)[number];

/**
 * What the normal permission check does with a tool call, run headless: a call
 * that would ask the person is refused instead.
 */
const Outcomes = {
  /** The entry is written. */
  WRITTEN: 'written',
  /** The call is made, refused, and listed as a permission denial. */
  REFUSED: 'refused',
  /** A deny rule takes the tool out of the model's list, so there is no call. */
  HIDDEN: 'hidden',
} as const;
type Outcome = (typeof Outcomes)[keyof typeof Outcomes];

/**
 * The outcome each cell should have. A deny rule hides the tool in every mode,
 * and an ask rule refuses it in every mode, `bypassPermissions` and `auto`
 * included. Plan mode refuses it even with an allow rule. Without a rule, only
 * `bypassPermissions` and the `auto` mode classifier let it through.
 */
function expected(mode: Mode, rule: Rule): Outcome {
  if (rule === 'deny') return Outcomes.HIDDEN;
  if (rule === 'ask' || mode === 'plan') return Outcomes.REFUSED;
  if (rule === 'allow' || mode === 'bypassPermissions' || mode === 'auto') return Outcomes.WRITTEN;
  return Outcomes.REFUSED;
}

/**
 * The mod answers the write tool's calls itself, so no permission check runs
 * and the entry is written in every cell where the tool is offered. The cells
 * where that differs from the normal check are marked to fail, so the suite
 * stays green now and fails as soon as Claude Code runs the check.
 *
 * Workaround for anthropics/claude-code#104217, tracked in zirkelc/issues#22.
 * Remove both when the fix is adopted.
 */
const isBrokenByCore = (mode: Mode, rule: Rule): boolean => expected(mode, rule) === Outcomes.REFUSED;

/**
 * Only the auto mode classifier decides the `auto` cell without a rule. A
 * model's judgment is no stable result for CI, so that cell runs locally only.
 */
const isClassifierCell = (mode: Mode, rule: Rule): boolean => mode === 'auto' && rule === 'none';

/**
 * The tools a model could write an entry with when the mod's tool is refused or
 * hidden. Denied, so that only the mod's tool can write. `--tools ""` would also
 * take the mod's tool away.
 */
const FALLBACK_TOOLS = ['Bash', 'Write', 'Edit', 'NotebookEdit', 'ExitPlanMode', 'Agent'];

const PROMPT = `Call the tool ${WRITE_TOOL} once, now, with the summary "Permission matrix test." and the body "Written by the permission test." Do not use any other tool. Then reply with only DONE.`;

type Ran = { denials: Array<string>; entries: Array<string> };

/** One headless session in a mode with one rule for the write tool, and what it left. */
async function run(mode: Mode, rule: Rule): Promise<Ran> {
  const session = setup();
  const settings = rule === 'none' ? {} : { permissions: { [rule]: [WRITE_TOOL] } };
  const args = [
    '-p',
    PROMPT,
    '--output-format',
    'json',
    '--model',
    'haiku',
    '--plugin-dir',
    join(ROOT, 'claude-code'),
    '--no-session-persistence',
    '--max-turns',
    '4',
    '--permission-mode',
    mode,
    '--settings',
    JSON.stringify(settings),
    ...ISOLATED_ARGS,
    '--disallowedTools',
    ...FALLBACK_TOOLS,
  ];
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn('claude', args, { cwd: session.work, env: session.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    const timer = setTimeout(() => child.kill(), SESSION_TIMEOUT_MS);
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      if (status === 0) resolve(out);
      else reject(new Error(`claude exited ${status}: ${err || out}`));
    });
  });
  const parsed = JSON.parse(stdout) as { permission_denials?: Array<{ tool_name: string }> };
  const entries = existsSync(session.journal)
    ? readdirSync(session.journal, { recursive: true, encoding: 'utf8' }).filter((path) => path.endsWith('.md'))
    : [];
  return { denials: (parsed.permission_denials ?? []).map((denial) => denial.tool_name), entries };
}

afterAll(removeLeftovers);

/**
 * The mod's write tool in a real session, in each permission mode with each
 * kind of rule for it. Headless, so a call that would ask is refused. Locally
 * with `pnpm test:integration`. In CI it runs in the job without the guard
 * only, since the guard changes how the rules arrive, not the permission check.
 */
describe.skipIf(process.env.AGENT_JOURNAL_EXPECT_GUARD === 'true')('the write tool under each permission', () => {
  const cells = MODES.flatMap((mode) => RULES.map((rule) => ({ mode, rule })));

  for (const { mode, rule } of cells) {
    const outcome = expected(mode, rule);
    const ruleName = { none: 'no rule', allow: 'an allow rule', ask: 'an ask rule', deny: 'a deny rule' }[rule];
    const name = `should be ${outcome} in ${mode} mode with ${ruleName}`;
    const isSkipped = isClassifierCell(mode, rule) && process.env.CI !== undefined;
    const declare = isSkipped ? test.skip : isBrokenByCore(mode, rule) ? test.concurrent.fails : test.concurrent;

    declare(
      name,
      async () => {
        // Act
        const ran = await run(mode, rule);

        // Assert
        if (outcome === Outcomes.WRITTEN) {
          expect(ran.entries.length).toBe(1);
        } else if (outcome === Outcomes.REFUSED) {
          expect(ran.denials).toContain(WRITE_TOOL);
          expect(ran.entries.length).toBe(0);
        } else {
          expect(ran.denials).toEqual([]);
          expect(ran.entries.length).toBe(0);
        }
      },
      SESSION_TIMEOUT_MS,
    );
  }
});
