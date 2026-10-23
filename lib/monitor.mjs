// Shared by GitHub Actions and the optional one-minute Cloudflare Worker.
// No credentials, account access, order placement, estimates or trading signals.
export const SCHEMA_VERSION = 1;
const HOUR = 3600000;
const numeric = x => typeof x === 'number' && Number.isFinite(x);
const positive = x => numeric(x) && x > 0;
const iso = x => new Date(x).toISOString();

export function parseYahoo(payload, item, now = Date.now()) {
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || payload.chart.error) throw new Error('源未返回行情');
  if (meta.symbol !== item.symbol) throw new Error('源代码与请求代码不一致');
  if (item.currency && meta.currency !== item.currency) throw new Error('币种不一致');
  if (item.kind === 'index' && meta.instrumentType !== 'INDEX') throw new Error('源不是指数');
  if (item.kind === 'future' && meta.instrumentType !== 'FUTURE') throw new Error('源不是期货');
  if (!positive(meta.regularMarketPrice) || !positive(meta.regularMarketTime)) throw new Error('缺少有效价格或源报价时间');
  const asOfMs = meta.regularMarketTime * 1000;
  if (asOfMs > now + 60000) throw new Error('源报价时间在未来');
  const close = positive(meta.chartPreviousClose) ? meta.chartPreviousClose : meta.previousClose;
  return {
    price: meta.regularMarketPrice,
    currency: meta.currency,
    asOf: iso(asOfMs),
    previousClose: positive(close) ? close : null,
    changePercent: positive(close) ? (meta.regularMarketPrice / close - 1) * 100 : null,
    source: 'Yahoo Finance 公共图表接口（非官方交易所源）',
    sourceUrl: item.sourceUrl,
    sourceSymbol: meta.symbol,
    sourceInstrumentType: meta.instrumentType,
    sourceName: meta.shortName || meta.longName || null,
    exchange: meta.fullExchangeName || meta.exchangeName || null,
    exchangeTimezone: meta.exchangeTimezoneName || null,
    sourceDelaySeconds: null,
    delayStatus: 'unknown',
    // Source regular-market observations, never promoted to real-time.
    observationType: 'source_regular_market',
    iopv: null,
    premiumPercent: null
  };
}

// Parse JSON literals in the published file without executing third-party JS.
export function assignment(text, name) {
  const match = new RegExp('(?:var\\s+)?' + name + '\\s*=\\s*').exec(text);
  if (!match) throw new Error('源缺少字段 ' + name);
  const start = match.index + match[0].length;
  let quoted = false, escape = false, depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return JSON.parse(text.slice(start, i).trim());
  }
  throw new Error('源字段格式不完整');
}

export function parseFund(text, item, now = Date.now()) {
  if (assignment(text, 'fS_code') !== item.code) throw new Error('基金代码不一致');
  const name = assignment(text, 'fS_name');
  const trend = assignment(text, 'Data_netWorthTrend');
  if (!Array.isArray(trend) || !trend.length) throw new Error('未披露净值');
  // Preserve source ordering; reject a malformed last record, never silently substitute an earlier one.
  const last = trend.at(-1);
  if (!positive(last?.x) || !positive(last?.y)) throw new Error('最新净值无效');
  if (last.x > now + 86400000) throw new Error('净值日期在未来');
  const date = new Date(last.x + 8 * HOUR).toISOString().slice(0, 10);
  return {
    sourceName: name,
    nav: last.y,
    navDate: date,
    navSourceTimestamp: last.x,
    source: '天天基金公开净值披露（第三方）',
    sourceUrl: item.sourceUrl,
    // Do not infer share currency or eligibility from the NAV number or minimum purchase amount.
    navCurrency: null,
    subscriptionStatus: 'unknown',
    subscriptionLimit: null,
    subscriptionChannel: null,
    limitVerifiedAt: null,
    limitSourceUrl: null,
    iopv: null,
    premiumPercent: null
  };
}

// Reserved for a future verified IOPV adapter. Previous-day NAV is never accepted.
export function verifiedPremium(price, iopv, now = Date.now()) {
  if (!price || !iopv || iopv.type !== 'IOPV' || iopv.verification !== 'official') return null;
  if (!iopv.sourceUrl?.startsWith('https://') || !positive(price.value) || !positive(iopv.value)) return null;
  if (!price.instrumentId || price.instrumentId !== iopv.instrumentId) return null;
  if (!price.currency || price.currency !== iopv.currency) return null;
  const p = Date.parse(price.asOf), v = Date.parse(iopv.asOf);
  if (!numeric(p) || !numeric(v) || p > now + 5000 || v > now + 5000) return null;
  if (Math.abs(p - v) > 60000 || now - p > 120000 || now - v > 120000) return null;
  return (price.value / iopv.value - 1) * 100;
}

