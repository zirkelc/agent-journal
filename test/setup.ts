import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

/**
 * Every temp folder of a test run goes into one folder of the run, which the
 * run deletes at its end. A run that stopped before its end leaves its folder,
 * so a run first deletes the folders of runs older than a day. A newer folder
 * can belong to a run in another checkout that is still going.
 */
const PARENT = join(tmpdir(), 'agent-journal-tests');
const STALE_MS = 24 * 60 * 60 * 1_000;

declare module 'vitest' {
  export interface ProvidedContext {
    tmp: string;
  }
}

export default function setup(project: TestProject): () => void {
  mkdirSync(PARENT, { recursive: true });
  for (const name of readdirSync(PARENT)) {
    const path = join(PARENT, name);
    if (Date.now() - statSync(path).mtimeMs > STALE_MS) rmSync(path, { recursive: true, force: true });
  }
  const run = realpathSync(mkdtempSync(join(PARENT, 'run-')));
  project.provide('tmp', run);
  return () => rmSync(run, { recursive: true, force: true });
}
