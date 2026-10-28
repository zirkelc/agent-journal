import type { ToolSpec } from 'claude-code';
import { BY_FIELDS, DEFAULT_LIMIT, MAX_LIMIT } from './cli.js';
import { TOOL_LIST, TOOL_READ, TOOL_WRITE } from './names.js';

/** How the agent's last line starts, the one that names the entries it used. */
export const SOURCES_PREFIX = 'Sources:';

/** Which entries a question is about when it names no project. */
export type Scope = 'project' | 'all';

/** The scope the pane opens on until the person picks another: the current project's entries. */
export const DEFAULT_SCOPE: Scope = 'project';

/** A stored value that is no longer a scope counts as the default. */
export const scopeOf = (value: unknown): Scope => (value === 'all' ? 'all' : DEFAULT_SCOPE);

/** The model a question goes to: one by its alias, or `inherit` for the session's own. */
export type SearchModel = 'haiku' | 'sonnet' | 'opus' | 'inherit';

/** The models the Ask view offers, in its order. */
export const SEARCH_MODELS: ReadonlyArray<SearchModel> = ['haiku', 'sonnet', 'opus', 'inherit'];

/** Fast enough for a few list and read calls, and the cheapest. */
export const DEFAULT_SEARCH_MODEL: SearchModel = 'haiku';

/** A stored value that is no longer one of the models counts as the default. */
export const searchModelOf = (value: unknown): SearchModel =>
  SEARCH_MODELS.find((model) => model === value) ?? DEFAULT_SEARCH_MODEL;

/**
 * The agent's whole system prompt. It holds only what never changes: the clock,
 * the journal and the session arrive with each question, from the CLI.
 */
export const AGENT_PROMPT = [
  'You answer one question about past work from the user’s journal, then stop.',
  '',
  `You can only read the journal, with two tools: \`${TOOL_LIST}\` lists, searches or counts entries, and \`${TOOL_READ}\` returns entries in full. Each takes the filters the question’s context describes. For \`since\` and \`until\`, a value of a \`_since\` or \`_until\` key of the clock block works as it is (for today, \`local_today_since\` and \`local_today_until\`).`,
  '',
  'Answer in Markdown, short: a few sentences or a short list, the most relevant first. Describe the work, not the entries: no entry ids, dates as the reader says them (Monday, 1 October). When nothing in the journal answers the question, say so, and do not guess.',
  '',
  `End with one last line, \`${SOURCES_PREFIX} \` followed by the id of every entry you used, comma-separated (\`${SOURCES_PREFIX} 2026-01-11T143000Z, 2026-01-12T091500Z\`). The reader shows those entries as a list of sources under the answer, so the answer itself does not need to name them.`,
].join('\n');

const SCOPE_TEXT: Record<Scope, string> = {
  project:
    'Unless the question names another project, only the current project’s entries count: pass `project` `.` to the tools.',
  all: 'Unless the question names a project, entries of every project count.',
};

/** One earlier question and answer of the chat, as a follow-up carries it. */
export type Exchange = { question: string; answer: string };

/**
 * The first message of one search: the CLI's text for a reader, the scope, the
 * chat so far, and the question.
 */
export function questionPrompt(
  recall: string,
  scope: Scope,
  earlier: ReadonlyArray<Exchange>,
  question: string,
): string {
  const parts = [recall.trim(), '', '## Question', '', SCOPE_TEXT[scope]];
  if (earlier.length > 0) {
    parts.push('', 'The question follows up on this conversation:');
    for (const exchange of earlier) parts.push('', `Q: ${exchange.question}`, '', `A: ${exchange.answer}`);
  }
  parts.push('', question.trim());
  return parts.join('\n');
}

