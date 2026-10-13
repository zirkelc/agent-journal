import type { ToolSpec } from 'claude-code';
import { AGENT_NAME, AGENT_TOOLS, DENIED_TOOLS, TOOL_LIST, TOOL_READ, TOOL_SEARCH } from './names.js';

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

/** Fast enough for a few list and search calls, and the cheapest. */
export const DEFAULT_SEARCH_MODEL: SearchModel = 'haiku';

/** A stored value that is no longer one of the models counts as the default. */
export const searchModelOf = (value: unknown): SearchModel =>
  SEARCH_MODELS.find((model) => model === value) ?? DEFAULT_SEARCH_MODEL;

/**
 * The agent's whole system prompt. It holds only what never changes: the clock,
 * the journal and the session arrive with each question, from the CLI.
 */
const SYSTEM_PROMPT = [
  'You answer one question about past work from the user’s journal, then stop.',
  '',
  `You can only read the journal, with three tools: \`${TOOL_LIST}\` lists entries by date and project, \`${TOOL_SEARCH}\` finds a text in summaries and bodies, \`${TOOL_READ}\` returns one entry in full. Each takes the same filters the question’s context describes.`,
  '',
  'Answer in Markdown, short: a few sentences or a short list, the most relevant first. Describe the work, not the entries: no entry ids, dates as the reader says them (Monday, 1 October). When nothing in the journal answers the question, say so, and do not guess.',
  '',
  `End with one last line, \`${SOURCES_PREFIX} \` followed by the id of every entry you used, comma-separated (\`${SOURCES_PREFIX} 2026-01-11T143000Z, 2026-01-12T091500Z\`). The reader shows those entries as a list of sources under the answer, so the answer itself does not need to name them.`,
].join('\n');

/**
 * The agent type, registered once per load. It runs on the session's model
 * unless a question names another, so the model can change between questions.
 */
export const agentSpec = () => ({
  name: AGENT_NAME,
  description: 'Answers a question about past work from the agent journal. Started only by /journal.',
  prompt: SYSTEM_PROMPT,
  tools: AGENT_TOOLS,
  disallowedTools: DENIED_TOOLS,
  omitClaudeMd: true as const,
  model: 'inherit',
  maxTurns: 12,
});

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
  since: {
    type: 'string',
    description:
      'From this point on: the value of a `_since` key of the clock block as it is (for today, `local_today_since`), a local day (YYYY-MM-DD), today, or a number of days back (7d).',
  },
  until: {
    type: 'string',
    description:
      'Up to and including this point: the value of an `_until` key of the clock block as it is (for today, `local_today_until`), or a local day, today, or a number of days back, as for since.',
  },
  project: {
    type: 'string',
    description: 'Only entries filed under this project. "." is the current project.',
  },
  limit: {
    type: 'integer',
    description: 'How many of the most recent matches to return. Default 50, at most 200.',
  },
};

/** The three tools, as the model reads them. */
export const TOOL_SPECS: ReadonlyArray<ToolSpec> = [
  {
    name: TOOL_LIST,
    description: 'Lists journal entries, oldest first: one line each with id, project and summary, separated by tabs.',
    inputSchema: { type: 'object', properties: FILTERS },
  },
  {
    name: TOOL_SEARCH,
    description:
      'Finds journal entries whose summary or body contains a text, ignoring case. One line each with id, project and summary.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The text to look for.' }, ...FILTERS },
      required: ['text'],
    },
  },
  {
    name: TOOL_READ,
    description: 'Returns one journal entry in full, frontmatter and body.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The entry id, for example 2026-01-11T143000Z.' } },
      required: ['id'],
    },
  },
];
