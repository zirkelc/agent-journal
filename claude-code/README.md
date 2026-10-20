# Agent Journal for Claude Code

This folder is the Claude Code plugin of [Agent Journal](../README.md). It is a [hooks module](https://code.claude.com/docs/en/plugins/mods/overview) that Claude Code loads itself. The plugin gives each session the rules for writing the journal, opens the journal pane with `/agent-journal`, and syncs the journal with git when you turn sync on.

## Install

The plugin needs Claude Code 2.1.287 or later. Install it:

```
/plugin marketplace add zirkelc/agent-plugins
/plugin install agent-journal@zirkelc
```

Then open a new session and ask Claude to write a journal entry. By default, it writes to the directory `~/agent-journal/`. To use a different directory, see [Configuration](../README.md#configuration).

## Update

Get the latest marketplace catalog, then update the plugin:

```sh
claude plugin marketplace update zirkelc
claude plugin update agent-journal@zirkelc
```

Then restart Claude Code or run `/reload-plugins` to load the new version.

## Permissions

Depending on your permission mode, Claude asks for permission to write a journal entry. To allow all journal entries, add this to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["Edit(~/agent-journal/**)"]
  }
}
```

If you changed `journal_dir`, use that directory in the rule.

## Hooks

The plugin gives the rules for writing the journal to the main conversation as a hidden message. It does this when the session starts, and again after `/clear` or a compaction. Subagents do not get them, so only the main conversation writes entries.

On a Team or Enterprise plan, or on a machine with managed settings, Claude Code loads a [built-in guard](https://code.claude.com/docs/en/plugins/mods/admin#know-what-happens-by-default) that keeps plugins out of the session's start-up context. There, the plugin adds the rules to your first prompt instead, and to the first prompt after `/clear` or a compaction. A prompt that you send while a compaction runs can miss them. Then the plugin adds them to the next prompt.

The rules name the journal directory from the config at the start of the session. A change to the config takes effect in the next session.

## Journal pane

`/agent-journal` opens a pane beside the conversation. In a narrow terminal, the pane opens when you make the terminal wider.

- **Project:** `All` lists the entries of all projects. `Current` lists only the entries of the current repository. The pane keeps this choice for the next session.
- **Date:** `All` shows all dates. `Year`, `Month` and `Day` narrow the list to one period, and `‹` and `›` step to the period before or after it.
- **List:** It groups the entries by day, newest first. Older entries load when you scroll near the end.
- **Entry:** Press an entry to read it. The pane shows its fields (date, project, directory, host, user, agent and session) and its body. `↳ Send to prompt` puts the whole entry into the prompt.
- **Back:** `← Back` or Esc goes from an entry back to the list. Esc in the list closes the pane.

The last row of the list shows the journal directory. When git sync is on, it also shows `⇅` with the result of the last sync: green after a push, red with the reason after a failure.

## Git sync

When sync is on (see [Git sync](../README.md#git-sync) for the setup), the plugin runs a sync after the model writes an entry with the Write tool, and once more when the session ends if the exit leaves time for it. The sync runs in the background, so the turn does not wait for a push.
