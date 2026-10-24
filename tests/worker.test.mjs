import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker, { initializeDatabase } from '../worker/index.mjs';

function database() {
  const sql = new DatabaseSync(':memory:');
  let creates = 0;
  const db = { prepare(query) {
    if (query.startsWith('CREATE TABLE')) creates++;
    const statement = sql.prepare(query);
    return { first:async()=>statement.get(), run:async()=>statement.run(), bind(...args){ return {run:async()=>statement.run(...args)}; } };
  } };
  return {sql,db,get creates(){return creates;}};
}

test('new deployment initializes D1 schema once without manual SQL', async () => {
  const d = database();
  await Promise.all([initializeDatabase(d.db),initializeDatabase(d.db)]);
  assert.equal(d.creates,1);
  assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n,0);
});

test('empty backend health never claims a running scheduler or a ready snapshot', async () => {
  const d = database();
  const response=await worker.fetch(new Request('https://example.invalid/health'),{DB:d.db});
  const body=await response.json();
  assert.equal(body.ready,false);
  assert.equal(body.initialized,false);
  assert.equal(body.lastSnapshotAt,null);
  assert.equal(body.status,'waiting_first_run');
  assert.equal((await worker.fetch(new Request('https://example.invalid/api/snapshot'),{DB:d.db})).status,503);
});

test('stale snapshots and missing database binding are explicit', async () => {
  const d = database(); await initializeDatabase(d.db);
  const old=new Date(Date.now()-3600000).toISOString();
  d.sql.prepare('INSERT INTO snapshots VALUES(1,?,?,?)').run('{}',old,old);
  const health=await(await worker.fetch(new Request('https://example.invalid/health'),{DB:d.db})).json();
  assert.equal(health.status,'stale');assert.equal(health.ready,false);
  const missing=await worker.fetch(new Request('https://example.invalid/health'),{});
  assert.equal(missing.status,503);assert.equal((await missing.json()).error,'database_unavailable');
});

test('unavailable schema initialization can be retried and root does not require data', async () => {
  let calls=0;
  const db={prepare(){return{run:async()=>{if(++calls===1)throw new Error('temporary DB error');}};}};
  await assert.rejects(initializeDatabase(db));
  await initializeDatabase(db);
  assert.equal(calls,2);
  const response=await worker.fetch(new Request('https://example.invalid/'),{});
  assert.equal(response.status,200);
  assert.equal((await response.json()).snapshotPath,'/api/snapshot');
});
