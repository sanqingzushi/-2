// Source-specific parsers. Remote JavaScript is treated as text, never executed.
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const positive = value => numeric(value) && value > 0;
const iso = value => new Date(value).toISOString();
export const sourceNames = {
  yahoo: 'Yahoo Finance 公共图表接口（第三方）',
  csindex: '中证指数官网公开数据',
  spglobal: '标普道琼斯指数官网公开日终数据',
  'sina-futures': '新浪财经期货公开报价（第三方）',
  'eastmoney-nav': '天天基金公开净值披露（第三方）'
};

export function shanghaiTime(date, time, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}:\d{2}$/.test(time || '')) throw new Error('源日期或时间格式无效');
  const value = Date.parse(`${date}T${time}+08:00`);
  if (!Number.isFinite(value) || new Date(value + 28800000).toISOString().slice(0,19) !== `${date}T${time}`) throw new Error('源日期或时间无效');
  if (value > now + 60000) throw new Error('源数据时间在未来');
  return value;
}

export function parseCsi(payload, item, now = Date.now()) {
  const data = payload?.data, header = data?.intraDayHeader;
  if (String(payload?.code) !== '200' || header?.indexCode !== item.symbol || item.kind !== 'index' || item.currency !== 'CNY') throw new Error('中证源状态、代码或币种配置不一致');
  if (!positive(header.current)) throw new Error('中证源未返回有效指数点位');
  const asOf = shanghaiTime(header.tradeDate, header.tradeTime, now);
  const history = (data.intraDayPerfList || []).filter(x => x.indexCode === item.symbol && x.tradeDate === header.tradeDate && positive(x.current)).flatMap(x => {
    try { const time = shanghaiTime(x.tradeDate, x.tradeTime, now); return time <= asOf ? [{ time, value:x.current }] : []; } catch { return []; }
  }).sort((a,b)=>a.time-b.time).slice(-240);
  return {
    price:header.current, currency:'CNY', unit:'指数点', asOf:iso(asOf),
    previousClose:positive(header.closePre) ? header.closePre : null,
    changePercent:numeric(header.changePct) ? header.changePct : null,
    changeBasis:numeric(header.changePct) ? 'source_regular_market_daily' : null,
    source:sourceNames.csindex, sourceUrl:item.sourceUrl, sourceSymbol:item.symbol,
    sourceName:'中证红利低波动指数', sourceInstrumentType:'INDEX', exchangeTimezone:'Asia/Shanghai',
    sourceDelaySeconds:null, delayStatus:'unknown', observationType:'official_index_observation',
    history, historyKind:'intraday', historySource:sourceNames.csindex, iopv:null, premiumPercent:null
  };
}

export function parseSpGlobal(payload, item, now = Date.now()) {
  const detail = payload?.indexDetailHolder?.indexDetail;
  const quote = payload?.indexPerformanceHolder?.indexPerformance?.priceReturn;
  if (payload?.status !== true || !payload.indexDetailHolder.status || !payload.indexPerformanceHolder?.status || !payload.indexLevelsHolder?.status) throw new Error('标普源未返回有效公开数据');
  if (detail?.indexCode !== item.symbol || detail.indexId !== item.sourceIndexId || detail.currencyCode !== item.currency || detail.indexReturnType !== 'P-' || detail.isLoginRequired === 'Y') throw new Error('标普指数代码、币种或价格收益口径不一致');
  if (quote?.indexId !== item.sourceIndexId || quote.indexCode !== item.symbol || quote.returnTypeCode !== 'P-' || quote.currencyCode !== item.currency || !positive(quote.indexValue) || !positive(quote.effectiveDate)) throw new Error('标普价格指数记录不一致');
  if (quote.effectiveDate > now + 60000) throw new Error('标普源日期在未来');
  const history = (payload.indexLevelsHolder.indexLevels || []).filter(x => x.indexId === item.sourceIndexId && positive(x.indexValue) && positive(x.effectiveDate) && x.effectiveDate <= quote.effectiveDate).sort((a,b)=>a.effectiveDate-b.effectiveDate).slice(-60).map(x=>({time:x.effectiveDate,value:x.indexValue}));
  const last = history.at(-1);
  if (!last || last.time !== quote.effectiveDate || Math.abs(last.value - quote.indexValue) > 0.0001) throw new Error('标普最新日终值与价格指数历史记录不一致');
  return {
    price:quote.indexValue, currency:item.currency, unit:'指数点', asOf:iso(quote.effectiveDate),
    sourceDate:iso(quote.effectiveDate).slice(0,10), sourceTimePrecision:'date',
    publisherUpdatedAt:positive(detail.publishedTime) && detail.publishedTime <= now + 60000 ? iso(detail.publishedTime) : null,
    previousClose:null, changePercent:numeric(quote.dailyReturn) ? quote.dailyReturn : null,
    changeBasis:numeric(quote.dailyReturn) ? 'source_daily_return' : null,
    source:sourceNames.spglobal, sourceUrl:item.sourceUrl, sourceSymbol:item.symbol,
    sourceName:quote.indexName, sourceInstrumentType:'INDEX', returnType:'price_return',
    sourceDelaySeconds:null, delayStatus:'end_of_day', observationType:'official_end_of_day',
    history, historyKind:'daily', historySource:sourceNames.spglobal, iopv:null, premiumPercent:null
  };
}

