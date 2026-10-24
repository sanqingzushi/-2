import catalog from '../data/catalog.json' with { type: 'json' };
import { collect, COLLECTOR_VERSION } from '../lib/monitor.mjs';

const databaseInitializers = new WeakMap();
const schema = 'CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT NOT NULL)';

export async function initializeDatabase(db) {
  if (!db?.prepare) throw new Error('DB binding is missing');
  if (!databaseInitializers.has(db)) {
    const promise = Promise.resolve().then(() => db.prepare(schema).run());
    databaseInitializers.set(db, promise);
    promise.catch(() => databaseInitializers.delete(db));
  }
  await databaseInitializers.get(db);
}

function json(data, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': origin, 'x-content-type-options': 'nosniff' } });
}

export default {
  async scheduled(controller, env, ctx) {
    // One JSON blob per minute: ~1,440 row updates/day instead of one write per instrument.
    ctx.waitUntil((async () => {
      await initializeDatabase(env.DB);
      const row = await env.DB.prepare('SELECT payload FROM snapshots WHERE id = 1').first();
      const previous = row ? JSON.parse(row.payload) : null;
      const snapshot = await collect(catalog, previous, { scheduler: 'cloudflare-cron', intervalSeconds: 60, budget: 48, concurrency: 4 });
      await env.DB.prepare('INSERT INTO snapshots(id, payload, updated_at, started_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at, started_at=excluded.started_at WHERE excluded.started_at >= snapshots.started_at').bind(JSON.stringify(snapshot), snapshot.generatedAt, snapshot.collectionStartedAt).run();
    })());
  },
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'OPTIONS') return new Response(null, { headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS' } });
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    if (path === '/') return json({ title: '石小鑫的全球指数与基金观测平台 · 分钟后台', collectorVersion:COLLECTOR_VERSION, portalUrl: 'https://sanqingzushi.github.io/-2/', healthPath: '/health', snapshotPath: '/api/snapshot', targetIntervalSeconds: 60, notice: '部署成功不等于行情已更新；请检查健康状态与两轮快照时间。' });
    if (path !== '/health' && path !== '/api/snapshot') return json({ error: 'not_found' }, 404);
    try { await initializeDatabase(env.DB); }
    catch { return json({ error: 'database_unavailable' }, 503); }
    if (path === '/health') {
      const row = await env.DB.prepare('SELECT updated_at FROM snapshots WHERE id = 1').first();
      const ageSeconds = row ? Math.max(0, (Date.now() - Date.parse(row.updated_at)) / 1000) : null;
      return json({ collectorVersion:COLLECTOR_VERSION, scheduler: 'cloudflare-cron', targetIntervalSeconds: 60, lastSnapshotAt: row?.updated_at || null, initialized: !!row, ready: !!row && Number.isFinite(ageSeconds) && ageSeconds <= 180, ageSeconds, status: !row ? 'waiting_first_run' : ageSeconds > 180 ? 'stale' : 'snapshot_available' });
    }
    const row = await env.DB.prepare('SELECT payload FROM snapshots WHERE id = 1').first();
    if (!row) return json({ error: 'first_run_pending' }, 503);
    return new Response(row.payload, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' } });
  }
};
