/**
 * What the scripts that write the content share: a call to a model through
 * Pi, the checks of one written entry, and a pool that runs tasks side by
 * side.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brokenRules, PROJECTS, type Content, type Slot } from './generate.ts';

export const CONTENT = new URL('content/', import.meta.url);

const PI = new URL('../../node_modules/.bin/pi', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), 'agent-journal-write-'));

type Usage = { cost: number; input: number; output: number };
/** What all calls of this process cost so far. */
export const spent: Usage = { cost: 0, input: 0, output: 0 };

/** One call to a model through Pi, with no tools and no session. */
export function callPi(model: string, system: string, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      PI,
      [
        '-p',
        '--mode',
        'json',
        '--no-tools',
        '--no-extensions',
        '--no-skills',
        '--no-prompt-templates',
        '--no-context-files',
        '--no-themes',
        '--no-mcp',
        '--no-session',
        '--thinking',
        'off',
        '--model',
        model,
        '--system-prompt',
        system,
      ],
      { cwd: work, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdin.end(message);
    child.on('close', (code) => {
      const end = stdout
        .trim()
        .split('\n')
        .map((line) => {
          try {
            return JSON.parse(line) as { type: string; messages?: Array<any> };
          } catch {
            return null;
          }
        })
        .filter((event) => event?.type === 'agent_end')
        .at(-1);
      const reply = end?.messages?.filter((item) => item.role === 'assistant').at(-1);
      if (code !== 0 || !reply) return reject(new Error(`pi exited with ${code}: ${stderr.slice(0, 500)}`));
      spent.cost += reply.usage.cost.total;
      spent.input += reply.usage.input + reply.usage.cacheRead;
      spent.output += reply.usage.output;
      if (reply.stopReason !== 'stop') return reject(new Error(`the reply stopped with ${reply.stopReason}`));
      resolve(
        (reply.content as Array<{ type: string; text?: string }>)
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join(''),
      );
    });
  });
}

/** The first JSON array in a reply, which may have text, or another array, before or after it. */
export function jsonArray<ITEM>(text: string): Array<ITEM> {
  for (let start = text.indexOf('['); start >= 0; start = text.indexOf('[', start + 1)) {
    for (let end = text.indexOf(']', start); end >= 0; end = text.indexOf(']', end + 1)) {
      try {
        const value: unknown = JSON.parse(text.slice(start, end + 1));
        if (Array.isArray(value)) return value as Array<ITEM>;
      } catch {
        // Not a whole array yet: try the next closing bracket.
      }
    }
  }
  throw new Error('no JSON array');
}

export const sentenceCount = (text: string): number => (text.match(/[.!?](\s|$)/g) ?? []).length;

/** What is wrong with the entry of a slot, or nothing. */
export function problems(slot: Slot, item: Content, at: string): Array<string> {
  const project = PROJECTS.find((entry) => entry.name === slot.name)!;
  if (typeof item.summary !== 'string' || typeof item.body !== 'string') return [`${at} has no summary or body.`];
  const found: Array<string> = [];
  if (item.summary.includes('\n')) found.push(`${at}: the summary has more than one line.`);
  if (item.summary.length > 200) found.push(`${at}: the summary has ${item.summary.length} characters, more than 200.`);
  if (item.summary.includes('"')) found.push(`${at}: the summary has a double quote; use single quotes instead.`);
  const sentences = sentenceCount(item.body);
  if (sentences < slot.sentences * 0.6 || sentences > slot.sentences * 1.6) {
    found.push(`${at}: the body has ${sentences} sentences, but the slot asks for about ${slot.sentences}.`);
  }
  if (/\bday -?\d+/i.test(`${item.summary}\n${item.body}`)) found.push(`${at} names a day number.`);
  for (const rule of brokenRules(slot, `${item.summary}\n${item.body}`)) {
    found.push(
      `${at} has "${rule.pattern.exec(`${item.summary}\n${item.body}`)?.[0]}" (${rule.words}), which is not allowed: ${rule.why}`,
    );
  }
  if (item.branch && !project.branches?.includes(item.branch)) {
    found.push(`${at} has the unknown branch "${item.branch}".`);
  }
  return found;
}

/** Runs the tasks with at most `limit` at a time, in their order. */
export async function pool<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<Array<T>> {
  const results: Array<T> = [];
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]!();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