export async function collect(catalog, previous = null, options = {}) {
  const now = options.now ?? Date.now();
  const fetchedAt = iso(now);
  const fetchImpl = options.fetchImpl ?? fetch;
  const budget = options.budget ?? 80;
  const scheduler = options.scheduler ?? 'github-actions';
  const intervalSeconds = options.intervalSeconds ?? 300;
  const oldItems = new Map((previous?.items || []).map(x => [x.id, x]));
  const backoff = { ...(previous?.providerBackoffUntil || {}) };
  const statistics = { attempted: 0, succeeded: 0, failed: 0, newQuoteTimestamps: 0, newNavDates: 0, unchanged: 0 };
  const results = new Map();
  const tasks = [];
  const dueFunds = [];
  for (const item of catalog) {
    const old = oldItems.get(item.id);
    if (item.kind === 'fund') {
      const last = Date.parse(old?.lastSuccessAt || '');
      if (old?.nav != null && Number.isFinite(last) && now - last < HOUR) results.set(item.id, { ...old, checkStatus: 'not_due' });
      else dueFunds.push(item);
    } else if (item.symbol) tasks.push(item);
    else results.set(item.id, { id: item.id, checkStatus: 'unconfigured', price: null, asOf: null, iopv: null, premiumPercent: null });
  }
  // Oldest successful fund checks first; a 48-request Worker budget progressively warms its NAV cache.
  dueFunds.sort((a, b) => (Date.parse(oldItems.get(a.id)?.lastSuccessAt || '') || 0) - (Date.parse(oldItems.get(b.id)?.lastSuccessAt || '') || 0));
  tasks.push(...dueFunds);
  const selected = tasks.slice(0, budget);
  for (const item of tasks.slice(budget)) results.set(item.id, { ...(oldItems.get(item.id) || { id: item.id }), checkStatus: 'budget_deferred' });
  let cursor = 0;
  async function run() {
    while (cursor < selected.length) {
      const item = selected[cursor++];
      const old = oldItems.get(item.id);
      const provider = item.kind === 'fund' ? 'eastmoney-nav' : 'yahoo';
      if (Date.parse(backoff[provider] || '') > now) {
        results.set(item.id, { ...(old || { id: item.id }), checkStatus: 'backoff', lastAttemptAt: old?.lastAttemptAt || null, error: '数据源限流退避，未重新请求' });
        continue;
      }
      const url = item.kind === 'fund'
        ? 'https://fund.eastmoney.com/pingzhongdata/' + item.code + '.js'
        : 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(item.symbol) + '?interval=1d&range=1d';
      statistics.attempted++;
      try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'AtlasMarketWatch/2.0 (personal research)', 'Accept': item.kind === 'fund' ? '*/*' : 'application/json' } });
        if (response.status === 429) backoff[provider] = iso(now + 15 * 60000);
        if (!response.ok) throw new Error('数据源 HTTP ' + response.status);
        const text = await response.text();
        if (text.length > 5_000_000) throw new Error('响应超出大小限制');
        const parsed = item.kind === 'fund' ? parseFund(text, item, now) : parseYahoo(JSON.parse(text), item, now);
        const advanced = item.kind === 'fund' ? (!old?.navDate || parsed.navDate > old.navDate) : (!old?.asOf || Date.parse(parsed.asOf) > Date.parse(old.asOf));
        // Reject a regressing source timestamp. Retain the last good observation instead.
        if (item.kind !== 'fund' && old?.asOf && Date.parse(parsed.asOf) < Date.parse(old.asOf)) throw new Error('源报价时间倒退，保留上次成功值');
        if (item.kind === 'fund' && old?.navDate && parsed.navDate < old.navDate) throw new Error('净值披露日期倒退，保留上次成功值');
        statistics.succeeded++;
        if (advanced) statistics[item.kind === 'fund' ? 'newNavDates' : 'newQuoteTimestamps']++;
        else statistics.unchanged++;
        results.set(item.id, { id: item.id, ...parsed, checkStatus: 'ok', lastAttemptAt: fetchedAt, lastSuccessAt: fetchedAt, sourceTimeAdvanced: advanced, error: null });
      } catch (error) {
        statistics.failed++;
        results.set(item.id, { ...(old || { id: item.id, price: null, asOf: null, nav: null, navDate: null }), checkStatus: 'error', lastAttemptAt: fetchedAt, sourceTimeAdvanced: false, error: String(error.message || '数据源请求失败').slice(0, 160), iopv: null, premiumPercent: null });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, selected.length) }, run));
  return {
    schemaVersion: SCHEMA_VERSION,
    title: '石小鑫的全球指数与基金观测平台',
    collectionStartedAt: fetchedAt,
    generatedAt: iso(options.now != null ? now : Date.now()),
    scheduler: { name: scheduler, targetIntervalSeconds: intervalSeconds, guaranteed: false, navTargetIntervalSeconds: 3600 },
    statistics,
    providerBackoffUntil: backoff,
    policy: { realtimeGuaranteed: false, sourceDelay: 'unknown', signalsEnabled: false, iopvAvailable: false, subscriptionLimitsAvailable: false },
    items: catalog.map(item => results.get(item.id))
  };
}
