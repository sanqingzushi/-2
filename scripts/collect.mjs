import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { collect } from '../lib/monitor.mjs';
const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
let previous = null;
try { previous = JSON.parse(await readFile(process.env.PREVIOUS_SNAPSHOT || 'data/latest.json', 'utf8')); } catch { /* first run */ }
const snapshot = await collect(catalog, previous);
await mkdir('data', { recursive: true });
await writeFile('data/latest.json', JSON.stringify(snapshot, null, 2) + '\n');
console.log(JSON.stringify({ generatedAt: snapshot.generatedAt, scheduler: snapshot.scheduler, ...snapshot.statistics }));
if (snapshot.statistics.succeeded === 0 && snapshot.statistics.attempted > 0) {
  console.error('本轮数据源全部失败；快照已保留历史时间和失败状态。');
  // Publish truthful failure status; workflow health is visible separately from source health.
}
