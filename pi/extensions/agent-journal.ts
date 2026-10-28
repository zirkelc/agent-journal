import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExecResult, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import {
  capped,
  DEFAULT_LIMIT,
  fitList,
  isCut,
  isPeriod,
  isToolsOn,
  MAX_LIMIT,
  MAX_OUTPUT,
  summaryProblem,
  TOOLS_ENV,
  withNote,
  withOlder,
} from '../lib/tools.ts';

/**
 * The Pi extension of Agent Journal.
 *
 * It gives the model three tools that write and read the journal, and it adds
 * the rules for them to the system prompt of each run. With the tools turned
 * off, the rules tell the model to write and read the entries as files with
 * its own tools instead. Pi builds the system
 * prompt again for each run, so the rules stay after a compaction, a `/new`, a
 * `/resume` or a `/fork`, and the extension does not need to find them in the
 * conversation.
 *
 * When git sync is on, it syncs the journal when the session starts, after
 * each entry that the write tool makes, and once more when the session ends.
 *
 * It runs one program, the `agent-journal` script in this package, and never
 * an `agent-journal` from `PATH`.
 */

/** The CLI in this package, next to this folder. */
export const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'agent-journal');

/** What each tool name starts with. The rules name the tools with it. */
export const TOOL_PREFIX = 'journal_';
export const TOOL_WRITE = `${TOOL_PREFIX}write`;
export const TOOL_LIST = `${TOOL_PREFIX}list`;
export const TOOL_READ = `${TOOL_PREFIX}read`;

/** The name of the system prompt section with the rules. Pi puts the section in a tag with this name. */
export const SECTION = 'agent_journal';

/** The status key in the footer, which shows only a failed sync. */
export const STATUS_KEY = 'agent-journal';

/** Long enough for the commands that only read files and run `git rev-parse`. */
const READ_TIMEOUT_MS = 10_000;

/** Long enough for a push over a slow network, short enough to stop a push that hangs. */
const SYNC_TIMEOUT_MS = 60_000;

/** How long the end of a session waits for its sync. A push that it stops is made by the next sync. */
export const END_SYNC_TIMEOUT_MS = 5_000;

/** The exit code of a `sync` that made the commit, or had none to make, but could not pull or push. */
const SYNC_REMOTE_FAILED = 3;

/** The limits and the output of the journal tools, which the Claude Code plugin shares. */
export { capped, DEFAULT_LIMIT, fitList, isCut, isToolsOn, MAX_LIMIT, MAX_OUTPUT, TOOLS_ENV, withNote, withOlder };

const FILTERS = {
  date: Type.Optional(
    Type.String({ description: 'One local year, month or day: 2026, 2026-01, 2026-01-11, today or yesterday.' }),
  ),
  since: Type.Optional(
    Type.String({
      description:
        'From this local day or time on: a day (2026-01-11), today, a number of days back (7d), or a time with an offset.',
    }),
  ),
  until: Type.Optional(
    Type.String({ description: 'Up to and including this local day or time, in the same forms as since.' }),
  ),
  project: Type.Optional(
    Type.String({ description: 'Only entries filed under this project. "." is the current project.' }),
  ),
  cwd: Type.Optional(
    Type.String({
      description:
        'Only entries from this directory (~/Developer/my-lib) and the directories under it. * and ? match within one name of the path.',
    }),
  ),
  host: Type.Optional(
    Type.String({ description: 'Only entries written on this machine (my-laptop). * and ? work as in a shell glob.' }),
  ),
  user: Type.Optional(
    Type.String({ description: 'Only entries written by this account (me). * and ? work as in a shell glob.' }),
  ),
  agent: Type.Optional(
    Type.String({
      description:
        'Only entries of one agent (claude), of one model (claude-opus-5-5), or of both (claude/claude-opus-5-5). * and ? work as in a shell glob.',
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_LIMIT,
      description: `How many of the most recent matches to give. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.`,
    }),
  ),
  offset: Type.Optional(
    Type.Integer({ minimum: 0, description: 'Skip this many of the most recent matches first, for the next page.' }),
  ),
};

