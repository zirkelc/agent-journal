/** The plugin's name, as its manifest declares it. */
export const PLUGIN = 'agent-journal';

/** The pane's id and title, and the slash command that opens it. */
export const PANE_ID = 'journal';
export const PANE_TITLE = 'Journal';
export const COMMAND = 'agent-journal';

/**
 * Whether the pane answers questions about the journal (its Ask view, and
 * `/agent-journal <question>`), with the search agent and its three tools.
 *
 * Off for now, because the Claude Code plugin directory does not list a mod
 * whose permission hook answers `allow`, and without one the search cannot
 * run in auto mode. The auto mode classifier denies a spawn that no model
 * response asked for, and Claude Code ignores an allow rule for the agent
 * there (it would bypass the classifier). In the other modes the three tools
 * ask the person each time unless they allow them. The code stays, and a
 * later version may answer from the main conversation or with plain model
 * calls instead of an agent.
 */
export const IS_ASK_ON: boolean = false;

export const COMMAND_DESCRIPTION = IS_ASK_ON
  ? 'Open the journal, or ask it a question: /agent-journal what did we fix last week?'
  : 'Open the journal';

/** The search agent: its short name, and the type the engine lists it under. */
export const AGENT_NAME = 'search';
export const AGENT_TYPE = `${PLUGIN}:${AGENT_NAME}`;

/** The tools the search agent reads the journal with, by short name. */
export const TOOL_LIST = 'list';
export const TOOL_SEARCH = 'search';
export const TOOL_READ = 'read';

/** A short tool name as the model calls it. */
export const toolName = (name: string): string => `mcp__${PLUGIN}__${name}`;

/** Every tool name the search agent may call, and nothing else. */
export const AGENT_TOOLS: ReadonlyArray<string> = [toolName(TOOL_LIST), toolName(TOOL_SEARCH), toolName(TOOL_READ)];

/** What the agent must never have, whatever it inherits. */
export const DENIED_TOOLS: ReadonlyArray<string> = ['Write', 'Edit', 'NotebookEdit', 'Bash'];

/** The executable on `PATH`, where the installer links it. */
export const CLI_ON_PATH = 'agent-journal';

/** The CLI the plugin ships, relative to its root. */
export const CLI_IN_CHECKOUT = 'bin/agent-journal';

/**
 * The mark the rules' row opens with, which says the conversation holds them.
 * A comment of the mod's own, not a sentence of the rules: those are quoted,
 * pasted and read in this very repository without the rules being there.
 */
export const RULES_MARK = '<!-- agent-journal rules -->';
