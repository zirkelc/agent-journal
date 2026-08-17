# Writing an adapter

An adapter is what teaches one agent to journal. It is the only part of this
project that knows any specific agent exists: `bin/agent-journal` has no product
names in it, and `INSTRUCTIONS.md` is written to be read by any model.

The job is short. Run the core, take the text it prints, encode that text the way
your agent wants it, and hand it over at the start of every session.

## The contract

Run the core. It prints the text a session should be given:

```sh
bin/agent-journal context --cwd <directory> --session-id <id> --agent <name[/model]>
```

Every flag is optional, and leaving one out only affects that one field:

| flag | what it is | if you leave it out |
|---|---|---|
| `--cwd` | where the session is working | the adapter's own working directory is used, which is rarely what the session meant |
| `--session-id` | the id that joins an entry back to the transcript | entries carry no `session_id` |
| `--agent` | your agent's name, and the model if you know it | entries carry no `agent` |

The output is plain UTF-8 text on stdout. It is already framed as a standing
instruction and already carries the resolved journal directory along with every
value above. Empty output means there is nothing to inject, which is a normal
result rather than an error.

Do not parse, reformat, extend or truncate that text. Encode it and pass it on.
If the wording needs to change, change `INSTRUCTIONS.md`, so every agent gets the
change at once.

## Rules

**Exit 0 on every path**, including a missing core, a missing `INSTRUCTIONS.md`,
a payload you cannot parse, and a core that returned nothing. A session should
never fail because the journal was misconfigured.

**Write nothing to the user.** The instruction is meant for the model. A banner
about somebody's own configuration at every session start is just noise.

**Read `journal_dir` only through `bin/agent-journal`.** One config file serves
every agent on the machine, which is what keeps several tools writing into one
journal.

**Preserve the text byte for byte** through whatever encoding you need. It
contains quotes, backslashes and tabs, and a mangled instruction is harder to
notice than a missing one.

## Delivery is different for every agent

The contract is deliberately "text out, delivered somehow" rather than "return
JSON from a hook". Both agents supported today happen to take a `SessionStart`
hook and read `hookSpecificOutput.additionalContext` from stdout, using the same
field names in the payload, but that is a coincidence rather than a standard. It
is also why the shared parts live in `common.sh` instead of in the core.

An agent with no session event can still be adapted. Have its adapter write the
same text into whatever instructions file that agent reads, at install time and
whenever the config changes. The core does not change either way.

So the first question for a new agent is not where its hooks live. It is what the
agent reads at the start of every conversation, and how you put text there. It
might be a hook, an instructions file, a plugin API or an environment variable.
The core call above stays the same.

Two more questions are worth answering before you write anything:

- **When does the agent throw the context away and rebuild it?** Injecting once
  at startup is not enough if it compacts or clears mid-session, so match those
  events too. Do not match "resume": a resumed session still carries the
  instruction it was given, and a second copy only spends context.
- **Will the agent actually run what you registered?** Some agents make the
  person review and approve a hook first, and skip it silently until they do. If
  yours does, say so in the installer and the README rather than shipping
  something that looks installed but does nothing. Do not write the approval
  record yourself: that review is there so nothing can quietly arrange to run a
  command at every session start.

## Steps

1. **Make a directory** for it, `adapters/<agent>/`. Everything specific to that
   agent belongs there and nowhere else.
2. **Write the delivery script.** Resolve the project root the way that agent
   documents, source `../common.sh` if its payload is JSON on stdin, then call
   the core, encode and print. `codex/session-start.sh` is about forty lines and
   is a complete example to copy.
3. **Build the `agent` value.** Your agent's name, plus `/model` when the payload
   carries one; `common.sh` has `journal_agent` for this. Strip a redundant
   product prefix from the model if there is one, so it reads `claude/opus-5`
   rather than `claude/claude-opus-5`.
4. **Register it where that agent looks.** Usually a plugin manifest at the
   repository root, next to `.claude-plugin/` and `.codex-plugin/`. An agent with
   a marketplace may also need an index file. Codex reads
   `.agents/plugins/marketplace.json`, which makes this repository its own
   marketplace.
5. **Teach the installer about it.** Add the agent to `journal_harnesses` in
   `lib/install.sh`: how to detect it without running it, the commands that
   register the plugin, and anything the person still has to do by hand.
   Detection should be a `command -v` and a directory test. Launching an agent to
   ask it about itself costs that time at every `agent-journal install`.
6. **Add tests** under `test/`, covering at least that the output is well formed
   for that agent, that the instruction survives its encoding unchanged, and that
   broken or empty input still exits 0. `test/plugin.test.ts` runs its checks over
   a list of agents, so a new one is usually a new entry in that list rather than
   new cases.

## What is here

| file | |
|---|---|
| `common.sh` | payload parsing, the `agent` value, and JSON encoding. Sourced, never run |
| `<agent>/session-start.sh` | reads the payload, runs the core, prints what that agent reads |
| `<agent>/hooks.json` | registers the script with that agent |

Right now an adapter is only the hook. Agents also accept commands, each in their
own format, such as a slash command declared in `commands` or a skill directory
declared in `skills`. Neither plugin ships one, because changing a setting is a
single `agent-journal config set` and every agent can run a shell command. It is
worth adding one when there is a task that needs judgement rather than a command.