/** The fields that the list tool can count the matches by. */
export const BY_FIELDS = ['project', 'date', 'host', 'user', 'agent'] as const;
type ByField = (typeof BY_FIELDS)[number];

type Filters = {
  date?: string;
  since?: string;
  until?: string;
  project?: string;
  cwd?: string;
  host?: string;
  user?: string;
  agent?: string;
  limit?: number;
  offset?: number;
  by?: ByField;
};

/** The filters that name who and where, which `read` takes for a period as `list` does, in the order the help lists them. */
const SCOPE_FILTERS = ['project', 'cwd', 'host', 'user', 'agent'] as const;

/** The CLI flags of the filters that name who and where. */
function scopeArgs(filters: Filters): Array<string> {
  return SCOPE_FILTERS.flatMap((key) => {
    const value = filters[key]?.trim();
    return value ? [`--${key}`, value] : [];
  });
}

/** The CLI flags of the filters that the model gave. */
export function filterArgs(filters: Filters): Array<string> {
  const args: Array<string> = [];
  for (const key of ['date', 'since', 'until'] as const) {
    const value = filters[key]?.trim();
    if (value) args.push(`--${key}`, value);
  }
  args.push(...scopeArgs(filters));
  /** A count reads every match, so it takes no page: the CLI refuses a limit or an offset with it. */
  if (filters.by) {
    if (filters.limit || filters.offset) throw new Error('by counts every match, so leave out limit and offset.');
    args.push('--by', filters.by);
    return args;
  }
  args.push('--limit', String(Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT)));
  if (filters.offset) args.push('--offset', String(filters.offset));
  return args;
}

/** The first line of a text, or an empty string. */
const firstLine = (text: string): string => text.trim().split('\n')[0] ?? '';

/** A tool result with one text. */
const textResult = (text: string) => ({ content: [{ type: 'text' as const, text }], details: undefined });

type JournalConfig = { journalDir: string | null; isSyncOn: boolean };

