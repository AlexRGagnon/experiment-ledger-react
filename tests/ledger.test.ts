import { test } from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Ledger } from '../server/store.js';
import { createApp } from '../server/app.js';
import { parseRun, parseNotes } from '../shared/contracts.js';
const sample = {
  name: 'baseline',
  model: 'ridge',
  dataset: 'synthetic',
  seed: 17,
  metrics: { accuracy: 0.7, latency_ms: 140 },
};
const headers = { 'Content-Type': 'application/json', 'X-Ledger-Client': '1' };
async function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'ledger-'));
  const ledger = new Ledger(join(path, 'test.sqlite'));
  const server = createApp(ledger, resolve('dist/client'));
  await new Promise<void>((ok, no) => {
    server.once('error', no);
    server.listen(0, '127.0.0.1', () => ok());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  return {
    ledger,
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((ok, no) => server.close((e) => (e ? no(e) : ok())));
      ledger.close();
      rmSync(path, { recursive: true, force: true });
    },
  };
}
test('schema rejects unknown fields, invalid seeds, nonfinite and unsafe metrics', () => {
  for (const value of [
    [],
    { ...sample, extra: true },
    { ...sample, seed: 1.2 },
    { ...sample, seed: -1 },
    { ...sample, metrics: { x: NaN } },
    { ...sample, metrics: { constructor: 2 } },
    { ...sample, metrics: {} },
  ])
    assert.throws(() => parseRun(value));
  assert.throws(() => parseNotes({ notes: 'x', version: 0 }));
  assert.throws(() => parseNotes({ notes: 'x'.repeat(4001), version: 1 }));
});
test('canonical metric ordering deduplicates imports', () => {
  const s = new Ledger(':memory:');
  try {
    const a = s.import(sample),
      b = s.import({ ...sample, metrics: { latency_ms: 140, accuracy: 0.7 } });
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(a.run.id, b.run.id);
    assert.equal(s.list().runs.length, 1);
  } finally {
    s.close();
  }
});
test('versioned notes reject stale writers and preserve existing text', () => {
  const s = new Ledger(':memory:');
  try {
    const { run } = s.import(sample);
    const updated = s.updateNotes(run.id, { notes: 'reviewed', version: 1 });
    assert.equal(updated.version, 2);
    assert.throws(() => s.updateNotes(run.id, { notes: 'stale', version: 1 }), /changed/);
    assert.equal(s.get(run.id).notes, 'reviewed');
    assert.throws(() => s.get('absent'), /not found/);
  } finally {
    s.close();
  }
});
test('SQLite persistence survives reopening', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-persist-'));
  const p = join(dir, 'db.sqlite');
  let s = new Ledger(p);
  try {
    const { run } = s.import(sample);
    s.updateNotes(run.id, { notes: 'saved', version: 1 });
    s.close();
    s = new Ledger(p);
    assert.equal(s.get(run.id).notes, 'saved');
    assert.equal(s.get(run.id).version, 2);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('SQL-looking text is stored literally and filter metacharacters are literal', () => {
  const s = new Ledger(':memory:');
  try {
    const name = "x'); DROP TABLE runs; -- %";
    s.import({ ...sample, name });
    assert.equal(s.list('%').runs[0]?.name, name);
    s.import(sample);
    assert.equal(s.list().runs.length, 2);
    assert.equal(s.list('missing').runs.length, 0);
  } finally {
    s.close();
  }
});
test('HTTP import/list/filter returns real persisted data and security headers', async () => {
  const f = await fixture();
  try {
    const r = await fetch(f.url + '/api/runs', {
      method: 'POST',
      headers,
      body: JSON.stringify(sample),
    });
    assert.equal(r.status, 201);
    const data = (await r.json()) as { run: { id: string } };
    assert.ok(data.run.id);
    const listed = await fetch(f.url + '/api/runs?q=RIDGE');
    assert.equal(listed.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(((await listed.json()) as { runs: unknown[] }).runs.length, 1);
  } finally {
    await f.close();
  }
});
test('HTTP duplicate import and optimistic note conflict', async () => {
  const f = await fixture();
  try {
    const create = () =>
      fetch(f.url + '/api/runs', { method: 'POST', headers, body: JSON.stringify(sample) });
    const id = ((await (await create()).json()) as { run: { id: string } }).run.id;
    assert.equal((await create()).status, 200);
    const patch = () =>
      fetch(f.url + '/api/runs/' + id, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ notes: 'done', version: 1 }),
      });
    assert.equal((await patch()).status, 200);
    assert.equal((await patch()).status, 409);
  } finally {
    await f.close();
  }
});
test('cross-origin, missing guard, and hostile Host are denied', async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await fetch(f.url + '/api/runs', {
          method: 'POST',
          headers: { ...headers, Origin: 'https://evil.example' },
          body: JSON.stringify(sample),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(f.url + '/api/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sample),
        })
      ).status,
      403,
    );
    const hostileStatus = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(f.url + '/health', { headers: { Host: 'evil.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(hostileStatus, 403);
  } finally {
    await f.close();
  }
});
test('malformed JSON, wrong media type, and oversized bodies are rejected', async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await fetch(f.url + '/api/runs', { method: 'POST', headers, body: '{bad' })).status,
      400,
    );
    assert.equal(
      (
        await fetch(f.url + '/api/runs', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'text/plain' },
          body: '{}',
        })
      ).status,
      415,
    );
    assert.equal(
      (
        await fetch(f.url + '/api/runs', {
          method: 'POST',
          headers,
          body: JSON.stringify({ x: 'a'.repeat(70000) }),
        })
      ).status,
      413,
    );
  } finally {
    await f.close();
  }
});
test('compiled frontend is served; source, arbitrary files, and unknown routes are not', async () => {
  const f = await fixture();
  try {
    const home = await fetch(f.url + '/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Experiment Ledger/);
    assert.match(home.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    for (const path of ['/server/store.ts', '/package.json', '/unknown', '/api/unknown'])
      assert.equal((await fetch(f.url + path)).status, 404);
    assert.equal((await fetch(f.url + '/health', { method: 'DELETE' })).status, 405);
  } finally {
    await f.close();
  }
});

test('canonical ordering is code-unit deterministic and duplicate imports retain notes', () => {
  const s = new Ledger(':memory:');
  try {
    const value = { ...sample, metrics: { a: 1, Z: 2 } };
    const first = s.import(value);
    assert.deepEqual(Object.keys(first.run.metrics), ['Z', 'a']);
    s.updateNotes(first.run.id, { notes: 'retained', version: 1 });
    const duplicate = s.import(value);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.run.notes, 'retained');
    assert.equal(duplicate.run.version, 2);
  } finally {
    s.close();
  }
});
test('large result sets report truncation instead of silently implying completeness', () => {
  const s = new Ledger(':memory:');
  try {
    for (let i = 0; i < 201; i++) s.import({ ...sample, name: 'run-' + i });
    const list = s.list();
    assert.equal(list.runs.length, 200);
    assert.equal(list.truncated, true);
    const narrow = s.list('run-200');
    assert.equal(narrow.runs.length, 1);
    assert.equal(narrow.truncated, false);
  } finally {
    s.close();
  }
});
