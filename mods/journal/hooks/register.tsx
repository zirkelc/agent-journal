/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { Register } from 'claude-code';

/**
 * Spike: the hidden search agent with the built-in Bash and Read tools, and
 * `/journal <question>`, to learn how a spawned agent, its tool calls and its
 * answer behave on this build.
 */
export const register: Register = (on, options) => {
  const pending = new Map<string, string>();

  on('session.start', async ($, e, next) => {
    const started = await next(e);
    const cli = `${$.plugin.root}/../../bin/agent-journal`;
    const config = await $.process.run([cli, 'config'], { timeoutMs: 10_000 });
    const journalDir = /^journal_dir=(.*)$/m.exec(config.stdout)?.[1] ?? '~/agent-journal';
    await $.agent.register({
      name: 'search',
      description: 'Answers questions about past work from the agent journal.',
      prompt: [
        'You answer questions from a journal of past agent sessions.',
        `Today is ${new Date().toISOString().slice(0, 10)}. The session works in ${e.cwd}.`,
        `Entries are markdown files in ${journalDir}, one per entry, named by UTC timestamp (YYYY-MM-DDTHHMMSSZ.md), with frontmatter fields date, project, summary, cwd, session_id.`,
        `The CLI ${cli} lists and searches them: \`list [--since 7d] [--project NAME|.] [--all]\`, \`search TEXT [filters]\`, \`read ID\`. You may also use ls, grep and Read on that directory.`,
        'Only read. Answer in at most five sentences and name the entry ids you used.',
      ].join('\n'),
      tools: ['Bash', 'Read'],
      model: String(options.model ?? 'haiku'),
    });
    await $.command.register({ name: 'journal', description: 'Ask the agent journal a question' });
    return started;
  });

  on('agent.offer', { agent: 'journal:search' }, () => ({ isOffered: false }));

  /**
   * A spawn this mod makes comes from no model response, so the auto mode
   * classifier has no verdict for it and denies it. Approves only the search
   * agent when this mod itself starts it; the agent's own tool calls still go
   * through the normal checks.
   */
  on('tool.check', { tool: 'Agent' }, ($, e, next) => {
    const input = e.input as { subagent_type?: string } | undefined;
    const isOwnSpawn = next.origin?.plugin === $.plugin.name && input?.subagent_type === 'journal:search';
    return isOwnSpawn ? { decision: 'allow', reason: 'started by /journal' } : next(e);
  });

  on('command.run', { command: 'journal' }, async ($, e) => {
    if (e.args.trim() === '') return { text: 'Usage: /journal <question>' };
    const spawned = await $.agent.spawn({
      subagentType: 'journal:search',
      description: 'Search the journal',
      prompt: e.args,
    });
    if ('deny' in spawned && spawned.deny) return { text: `Could not start the search: ${spawned.deny}` };
    if (spawned.agentId) pending.set(spawned.agentId, e.args);
    return { text: `Asking the journal (${spawned.model}, ${spawned.agentId})…` };
  });

  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    const question = e.agentId ? pending.get(e.agentId) : undefined;
    if (e.agentId && question !== undefined) {
      pending.delete(e.agentId);
      $.ui.toast(`Journal answered: ${e.answer.slice(0, 80)}`);
      await $.session.append({
        message: { type: 'system', content: [{ type: 'text', text: `Journal: ${e.answer}` }] },
      });
    }
    return result;
  });
};