export default function agentJournal(pi: ExtensionAPI) {
  /** Read once, when Pi loads the extension, since the tools are registered then. */
  const hasTools = isToolsOn(process.env[TOOLS_ENV]);
  /** The rules for this session, or null when the session gets none. */
  let rules: string | null = null;
  /** Read once a session: a change to the config takes effect in the next session, as the rules do. */
  let config: Promise<JournalConfig> | null = null;
  /** The UI of the session, for the sync status. */
  let ui: ExtensionContext['ui'] | null = null;
  let running: Promise<void> | null = null;
  let isPending = false;
  /** Whether the next sync pulls before it pushes. */
  let isPull = true;

  const cli = (args: Array<string>, cwd: string, timeout: number): Promise<ExecResult | null> =>
    pi.exec(CLI, args, { cwd, timeout }).catch(() => null);

  /** Pi ends a run at its timeout with a signal, which leaves no exit code, and reports it as code 0. */
  const isDone = (run: ExecResult | null): run is ExecResult => run !== null && !run.killed && run.code === 0;

  /** The agent and its model, as an entry records them. */
  const agentOf = (ctx: ExtensionContext): string => (ctx.model ? `pi/${ctx.model.id}` : 'pi');

  /**
   * A CLI run for a tool. A run that failed throws, so Pi gives the model a
   * failed result. An exit code in `allowed` is an answer, not a failure.
   */
  async function runTool(args: Array<string>, ctx: ExtensionContext, allowed: Array<number> = []): Promise<ExecResult> {
    const run = await cli(args, ctx.cwd, READ_TIMEOUT_MS);
    if (!run) throw new Error('agent-journal did not run');
    if (run.killed) throw new Error('agent-journal did not finish in time');
    if (run.code !== 0 && !allowed.includes(run.code)) {
      throw new Error(firstLine(run.stderr) || `agent-journal exited with ${run.code}`);
    }
    return run;
  }

  function readConfig(cwd: string): Promise<JournalConfig> {
    config ??= cli(['config'], cwd, READ_TIMEOUT_MS).then((run) => {
      if (!isDone(run)) {
        /** Try again next time. */
        config = null;
        return { journalDir: null, isSyncOn: false };
      }
      return {
        journalDir: /^journal_dir=(.+)$/m.exec(run.stdout)?.[1] ?? null,
        isSyncOn: /^sync=git$/m.test(run.stdout),
      };
    });
    return config;
  }

  /** Shows a failed sync in the footer, and removes it after a sync that did not fail. */
  function showSync(run: ExecResult | null): void {
    if (!ui) return;
    if (run && !run.killed && run.code === 0) return ui.setStatus(STATUS_KEY, undefined);
    const reason = !run
      ? 'did not run'
      : run.killed
        ? 'did not finish'
        : run.code === SYNC_REMOTE_FAILED && firstLine(run.stdout) !== ''
          ? firstLine(run.stdout)
          : firstLine(run.stderr) || `exited with ${run.code}`;
    ui.setStatus(STATUS_KEY, `journal sync failed: ${reason}`);
  }

  /**
   * One sync at a time. A sync that is requested while one runs starts when
   * that one ends, so the last write is always in a sync that started after it.
   * Without `pull`, the sync pulls only when its push is rejected. A sync that
   * waits pulls first when any of its callers asked for the pull.
   */
  function sync(cwd: string, timeout = SYNC_TIMEOUT_MS, pull = true): Promise<void> {
    if (running) {
      isPull = isPending ? isPull || pull : pull;
      isPending = true;
      return running;
    }
    isPull = pull;
    running = (async () => {
      do {
        isPending = false;
        showSync(await cli(isPull ? ['sync'] : ['sync', '--no-pull'], cwd, timeout));
      } while (isPending);
    })().finally(() => {
      running = null;
    });
    return running;
  }

  if (hasTools) {
    /**
     * The annotations tell a permission extension what each tool does. Pi itself
     * asks for no approval. The write tool only adds a file, so it is not
     * destructive, and none of the tools reaches the network.
     */
    pi.registerTool({
      name: TOOL_WRITE,
      label: 'Journal write',
      description:
        'Writes one new journal entry for this session and answers with its id. The date, project, directory, host, user, agent and session are filled in.',
      promptSnippet: 'Write one journal entry for this session',
      parameters: Type.Object({
        summary: Type.String({
          description:
            'One line, at most 200 characters, without double quotes: what happened and what it means, never a topic tag.',
        }),
        body: Type.String({
          description: 'Markdown: what was decided, what was rejected and why, what is still open.',
        }),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const summary = params.summary.trim();
        const problem = summaryProblem(summary);
        if (problem) throw new Error(problem);
        const args = ['write', `--summary=${summary}`, `--body=${params.body.trim()}`, '--cwd', ctx.cwd];
        const sessionId = ctx.sessionManager.getSessionId();
        if (sessionId) args.push('--session-id', sessionId);
        args.push('--agent', agentOf(ctx), '--no-sync');
        const path = (await runTool(args, ctx)).stdout.trim().split('\n').at(-1) ?? '';
        /** The push runs in the background, so the turn does not wait for it. */
        void readConfig(ctx.cwd).then(({ isSyncOn }) => (isSyncOn ? sync(ctx.cwd) : undefined));
        return textResult(`Wrote the journal entry ${basename(path, '.md')}.`);
      },
    });

    pi.registerTool({
      name: TOOL_LIST,
      label: 'Journal list',
      description:
        'Lists journal entries, oldest first: one line each with id, project and summary, separated by tabs. With terms, it searches the summaries and the bodies, and each line ends with the body line that matched (empty when the summary matched). A last line says which offset gives the older matches that the limit left out. With by, it lists no entries but counts every match for each value of that field, one line each with the count and the value, and a last line with the total: use it for any count, and never count the lines of a list yourself.',
      promptSnippet: 'List or search journal entries by text, date and project',
      parameters: Type.Object({
        terms: Type.Optional(
          Type.Array(Type.String(), {
            description:
              'Search terms. Each is an extended regex, as grep -E reads it, matched within one line and ignoring case. An entry must match every term: ["gif|vhs"] finds either word, ["codex", "trust"] finds both.',
          }),
        ),
        fixed: Type.Optional(Type.Boolean({ description: 'Read the terms as plain text, not as a regex.' })),
        ...FILTERS,
        by: Type.Optional(
          Type.Unsafe<ByField>({
            type: 'string',
            enum: [...BY_FIELDS],
            description:
              'Count the matches for each value of this field instead of listing them: project, date (the local day), host, user or agent. Every match counts, so it takes no limit or offset.',
          }),
        ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const terms = (params.terms ?? []).map((term) => term.trim()).filter((term) => term !== '');
        /** The CLI would read such a term as an option. */
        const dashed = terms.find((term) => term.startsWith('-'));
        if (dashed) throw new Error(`A term cannot start with "-": ${dashed}. Write [-] for the dash.`);
        const args = ['list', ...terms, ...(params.fixed ? ['--fixed'] : []), ...filterArgs(params)];
        const run = await runTool(args, ctx);
        if (params.by) return textResult(capped(withNote(run.stdout, run.stderr)));
        const text = fitList(run.stdout, run.stderr, params.offset) ?? withNote(run.stdout, run.stderr);
        if (!isCut(text)) return textResult(capped(text || 'No entries match.'));
        /** The same list counted by day, for the note on what the cut left out. Without the count, the short note stays. */
        const counted = await runTool(
          [
            'list',
            ...terms,
            ...(params.fixed ? ['--fixed'] : []),
            ...filterArgs({ ...params, limit: undefined, offset: undefined, by: 'date' }),
          ],
          ctx,
        ).catch(() => null);
        return textResult(capped(counted ? withOlder(text, counted.stdout) : text));
      },
    });

    pi.registerTool({
      name: TOOL_READ,
      label: 'Journal read',
      description:
        'Returns journal entries in full, frontmatter and body, separated by a blank line: the latest entry, entries by id, or every entry of a period, oldest first. A period too long for one result gives the summaries of its entries instead, to read by id.',
      promptSnippet: 'Read journal entries in full, by id or by period',
      parameters: Type.Object({
        which: Type.Array(Type.String(), {
          minItems: 1,
          description:
            'One of: ["latest"]; one or more entry ids, each whole or a prefix that matches one entry; or one local period: ["today"], ["yesterday"], ["2026"], ["2026-10"] or ["2026-10-22"].',
        }),
        project: FILTERS.project,
        cwd: FILTERS.cwd,
        host: FILTERS.host,
        user: FILTERS.user,
        agent: FILTERS.agent,
        limit: Type.Optional(
          Type.Integer({
            minimum: 1,
            description:
              'For a period: only the most recent entries, this many. Without it, a period gives all its entries.',
          }),
        ),
        offset: Type.Optional(
          Type.Integer({
            minimum: 0,
            description: 'For a period: skip this many of the most recent entries first, for the next page.',
          }),
        ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const which = params.which.map((item) => item.trim());
        const period = which.length === 1 && isPeriod(which[0]!) ? which[0]! : '';
        /** Only a period takes the filters and a page: the CLI refuses them with anything else. */
        const args = ['read', ...which];
        if (period) {
          args.push(...scopeArgs(params));
          if (params.limit) args.push('--limit', String(params.limit));
          if (params.offset) args.push('--offset', String(params.offset));
        }
        /**
         * Exit 1 is an answer: nothing matches, or an id prefix matches several
         * entries, whose ids the model needs to read the one it means.
         */
        const run = await runTool(args, ctx, [1]);
        if (run.code === 1) return textResult(capped(run.stderr.trim() || 'No entries match.'));
        const text = withNote(run.stdout, run.stderr);
        if (text.length <= MAX_OUTPUT || !period) return textResult(capped(text));
        /** Cut text would lose the last entries without a word, so a long period gives the summaries of the same page instead. */
        const { project, cwd, host, user, agent, limit, offset } = params;
        const list = await runTool(
          ['list', ...filterArgs({ date: period, project, cwd, host, user, agent, limit: limit ?? MAX_LIMIT, offset })],
          ctx,
        );
        const cut = fitList(list.stdout, list.stderr, offset) ?? withNote(list.stdout, list.stderr);
        /** The same period counted by day, for the note on what the cap left out, as a list gives it. Without the count, the short note stays. */
        const counted = isCut(cut)
          ? await runTool(
              ['list', ...filterArgs({ date: period, project, cwd, host, user, agent, by: 'date' })],
              ctx,
            ).catch(() => null)
          : null;
        const summaries = counted ? withOlder(cut, counted.stdout) : cut;
        return textResult(
          capped(
            `The entries of ${period} are ${text.length} characters, more than one result holds. Their summaries follow; read the ones you need by id.\n${summaries}`,
          ),
        );
      },
    });
  }

  /**
   * Only a session with a UI gets the rules and keeps the tools. A subagent
   * that runs as a `pi` process in print or JSON mode gets neither, because
   * only the main conversation writes entries. The rules for the tools name no
   * value of the session, because the write tool sets them. The rules without
   * the tools name the session id and the agent, for the model to copy into
   * the entry, so they keep the model that the session started with.
   */
  pi.on('session_start', async (_event, ctx) => {
    ui = ctx.hasUI ? ctx.ui : null;
    /** Read now, so the first write does not wait for it. */
    const read = readConfig(ctx.cwd);
    if (!ctx.hasUI) {
      pi.setActiveTools(pi.getActiveTools().filter((name) => !name.startsWith(TOOL_PREFIX)));
      return;
    }
    /** Pulls the entries of the other machines. Not awaited, so the session does not wait for the network. */
    void read.then(({ isSyncOn }) => (isSyncOn ? sync(ctx.cwd) : undefined));
    /** The rules for the tools only when the session can call them: `--tools` or another extension can leave them out. */
    const active = pi.getActiveTools();
    const canCall = hasTools && [TOOL_WRITE, TOOL_LIST, TOOL_READ].every((name) => active.includes(name));
    /** Both variants name the session: the rules for files to copy into an entry, the rules for the tools as the values of the filters. */
    const args = ['context', '--cwd', ctx.cwd];
    const sessionId = ctx.sessionManager.getSessionId();
    if (sessionId) args.push('--session-id', sessionId);
    // The model the session starts with. After a switch of the model, the write tool records the new one, while the rules keep this one, which is still correct enough for a filter.
    args.push('--agent', agentOf(ctx));
    if (canCall) args.push('--tools', TOOL_PREFIX);
    const run = await cli(args, ctx.cwd, READ_TIMEOUT_MS);
    const made = isDone(run) ? run.stdout.trim() : '';
    rules = made === '' ? null : made;
  });

  /**
   * Pi 1.0 and later build the system prompt from named sections, and send only
   * a changed section again. An older Pi has no sections, so the rules go at the
   * end of its system prompt.
   */
  pi.on('before_agent_start', (event) => {
    if (!rules) return;
    const sections: Record<string, string> | undefined = (
      event.systemPromptOptions as { sections?: Record<string, string> } | undefined
    )?.sections;
    if (sections) {
      sections[SECTION] = rules;
      return;
    }
    return { systemPrompt: `${event.systemPrompt}\n\n${rules}` };
  });

  /**
   * The last sync, also for entries that were written another way than the
   * write tool. The exit waits for it, but not longer than END_SYNC_TIMEOUT_MS.
   * It does not pull first, because the next session's start pulls anyway.
   */
  pi.on('session_shutdown', async (_event, ctx) => {
    const { isSyncOn } = await readConfig(ctx.cwd);
    if (!isSyncOn) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((done) => {
      timer = setTimeout(done, END_SYNC_TIMEOUT_MS);
    });
    await Promise.race([sync(ctx.cwd, END_SYNC_TIMEOUT_MS, false), timeout]);
    clearTimeout(timer);
  });
}
