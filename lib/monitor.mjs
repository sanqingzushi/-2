import { parseCsi, parseSpGlobal, sinaRecords, parseSinaFuture, parseSinaHistory, sourceNames } from './sources.mjs';
// Shared by the one-minute Cloudflare Worker and the manual GitHub backup.
// No credentials, account access, order placement, estimates or trading signals.
export const SCHEMA_VERSION = 1;
export const COLLECTOR_VERSION = '2026-10-24.2';
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
  if (!(item.kind === 'future' ? numeric(meta.regularMarketPrice) : positive(meta.regularMarketPrice)) || !positive(meta.regularMarketTime)) throw new Error('缺少有效价格或源报价时间');
  const asOfMs = meta.regularMarketTime * 1000;
  if (asOfMs > now + 60000) throw new Error('源报价时间在未来');
  // chartPreviousClose is relative to the chart range (e.g. a month ago), NOT necessarily yesterday.
  const close = positive(meta.previousClose) ? meta.previousClose : null;
  const changePercent = numeric(meta.regularMarketChangePercent) ? meta.regularMarketChangePercent : (positive(close) ? (meta.regularMarketPrice / close - 1) * 100 : null);
  return {
    price: meta.regularMarketPrice,
    currency: meta.currency,
    asOf: iso(asOfMs),
    previousClose: positive(close) ? close : null,
    changePercent,
    changeBasis: changePercent == null ? null : 'source_regular_market_daily',
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
    historyKind: 'daily',
    historyRange: item.historyRange || '1mo',
    historySource: sourceNames.yahoo,
    iopv: null,
    premiumPercent: null,
    history: (result.timestamp || []).map((time, i) => ({ time: time * 1000, value: result.indicators?.quote?.[0]?.close?.[i] })).filter(p => positive(p.time) && p.time <= now + 60000 && numeric(p.value) && (item.kind === 'future' || p.value > 0)).slice(-70)
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
    premiumPercent: null,
    historyKind: 'nav',
    historySource: sourceNames['eastmoney-nav'],
    history: trend.slice(-60).filter(p => positive(p.x) && positive(p.y) && p.x <= now + 86400000).map(p => ({ time:p.x, value:p.y }))
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
  const budget = Math.max(0, Math.floor(options.budget ?? 80));
  const scheduler = options.scheduler ?? 'github-actions';
  const intervalSeconds = options.intervalSeconds ?? 300;
  const oldItems = new Map((previous?.items || []).map(x => [x.id, x]));
  const backoff = { ...(previous?.providerBackoffUntil || {}) };
  const statistics = { attempted:0, succeeded:0, failed:0, httpRequests:0, historySucceeded:0, historyFailed:0, deferred:0, newQuoteTimestamps:0, newNavDates:0, unchanged:0 };
  const results = new Map();
  const quotes = [], funds = [], histories = [], batchFutures = [];
  const historicalResults = new Map();
  const providerOf = item => item.kind === 'fund' ? 'eastmoney-nav' : item.provider || 'yahoo';
  const task = (item, type = 'quote') => ({ items:[item], provider:providerOf(item), type });
  for (const item of catalog) {
    const old = oldItems.get(item.id);
    if (item.kind === 'fund') {
      const last = Date.parse(old?.lastSuccessAt || '');
      if (old?.nav != null && old.history?.length && Number.isFinite(last) && now - last < HOUR) results.set(item.id, { ...old, checkStatus:'not_due', sourceTimeAdvanced:false });
      else funds.push(task(item));
    } else if (item.symbol) {
      const last = Date.parse(old?.lastSuccessAt || '');
      if (item.provider === 'sina-futures') {
        batchFutures.push(item);
        if (!old?.history?.length || !Number.isFinite(Date.parse(old.historyFetchedAt)) || now - Date.parse(old.historyFetchedAt) >= HOUR) histories.push(task(item,'history'));
      } else if (old?.price != null && item.checkIntervalSeconds && Number.isFinite(last) && now - last < item.checkIntervalSeconds * 1000) results.set(item.id,{...old,checkStatus:'cached_quote',sourceTimeAdvanced:false});
      else quotes.push(task(item));
    }
    else results.set(item.id, { id: item.id, checkStatus: 'unconfigured', price: null, asOf: null, iopv: null, premiumPercent: null });
  }
  if (batchFutures.length) quotes.push({items:batchFutures,provider:'sina-futures',type:'quote'});
  const ageKey = t => Math.min(...t.items.map(x=>Date.parse(t.type === 'history' ? oldItems.get(x.id)?.historyLastAttemptAt || oldItems.get(x.id)?.historyFetchedAt || '' : oldItems.get(x.id)?.lastAttemptAt || '') || 0));
  for (const list of [quotes,funds,histories]) list.sort((a,b)=>ageKey(a)-ageKey(b));
  // Protect the main US indices/futures, rotate other quotes fairly, and reserve bounded
  // room for daily NAV and history warm-up. A batch of five futures costs one request.
  const core = quotes.filter(t=>t.items.some(x=>x.priority === 'core' || ['sp500','nasdaq100','dow'].includes(x.id)));
  const regular = quotes.filter(t=>!core.includes(t));
  const selected = [], chosen = new Set();
  function choose(t) { if (selected.length < budget && !chosen.has(t)) { selected.push(t); chosen.add(t); } }
  core.forEach(choose);
  const fundSlots = Math.min(2,funds.length,Math.max(0,budget-selected.length));
  const historySlots = quotes.some(t=>t.provider === 'spglobal') ? 0 : Math.min(1,histories.length,Math.max(0,budget-selected.length-fundSlots));
  const quoteSlots = Math.max(0,budget-selected.length-fundSlots-historySlots);
  regular.slice(0,quoteSlots).forEach(choose);
  funds.slice(0,fundSlots).forEach(choose);
  histories.slice(0,historySlots).forEach(choose);
  [...regular,...funds,...histories].forEach(choose);
  for (const t of [...quotes,...funds].filter(t=>!chosen.has(t))) for (const item of t.items) {
    results.set(item.id, { ...(oldItems.get(item.id) || { id:item.id }), checkStatus:'budget_deferred', sourceTimeAdvanced:false });
    statistics.deferred++;
  }
  const headers = { 'User-Agent':'AtlasMarketWatch/3.0 (personal research)', Accept:'application/json,*/*' };
  function requestUrl(t) {
    const item = t.items[0];
    if (t.type === 'history') return `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_${item.symbol}=/InnerFuturesNewService.getDailyKLine?symbol=${item.symbol}`;
    if (t.provider === 'sina-futures') return 'https://hq.sinajs.cn/list=' + t.items.map(x=>'nf_' + x.symbol).join(',');
    if (t.provider === 'csindex') return 'https://www.csindex.com.cn/csindex-home/perf/index-perf-oneday?indexCode=' + encodeURIComponent(item.symbol);
    if (t.provider === 'spglobal') return 'https://www.spglobal.com/spdji/zh/util/redesign/index-data/get-performance-data-for-datawidget-redesign.dot?indexId=' + item.sourceIndexId + '&language_id=142';
    if (t.provider === 'eastmoney-nav') return 'https://fund.eastmoney.com/pingzhongdata/' + item.code + '.js';
    return 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(item.symbol) + '?interval=1d&range=' + (item.historyRange || '1mo');
  }
  function failed(item,error) {
    const old = oldItems.get(item.id);
    statistics.failed++;
    results.set(item.id, { ...(old || { id:item.id, price:null, asOf:null, nav:null, navDate:null }), checkStatus:'error', lastAttemptAt:fetchedAt, sourceTimeAdvanced:false, error:String(error.message || '数据源请求失败').slice(0,160), iopv:null, premiumPercent:null });
  }
  function accept(item,parsed) {
    const old = oldItems.get(item.id);
    const advanced = item.kind === 'fund' ? (!old?.navDate || parsed.navDate > old.navDate) : (!old?.asOf || Date.parse(parsed.asOf) > Date.parse(old.asOf));
    if (item.kind !== 'fund' && old?.asOf && Date.parse(parsed.asOf) < Date.parse(old.asOf)) throw new Error('源报价时间倒退，保留上次成功值');
    if (item.kind === 'fund' && old?.navDate && parsed.navDate < old.navDate) throw new Error('净值披露日期倒退，保留上次成功值');
    statistics.succeeded++;
    if (advanced) statistics[item.kind === 'fund' ? 'newNavDates' : 'newQuoteTimestamps']++;
    else statistics.unchanged++;
    results.set(item.id,{ ...(old || {id:item.id}), ...parsed, sourceProvider:providerOf(item), checkStatus:'ok', lastAttemptAt:fetchedAt, lastSuccessAt:fetchedAt, sourceTimeAdvanced:advanced, error:null });
  }
  let cursor = 0;
  async function run() {
    while (cursor < selected.length) {
      const t = selected[cursor++], provider = t.provider;
      const backoffKey = t.type === 'history' ? provider + '-history' : provider;
      if (Date.parse(backoff[backoffKey] || '') > now) {
        if (t.type !== 'history') for (const item of t.items) {
          const old=oldItems.get(item.id);
          results.set(item.id,{...(old||{id:item.id}),checkStatus:'backoff',lastAttemptAt:old?.lastAttemptAt||null,sourceTimeAdvanced:false,error:'数据源限流退避，未重新请求'});
        }
        continue;
      }
      if (t.type !== 'history') statistics.attempted += t.items.length;
      statistics.httpRequests++;
      try {
        const response = await fetchImpl(requestUrl(t), { signal:AbortSignal.timeout(12000), headers:{...headers,...(provider === 'sina-futures' ? {Referer:'https://finance.sina.com.cn/'} : {})} });
        if (response.status === 429) backoff[backoffKey] = iso(now + 15 * 60000);
        if (!response.ok) throw new Error('数据源 HTTP ' + response.status);
        const text = provider === 'sina-futures' && t.type !== 'history' ? new TextDecoder('gb18030').decode(await response.arrayBuffer()) : await response.text();
        if (text.length > 5_000_000) throw new Error('响应超出大小限制');
        if (t.type === 'history') {
          historicalResults.set(t.items[0].id,{history:parseSinaHistory(text,t.items[0],now),historyKind:'daily',historySource:sourceNames['sina-futures'],historyFetchedAt:fetchedAt,historyLastAttemptAt:fetchedAt,historyError:null});
          statistics.historySucceeded++;
        } else {
          const payload = provider === 'sina-futures' ? sinaRecords(text) : provider === 'eastmoney-nav' ? text : JSON.parse(text);
          for (const item of t.items) {
            try {
              const parsed = provider === 'sina-futures' ? parseSinaFuture(payload,item,now) : provider === 'csindex' ? parseCsi(payload,item,now) : provider === 'spglobal' ? parseSpGlobal(payload,item,now) : provider === 'eastmoney-nav' ? parseFund(payload,item,now) : parseYahoo(payload,item,now);
              accept(item,parsed);
            } catch(error) { failed(item,error); }
          }
        }
      } catch (error) {
        if (t.type === 'history') { statistics.historyFailed++; historicalResults.set(t.items[0].id,{historyLastAttemptAt:fetchedAt,historyError:String(error.message).slice(0,160)}); }
        else for (const item of t.items) failed(item,error);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, selected.length) }, run));
  for (const [id,value] of historicalResults) results.set(id,{...(results.get(id)||oldItems.get(id)||{id,checkStatus:'budget_deferred'}),...value});
  return {
    schemaVersion: SCHEMA_VERSION,
    collectorVersion: COLLECTOR_VERSION,
    title: '石小鑫的全球指数与基金观测平台',
    collectionStartedAt: fetchedAt,
    generatedAt: iso(options.now != null ? now : Date.now()),
    scheduler: { name:scheduler, targetIntervalSeconds:intervalSeconds, guaranteed:false, navTargetIntervalSeconds:3600, historyTargetIntervalSeconds:3600, sourceRequestBudget:budget, quoteRotation:'core_first_then_oldest_attempt' },
    statistics,
    providerBackoffUntil: backoff,
    policy: { realtimeGuaranteed: false, sourceDelay: 'unknown', signalsEnabled: false, iopvAvailable: false, subscriptionLimitsAvailable: false },
    items: catalog.map(item => results.get(item.id))
  };
}
