import catalog from '../data/catalog.json' with { type: 'json' };
import { collect } from '../lib/monitor.mjs';

function json(data, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': origin, 'x-content-type-options': 'nosniff' } });
}

export default {
  async scheduled(controller, env, ctx) {
    // One JSON blob per minute: ~1,440 row updates/day instead of one write per instrument.
    ctx.waitUntil((async () => {
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
    if (path === '/health') {
      const row = await env.DB.prepare('SELECT updated_at FROM snapshots WHERE id = 1').first();
      return json({ scheduler: 'cloudflare-cron', targetIntervalSeconds: 60, lastSnapshotAt: row?.updated_at || null, initialized: !!row });
    }
    if (path !== '/api/snapshot') return json({ error: 'not_found' }, 404);
    const row = await env.DB.prepare('SELECT payload FROM snapshots WHERE id = 1').first();
    if (!row) return json({ error: 'first_run_pending' }, 503);
    return new Response(row.payload, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' } });
  }
};
