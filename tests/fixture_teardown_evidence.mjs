// Shared by both ordinary reading callers; no body/completion result is inferred.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const readingFixtureArgs = (mode, evidencePath) => mode === '--reading'
  ? ['--teardown-observations', path.join(evidencePath, 'fixture-teardown.jsonl')] : [];

export async function readingFixtureReport(report, evidencePath) {
  if (report.mode !== '--reading') return report;
  const evidence = { file: 'fixture-teardown.jsonl', sha256: null, records: [], errors: [] };
  try {
    const bytes = await readFile(path.join(evidencePath, evidence.file));
    evidence.sha256 = createHash('sha256').update(bytes).digest('hex');
    const text = bytes.toString('utf8');
    if (!text.endsWith('\n')) throw Error('Fixture teardown evidence is truncated');
    for (const line of text.trimEnd().split('\n')) evidence.records.push(JSON.parse(line));
    const final = evidence.records.at(-1);
    if (final?.event !== 'cleanup-complete' || !Array.isArray(final.errors)) {
      throw Error('Fixture teardown evidence has no final cleanup record');
    }
    evidence.errors.push(...final.errors);
  } catch (error) {
    evidence.errors.push({ stage: 'evidence-read', type: error.name, message: error.message });
  }
  return { ...report, fixtureTeardown: evidence };
}