const FILTERS = {
  date: {
    type: 'string',
    description: 'One local year, month or day: 2026, 2026-01, 2026-01-11, today or yesterday.',
  },
  since: {
    type: 'string',
    description:
      'From this local day or time on: a day (2026-01-11), today, a number of days back (7d), or a time with an offset.',
  },
  until: {
    type: 'string',
    description: 'Up to and including this local day or time, in the same forms as since.',
  },
  project: {
    type: 'string',
    description: 'Only entries filed under this project. "." is the current project.',
  },
  cwd: {
    type: 'string',
    description:
      'Only entries from this directory (~/Developer/my-lib) and the directories under it. * and ? match within one name of the path.',
  },
  host: {
    type: 'string',
    description: 'Only entries written on this machine (my-laptop). * and ? work as in a shell glob.',
  },
  user: {
    type: 'string',
    description: 'Only entries written by this account (me). * and ? work as in a shell glob.',
  },
  agent: {
    type: 'string',
    description:
      'Only entries of one agent (claude), of one model (claude-opus-5-5), or of both (claude/claude-opus-5-5). * and ? work as in a shell glob.',
  },
  limit: {
    type: 'integer',
    minimum: 1,
    maximum: MAX_LIMIT,
    description: `How many of the most recent matches to give. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.`,
  },
  offset: {
    type: 'integer',
    minimum: 0,
    description: 'Skip this many of the most recent matches first, for the next page.',
  },
};

/** The tools that read the journal, as the model reads them. */
export const TOOL_SPECS: ReadonlyArray<ToolSpec> = [
  {
    name: TOOL_LIST,
    description:
      'Lists journal entries, oldest first: one line each with id, project and summary, separated by tabs. With terms, it searches the summaries and the bodies, and each line ends with the body line that matched (empty when the summary matched). A last line says which offset gives the older matches that the limit left out. With by, it lists no entries but counts every match for each value of that field, one line each with the count and the value, and a last line with the total: use it for any count, and never count the lines of a list yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        terms: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Search terms. Each is an extended regex, as grep -E reads it, matched within one line and ignoring case. An entry must match every term: ["gif|vhs"] finds either word, ["codex", "trust"] finds both.',
        },
        fixed: { type: 'boolean', description: 'Read the terms as plain text, not as a regex.' },
        ...FILTERS,
        by: {
          type: 'string',
          enum: [...BY_FIELDS],
          description:
            'Count the matches for each value of this field instead of listing them: project, date (the local day), host, user or agent. Every match counts, so it takes no limit or offset.',
        },
      },
    },
  },
  {
    name: TOOL_READ,
    description:
      'Returns journal entries in full, frontmatter and body, separated by a blank line: the latest entry, entries by id, or every entry of a period, oldest first. A period too long for one result gives the summaries of its entries instead, to read by id.',
    inputSchema: {
      type: 'object',
      properties: {
        which: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description:
            'One of: ["latest"]; one or more entry ids, each whole or a prefix that matches one entry; or one local period: ["today"], ["yesterday"], ["2026"], ["2026-10"] or ["2026-10-22"].',
        },
        project: FILTERS.project,
        cwd: FILTERS.cwd,
        host: FILTERS.host,
        user: FILTERS.user,
        agent: FILTERS.agent,
        limit: {
          type: 'integer',
          minimum: 1,
          description:
            'For a period: only the most recent entries, this many. Without it, a period gives all its entries.',
        },
        offset: {
          type: 'integer',
          minimum: 0,
          description: 'For a period: skip this many of the most recent entries first, for the next page.',
        },
      },
      required: ['which'],
    },
  },
];

/**
 * The tool the main conversation writes an entry with. It takes only what the
 * model knows: the date, the project, the directory, the host, the user and the session come from
 * the CLI and the session.
 */
export const WRITE_SPEC: ToolSpec = {
  name: TOOL_WRITE,
  description:
    'Writes one new journal entry for this session and answers with its id. The date, project, directory, host, user, agent and session are filled in.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          'One line, at most 200 characters, without double quotes: what happened and what it means, never a topic tag.',
      },
      body: {
        type: 'string',
        description: 'Markdown: what was decided, what was rejected and why, what is still open.',
      },
    },
    required: ['summary', 'body'],
  },
};
