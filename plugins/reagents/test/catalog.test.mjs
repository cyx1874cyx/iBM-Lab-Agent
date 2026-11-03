import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReagentCatalog } from 'dsh-lab-agent/reagents/catalog';

test('an unconfigured catalog is usable and does not create a source', async () => {
 const root = await mkdtemp(join(tmpdir(), 'ibm-reagents-package-'));
 try {
  const catalog = new ReagentCatalog(root);
  const result = await catalog.search({ query: 'NaCl' });
  assert.equal(result.total, 0);
  assert.equal(result.sources.length, 3);
  assert.ok(result.sources.every(source => !source.configured));
  await assert.rejects(catalog.setSource('unknown', join(root, 'source.xlsx')));
  assert.deepEqual(await catalog.config(), []);
 } finally { await rm(root, { recursive: true, force: true }); }
});
