import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseYahoo, parseFund, collect, verifiedPremium } from '../lib/monitor.mjs';
// Explicit test fixtures only; never deployed as market observations.
const now = Date.parse('2026-10-23T14:00:00Z');
const item = { id:'sp500', kind:'index', symbol:'^GSPC', currency:'USD', sourceUrl:'https://finance.yahoo.com/quote/%5EGSPC/' };
const payload = () => ({ chart:{ result:[{ meta:{ symbol:'^GSPC', instrumentType:'INDEX', currency:'USD', regularMarketPrice:100, regularMarketTime:(now-60000)/1000, chartPreviousClose:98 } }], error:null } });
const fundItem = { id:'fund-008163', kind:'fund', code:'008163' };
const fundText = `var fS_code="008163";var fS_name="测试用基金";var fund_minsg="10";var Data_netWorthTrend=[{"x":${now-86400000},"y":1.2,"unitMoney":"分红[测试]"}];`;

test('rejects wrong instrument, currency, future timestamp and string prices', () => {
  for (const change of [{ symbol:'^NDX' },{ currency:'CNY' },{ instrumentType:'ETF' },{ regularMarketTime:(now+120000)/1000 },{ regularMarketPrice:'100' }]) {
    const p = payload(); Object.assign(p.chart.result[0].meta,change);
    assert.throws(() => parseYahoo(p,item,now));
  }
});
test('source quote time remains distinct from collection time', () => {
  const value = parseYahoo(payload(),item,now);
  assert.equal(value.asOf,new Date(now-60000).toISOString());
  assert.equal(value.sourceDelaySeconds,null);
  assert.equal(value.iopv,null);
  assert.equal(value.premiumPercent,null);
});
test('historical chart retains only source observations, and futures can be negative', () => {
  const p=payload(); p.chart.result[0].timestamp=[(now-86400000)/1000,(now-10000)/1000];
  p.chart.result[0].indicators={quote:[{close:[99,null]}]};
  const parsed=parseYahoo(p,item,now);
  assert.deepEqual(parsed.history,[{time:now-86400000,value:99}]);
  const f=payload(); Object.assign(f.chart.result[0].meta,{symbol:'CL=F',instrumentType:'FUTURE',regularMarketPrice:-10});
  assert.equal(parseYahoo(f,{...item,kind:'future',symbol:'CL=F'},now).price,-10);
});
test('NAV parser does not execute JS or turn minimum purchase into a limit', () => {
  const value = parseFund(fundText,fundItem,now);
  assert.equal(value.nav,1.2);
  assert.equal(value.subscriptionLimit,null);
  assert.equal(value.subscriptionStatus,'unknown');
  assert.throws(() => parseFund(fundText.replace('"008163"','"019547"'),fundItem,now));
  assert.throws(() => parseFund(fundText.replace('1.2','(()=>{throw Error("executed")})()'),fundItem,now));
});
test('failed collection preserves old quote time and last-success time', async () => {
  const old = { id:item.id, ...parseYahoo(payload(),item,now), lastSuccessAt:new Date(now-10000).toISOString() };
  const result = await collect([item],{items:[old]},{now,fetchImpl:async()=>new Response('',{status:503})});
  assert.equal(result.items[0].price,100);
  assert.equal(result.items[0].asOf,old.asOf);
  assert.equal(result.items[0].lastSuccessAt,old.lastSuccessAt);
  assert.equal(result.items[0].checkStatus,'error');
  assert.equal(result.statistics.newQuoteTimestamps,0);
});
test('repeated timestamps and a fresh webpage do not count as new source quotes', async () => {
  const old = { id:item.id,...parseYahoo(payload(),item,now) };
  const result = await collect([item],{items:[old]},{now,fetchImpl:async()=>Response.json(payload())});
  assert.equal(result.statistics.newQuoteTimestamps,0);
  assert.equal(result.statistics.unchanged,1);
});
test('older source timestamp is rejected instead of overwriting a newer quote', async () => {
  const old = {id:item.id,...parseYahoo(payload(),item,now),asOf:new Date(now-10000).toISOString()};
  const result = await collect([item],{items:[old]},{now,fetchImpl:async()=>Response.json(payload())});
  assert.equal(result.items[0].asOf,old.asOf);
  assert.equal(result.items[0].checkStatus,'error');
});
test('rate limiting creates a provider backoff and stops subsequent requests', async () => {
  let count=0;
  const result = await collect([item,{...item,id:'another'}],null,{now,concurrency:1,fetchImpl:async()=>{count++;return new Response('',{status:429});}});
  assert.equal(count,1);
  assert.equal(result.items[1].checkStatus,'backoff');
  assert.ok(Date.parse(result.providerBackoffUntil.yahoo)>now);
});
test('daily NAV checks are cached for one hour and deferred funds remain unknown', async () => {
  const old = {id:fundItem.id,...parseFund(fundText,fundItem,now),lastSuccessAt:new Date(now-10000).toISOString()};
  const result = await collect([fundItem],{items:[old]},{now,fetchImpl:async()=>{throw Error('must not request');}});
  assert.equal(result.statistics.attempted,0);
  assert.equal(result.items[0].checkStatus,'not_due');
  const deferred = await collect([fundItem],null,{now,budget:0});
  assert.equal(deferred.items[0].checkStatus,'budget_deferred');
  assert.equal(deferred.items[0].nav,undefined);
});
test('premium rejects previous-day NAV, stale IOPV, mismatched currency and code', () => {
  const price={value:10,instrumentId:'etf-1',currency:'CNY',asOf:new Date(now-10000).toISOString()};
  const iopv={value:9.9,instrumentId:'etf-1',currency:'CNY',asOf:price.asOf,type:'IOPV',verification:'official',sourceUrl:'https://example.com/official'};
  assert.ok(verifiedPremium(price,iopv,now)>0);
  for (const change of [{type:'NAV'},{asOf:new Date(now-86400000).toISOString()},{currency:'USD'},{instrumentId:'etf-2'},{verification:'third-party'}]) assert.equal(verifiedPremium(price,{...iopv,...change},now),null);
});
test('catalog keeps distinct Nasdaq indices and unique product identities', async () => {
  const catalog=JSON.parse(await readFile(new URL('../data/catalog.json',import.meta.url),'utf8'));
  assert.equal(new Set(catalog.map(x=>x.id)).size,catalog.length);
  assert.equal(catalog.find(x=>x.id==='nasdaq100').symbol,'^NDX');
  assert.equal(catalog.find(x=>x.id==='nasdaq-composite').symbol,'^IXIC');
  assert.ok(catalog.find(x=>x.code==='008163'));
});
