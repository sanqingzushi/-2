import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsi, parseSpGlobal, sinaRecords, parseSinaFuture, parseSinaHistory, shanghaiTime } from '../lib/sources.mjs';
import { collect, parseYahoo } from '../lib/monitor.mjs';

// Synthetic fixtures only. Values in this file never enter deployed snapshots.
const now = Date.parse('2026-10-23T09:00:00Z');
const csiItem = {id:'csi-test',kind:'index',provider:'csindex',symbol:'H30269',currency:'CNY'};
const csi = () => ({code:'200',data:{intraDayHeader:{indexCode:'H30269',tradeDate:'2026-10-23',tradeTime:'15:00:00',current:100,closePre:101,changePct:-0.99},intraDayPerfList:[{indexCode:'H30269',tradeDate:'2026-10-23',tradeTime:'14:59:00',current:99},{indexCode:'H30269',tradeDate:'2026-10-23',tradeTime:'15:00:00',current:100}]}});
const spItem = {id:'sp-test',kind:'index',provider:'spglobal',symbol:'SPCLLHCP',sourceIndexId:92372168,currency:'CNY',checkIntervalSeconds:3600};
const sp = () => ({status:true,indexDetailHolder:{status:true,indexDetail:{indexId:92372168,indexCode:'SPCLLHCP',currencyCode:'CNY',indexReturnType:'P-',publishedTime:now-60000}},indexPerformanceHolder:{status:true,indexPerformance:{priceReturn:{indexId:92372168,indexCode:'SPCLLHCP',currencyCode:'CNY',returnTypeCode:'P-',indexValue:100,effectiveDate:now-86400000,dailyReturn:1,indexName:'Test Price Index'},totalReturn:{indexValue:1000}}},indexLevelsHolder:{status:true,indexLevels:[{indexId:92372168,indexValue:100,effectiveDate:now-86400000}]}});
const futureItem = (symbol='IF0') => ({id:'test-'+symbol,kind:'future',provider:'sina-futures',symbol,currency:'CNY'});
const names = {IF0:'沪深300指数期货连续',IC0:'中证500指数期货连续',IM0:'中证1000指数期货连续',IH0:'上证50指数期货连续',T0:'10年期国债期货连续'};
function futureRow(symbol='IF0') {
  const values=Array(50).fill('0');
  Object.assign(values,{3:'100',7:'99',13:'96',14:'98',36:'2026-10-23',37:'15:00:00',49:names[symbol]});
  return values;
}
const asciiJson = value => JSON.stringify(value).replace(/[^\x00-\x7F]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
const futureText = symbols => symbols.map(symbol=>`var hq_str_nf_${symbol}=${asciiJson(futureRow(symbol).join(','))};`).join('\n');
const historyText = symbol => `/* harmless comment */var _${symbol}=([{"d":"2026-10-21","c":"98"},{"d":"2026-10-22","c":"99"}]);`;

test('CSI validates identity and source time and keeps only matching intraday points',()=>{
  const p=csi(); p.data.intraDayPerfList.push({indexCode:'OTHER',tradeDate:'2026-10-23',tradeTime:'15:00:00',current:900});
  const value=parseCsi(p,csiItem,now);
  assert.equal(value.price,100);
  assert.equal(value.asOf,'2026-10-23T07:00:00.000Z');
  assert.equal(value.history.length,2);
  assert.equal(value.historyKind,'intraday');
  assert.equal(value.iopv,null);
  assert.throws(()=>parseCsi({...csi(),code:'500'},csiItem,now));
  const wrong=csi();wrong.data.intraDayHeader.indexCode='000922';assert.throws(()=>parseCsi(wrong,csiItem,now));
  const future=csi();future.data.intraDayHeader.tradeDate='2026-10-24';assert.throws(()=>parseCsi(future,csiItem,now));
  assert.throws(()=>shanghaiTime('2026-02-30','15:00:00',now));
});

test('S&P uses price return only and does not manufacture an intraday quote clock',()=>{
  const value=parseSpGlobal(sp(),spItem,now);
  assert.equal(value.price,100);
  assert.equal(value.returnType,'price_return');
  assert.equal(value.sourceTimePrecision,'date');
  assert.equal(value.sourceDate,'2026-10-22');
  assert.equal(value.publisherUpdatedAt,new Date(now-60000).toISOString());
  assert.equal(value.previousClose,null);
  for(const changed of [{currencyCode:'USD'},{indexCode:'SPCLLHCT'},{returnTypeCode:'T-'},{indexValue:1000},{effectiveDate:now+120000}]){
    const p=sp();Object.assign(p.indexPerformanceHolder.indexPerformance.priceReturn,changed);
    assert.throws(()=>parseSpGlobal(p,spItem,now));
  }
});

test('Sina futures preserve continuous identity and compute change against source settlement',()=>{
  const records=sinaRecords(futureText(Object.keys(names)));
  for(const symbol of Object.keys(names)){
    const value=parseSinaFuture(records,futureItem(symbol),now);
    assert.equal(value.price,100);
    assert.equal(value.previousSettlement,98);
    assert.equal(value.previousClose,null);
    assert.equal(value.changePercent,(100/98-1)*100);
    assert.equal(value.changeBasis,'source_previous_settlement');
    assert.equal(value.contractCode,null);
    assert.equal(value.contractMode,'provider_continuous');
    assert.equal(value.asOf,'2026-10-23T07:00:00.000Z');
  }
});

test('Sina parsing rejects wrong instrument, malformed fields and executable strings',()=>{
  const wrong=futureRow();wrong[49]='别的证券';assert.throws(()=>parseSinaFuture(new Map([['IF0',wrong]]),futureItem(),now));
  const bad=futureRow();bad[3]='';assert.throws(()=>parseSinaFuture(new Map([['IF0',bad]]),futureItem(),now));
  assert.equal(sinaRecords('var hq_str_nf_IF0=(()=>{throw Error("must not execute")})();').size,0);
  assert.throws(()=>sinaRecords(futureText(['IF0'])+futureText(['IF0'])));
});

test('Sina historical JSON is source dated and never evaluated as JavaScript',()=>{
  const history=parseSinaHistory(historyText('IF0'),futureItem(),now);
  assert.equal(history.length,2);assert.equal(history[1].value,99);
  assert.throws(()=>parseSinaHistory(historyText('IC0'),futureItem(),now));
  assert.throws(()=>parseSinaHistory(historyText('IF0').replace('"99"','(()=>99)()'),futureItem(),now));
  assert.throws(()=>parseSinaHistory(historyText('IF0').replace('2026-10-22','2026-10-25'),futureItem(),now));
});

test('an index with absent source currency stays unknown instead of assuming HKD',()=>{
  const item={id:'hstech',kind:'index',symbol:'HSTECH.HK',currency:null};
  const payload={chart:{result:[{meta:{symbol:'HSTECH.HK',instrumentType:'INDEX',currency:null,regularMarketPrice:100,regularMarketTime:(now-60000)/1000}}],error:null}};
  const parsed=parseYahoo(payload,item,now);
  assert.equal(parsed.price,100);assert.equal(parsed.currency,null);
  assert.throws(()=>parseYahoo(payload,{...item,currency:'HKD'},now));
});

test('five futures share one HTTP request while each observation is validated separately',async()=>{
  const items=Object.keys(names).map(futureItem);
  const previous={items:items.map(x=>({id:x.id,history:[{time:now-86400000,value:99}],historyFetchedAt:new Date(now-10000).toISOString()}))};
  let calls=0;
  const result=await collect(items,previous,{now,budget:1,fetchImpl:async()=>{calls++;return new Response(futureText(Object.keys(names)));}});
  assert.equal(calls,1);assert.equal(result.statistics.httpRequests,1);
  assert.equal(result.statistics.attempted,5);assert.equal(result.statistics.succeeded,5);
  assert.ok(result.items.every(x=>x.price===100));
});

test('a bad member of a futures batch does not discard other valid observations',async()=>{
  const items=['IF0','IC0'].map(futureItem), previous={items:items.map(x=>({id:x.id,price:90,asOf:new Date(now-86400000).toISOString(),history:[{time:now-86400000,value:90}],historyFetchedAt:new Date(now-10000).toISOString()}))};
  const broken=futureText(['IF0','IC0']).replace('hq_str_nf_IC0','hq_str_nf_IM0');
  const result=await collect(items,previous,{now,budget:1,fetchImpl:async()=>new Response(broken)});
  assert.equal(result.items[0].price,100);assert.equal(result.items[1].price,90);
  assert.equal(result.items[1].checkStatus,'error');assert.equal(result.statistics.failed,1);
});

test('history and quote completion order cannot overwrite each other',async()=>{
  const item=futureItem();
  const result=await collect([item],null,{now,budget:2,fetchImpl:async url=>new Response(url.includes('getDailyKLine') ? historyText('IF0') : futureText(['IF0']))});
  assert.equal(result.items[0].price,100);assert.equal(result.items[0].history.length,2);
  assert.equal(result.items[0].historyFetchedAt,new Date(now).toISOString());
  assert.equal(result.statistics.httpRequests,2);assert.equal(result.statistics.historySucceeded,1);
});

test('oldest-attempt rotation serves tail instruments without exceeding the request budget',async()=>{
  const items=Array.from({length:10},(_,i)=>({id:'rot-'+i,kind:'index',symbol:'TEST'+i,currency:'USD'}));
  let previous=null;
  const seen=new Set();
  for(let round=0;round<4;round++){
    let calls=0;
    const result=await collect(items,previous,{now:now+round*60000,budget:3,fetchImpl:async url=>{
      calls++;const symbol=decodeURIComponent(url.split('/chart/')[1].split('?')[0]);seen.add(symbol);
      return Response.json({chart:{result:[{meta:{symbol,currency:'USD',instrumentType:'INDEX',regularMarketPrice:100,regularMarketTime:(now-60000)/1000}}],error:null}});
    }});
    assert.equal(calls,3);assert.equal(result.statistics.httpRequests,3);previous=result;
  }
  assert.equal(seen.size,10);
});

test('cached daily index keeps its source date and does not consume minute quota',async()=>{
  const value=parseSpGlobal(sp(),spItem,now);
  const previous={items:[{id:spItem.id,...value,lastSuccessAt:new Date(now-60000).toISOString(),sourceTimeAdvanced:true}]};
  const result=await collect([spItem],previous,{now,fetchImpl:async()=>{throw Error('should remain cached');}});
  assert.equal(result.statistics.httpRequests,0);assert.equal(result.items[0].checkStatus,'cached_quote');
  assert.equal(result.items[0].asOf,value.asOf);assert.equal(result.items[0].sourceTimeAdvanced,false);
});