export function sinaRecords(text) {
  const records = new Map();
  for (const match of text.matchAll(/\bvar\s+hq_str_nf_((?:IF|IC|IM|IH|T)0)\s*=\s*("(?:[^"\\]|\\.)*")\s*;/g)) {
    if (records.has(match[1])) throw new Error('期货源返回重复代码');
    records.set(match[1], JSON.parse(match[2]).split(','));
  }
  return records;
}

const futureNames = { IF0:'沪深300', IC0:'中证500', IM0:'中证1000', IH0:'上证50', T0:'10年期国债' };
function sourceNumber(value) {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function parseSinaFuture(records, item, now = Date.now()) {
  const row = records.get(item.symbol), expected = futureNames[item.symbol];
  if (!expected || !row || row.length !== 50 || !row[49].includes(expected) || !row[49].includes('期货连续') || item.kind !== 'future' || item.currency !== 'CNY') throw new Error('期货源代码、名称、连续合约或字段结构不一致');
  // Verified against Sina's own modular.futures_hq.format case 2 (which prepends the symbol).
  const price = sourceNumber(row[3]), settlement = sourceNumber(row[14]);
  if (!positive(price)) throw new Error('期货源未返回有效价格');
  const asOf = shanghaiTime(row[36],row[37],now);
  return {
    price, currency:'CNY', asOf:iso(asOf), previousClose:null,
    previousSettlement:positive(settlement) ? settlement : null,
    changePercent:positive(settlement) ? (price / settlement - 1) * 100 : null,
    changeBasis:positive(settlement) ? 'source_previous_settlement' : null,
    source:sourceNames['sina-futures'], sourceUrl:item.sourceUrl, sourceSymbol:item.symbol,
    sourceName:row[49], sourceInstrumentType:'FUTURE', exchange:'CFFEX', exchangeTimezone:'Asia/Shanghai',
    contractMode:'provider_continuous', contractCode:null,
    sourceDelaySeconds:null, delayStatus:'unknown', observationType:'provider_continuous_future',
    iopv:null, premiumPercent:null
  };
}

export function parseSinaHistory(text, item, now = Date.now()) {
  if (!futureNames[item.symbol]) throw new Error('期货历史代码未验证');
  const match = /^\s*(?:\/\*[\s\S]*?\*\/\s*)?var\s+_([A-Z0-9]+)\s*=\s*\((\[[\s\S]*\])\)\s*;?\s*$/.exec(text);
  if (!match || match[1] !== item.symbol) throw new Error('期货历史回调代码或JSON格式不一致');
  const rows = JSON.parse(match[2]);
  if (!Array.isArray(rows) || !rows.length) throw new Error('期货源未返回历史日线');
  const points = rows.slice(-60).map(x=>({time:shanghaiTime(x.d,'00:00:00',now),value:sourceNumber(x.c)}));
  if (points.some(x=>!positive(x.value))) throw new Error('期货历史日线价格无效');
  if (points.some((x,i)=>i>0 && x.time <= points[i-1].time)) throw new Error('期货历史日线顺序或日期重复异常');
  return points;
}
