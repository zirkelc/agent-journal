/** The plugin's name, as its manifest declares it. */
export const PLUGIN = 'agent-journal';

/** The pane's id, and the slash command that opens it. */
export const PANE_ID = 'journal';
export const PANE_TITLE = 'Journal';
export const COMMAND = 'journal';
export const COMMAND_DESCRIPTION = 'Open the journal, or ask it a question: /journal what did we fix last week?';

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
