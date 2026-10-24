const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const validNumber = value => typeof value === 'number' && Number.isFinite(value);
const timestamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false, month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '尚无数据';
const format = value => validNumber(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits:4 }) : '—';
const safeUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : null; } catch { return null; } };
const link = (url, text) => safeUrl(url) ? `<a href="${escape(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${escape(text)} ↗</a>` : escape(text);
const labels = { all:'全部观察标的', us:'美国主要指数', cn:'中国市场与红利策略', global:'全球主要指数', futures:'重要期货', etf:'场内ETF', otc:'场外基金', saved:'我的关注', issues:'缺失与异常数据' };
const states = { ok:'本轮取得源数据', error:'本轮读取失败，保留原记录', unconfigured:'尚未接入可核验的数据源', not_due:'净值按小时核查', cached_quote:'日终指数按小时核查', reference_only:'已核验日终参考 · 非自动刷新', backoff:'数据源暂缓重试', budget_deferred:'按预算轮转，保留原记录' };
const providerNames = { yahoo:'Yahoo Finance · 第三方行情', csindex:'中证指数官网 · 公开指数', spglobal:'标普道琼斯官网 · 日终指数', 'sina-futures':'新浪财经 · 期货连续报价', 'eastmoney-nav':'天天基金 · 公开净值' };
const hasValue = (item,obs) => validNumber(item.kind === 'fund' ? obs?.nav : obs?.price);
const hasIssue = (item,obs) => !hasValue(item,obs) || ['error','backoff'].includes(obs?.checkStatus) || !!obs?.historyError || !!obs?.referenceFallback;
const sourceTime = obs => obs.sourceTimePrecision === 'date' ? `${obs.sourceDate || '未知'}（日终日期）` : timestamp(obs.asOf);
let catalog = [], runtime = {}, snapshot = null, observations = new Map(), group = 'all', selected = 'sp500', busy = false;
let saved = new Set();
try { const ids = JSON.parse(localStorage.getItem('shixiaoxin-watchlist') || '[]'); if (Array.isArray(ids)) saved = new Set(ids.filter(x => typeof x === 'string')); } catch { /* local storage unavailable */ }

function renderRows() {
  const term = $('search').value.trim().toLowerCase();
  const rows = catalog.filter(x => (group === 'all' || (group === 'saved' ? saved.has(x.id) : group === 'issues' ? hasIssue(x,observations.get(x.id)) : x.group === group)) && (!term || [x.name, x.code, x.symbol, observations.get(x.id)?.sourceName].join(' ').toLowerCase().includes(term)));
  $('listTitle').textContent = labels[group];
  $('visibleCount').textContent = rows.length + ' 项';
  $('marketRows').innerHTML = rows.map(item => {
    const obs = observations.get(item.id) || {};
    const fund = item.kind === 'fund';
    const price = fund ? obs.nav : obs.price;
    const change = !fund && ['source_regular_market_daily','source_previous_settlement','source_daily_return'].includes(obs.changeBasis) && validNumber(obs.changePercent) ? `<span class="change ${obs.changePercent >= 0 ? 'green' : 'red'}" title="${obs.changeBasis === 'source_previous_settlement' ? '相对源前结算价' : '数据源日涨跌幅'}">${obs.changePercent >= 0 ? '+' : ''}${obs.changePercent.toFixed(2)}%</span>` : '';
    const time = fund ? '净值日期 ' + (obs.navDate || '未知') : (obs.sourceTimePrecision === 'date' ? '' : '源报价 ') + sourceTime(obs);
    const state = obs.referenceFallback ? '已核验日终参考 · 云端源读取未成功' : item.kind === 'etf' ? 'IOPV / 溢价：未验证' : fund ? '申购限额：渠道待核查' : states[obs.checkStatus] || '等待云端数据';
    const extra = !hasValue(item,obs) ? '暂无数值：' + (obs.error || states[obs.checkStatus] || '等待源读取') : obs.historyError ? '历史读取失败，报价状态另行核查' : (fund || item.kind === 'etf') && ['error','backoff','budget_deferred'].includes(obs.checkStatus) ? states[obs.checkStatus] : '';
    const statusError = extra ? `<div class="rowstate">${escape(extra)}</div>` : '';
    const unit = fund ? '单位净值' : item.kind === 'index' ? '指数点' : item.kind === 'future' ? item.provider === 'sina-futures' ? '连续报价 · 映射月份未知' : '期货 / 源合约' : item.currency || '币种未知';
    return `<article class="marketrow ${selected === item.id ? 'selected' : ''}"><button class="favorite ${saved.has(item.id) ? 'saved' : ''}" data-save="${escape(item.id)}" aria-label="${saved.has(item.id) ? '取消关注' : '关注'} ${escape(item.name)}" aria-pressed="${saved.has(item.id)}">${saved.has(item.id) ? '★' : '☆'}</button><button class="selectrow" data-select="${escape(item.id)}"><span class="rowname">${escape(fund && obs.sourceName ? obs.sourceName : item.name)}</span><span class="rowcode">${escape(item.code || item.symbol || '待接入')} · ${escape(unit)}${fund ? '' : obs.observationType === 'official_end_of_day' ? ' · 日终记录' : ' · 时延未知'}</span></button><div class="rowvalue"><div class="price ${validNumber(price) ? '' : 'pending'}">${format(price)}${change}</div><div class="rowtime">${escape(time)}</div><div class="rowstate">${escape(state)}</div>${statusError}</div></article>`;
  }).join('') || '<p class="empty">没有匹配标的。可切换分类或调整搜索。</p>';
  document.querySelectorAll('[data-save]').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.save;
    saved.has(id) ? saved.delete(id) : saved.add(id);
    try { localStorage.setItem('shixiaoxin-watchlist', JSON.stringify([...saved])); } catch { /* browser privacy mode */ }
    renderRows();
  }));
  document.querySelectorAll('[data-select]').forEach(button => button.addEventListener('click', () => { selected = button.dataset.select; renderRows(); renderDetails(true); }));
}

function renderDetails(changeChart = false) {
  const item = catalog.find(x => x.id === selected);
  if (!item) return;
  const obs = observations.get(item.id) || {};
  const fund = item.kind === 'fund';
  const detailRow = (key, value) => `<div class="detailrow"><b>${escape(key)}</b>${value}</div>`;
  $('details').innerHTML = detailRow('标的', escape(obs.sourceName || item.name))
    + detailRow('源状态', escape(states[obs.checkStatus] || '等待云端数据'))
    + detailRow(fund ? '净值对应日期' : '源数据时间', escape(fund ? obs.navDate || '未知' : sourceTime(obs)))
    + (!hasValue(item,obs) ? detailRow('缺失原因',escape(obs.error || states[obs.checkStatus] || '等待首次成功读取')) : '')
    + detailRow('后台最近成功读取', escape(timestamp(obs.lastSuccessAt)))
    + detailRow('最近尝试读取', escape(timestamp(obs.lastAttemptAt)))
    + (obs.referenceFallback ? detailRow('日终参考核验时间',escape(timestamp(obs.referenceVerifiedAt))) + detailRow('参考性质','本次由公开编制方接口核验的日终记录；后台接口拒绝访问时保留，不能视为自动更新。') + detailRow('参考核验来源',link(obs.referenceRequestUrl,'编制方原始公开接口')) : '')
    + (obs.nextRetryAt ? detailRow('下次重试不早于',escape(timestamp(obs.nextRetryAt))) : '')
    + detailRow('来源', link(obs.sourceUrl || item.sourceUrl, obs.source || '查看标的来源'))
    + (!fund ? detailRow('行情性质', obs.observationType === 'official_end_of_day' ? '编制方公开日终价格指数；仅日级日期，按小时核查。' : obs.observationType === 'provider_continuous_future' ? '源连续合约报价；时延未知，映射月份未披露。' : '公开源报价；时延未知，不声明实时。') : detailRow('净值性质', '净值对应日期按源记录展示；实际发布时刻未知，QDII可能滞后。'))
    + (item.kind === 'future' ? detailRow('合约', escape(obs.sourceName || '尚未取得源合约记录')) : '')
    + (obs.changeBasis === 'source_previous_settlement' ? detailRow('涨跌口径', '相对源前结算价 ' + escape(format(obs.previousSettlement)) + '；不同于股票的前收盘价口径。') : '')
    + (obs.publisherUpdatedAt ? detailRow('编制方发布记录时间',escape(timestamp(obs.publisherUpdatedAt))) : '')
    + detailRow('检查方式', item.kind === 'fund' || item.checkIntervalSeconds === 3600 ? '按小时核查；源日期独立显示。' : item.priority === 'core' ? '每分钟任务优先核查；不保证准点。' : '每分钟任务按预算轮转；以最近读取时间为准。')
    + (obs.historyError ? detailRow('历史曲线状态',escape(obs.historyError) + '；当前报价与历史请求状态分开展示。') : '')
    + (item.kind === 'etf' ? detailRow('IOPV与溢价', '缺少可验证的官方IOPV，不计算溢价。历史NAV不会代替IOPV。') : '')
    + (fund ? detailRow('渠道与申购上限', '未知。直销与具体代销渠道需分别查看公告和实际下单页。') : '')
    + (fund && item.officialUrl ? detailRow('基金公司', link(item.officialUrl, '官方核查入口')) : '')
    + (item.note ? `<p>${escape(item.note)}</p>` : '')
    + (obs.error ? `<p class="amber">${escape(obs.error)}</p>` : '');
  if (changeChart || snapshot) {
    $('chartTitle').textContent = item.name;
    const points = (obs.history || []).filter(p => validNumber(p.time) && validNumber(p.value)).sort((a,b) => a.time - b.time);
    if (points.length > 1) {
      const start = points[0].time, end = points.at(-1).time;
      const rawMin = Math.min(...points.map(p=>p.value)), rawMax = Math.max(...points.map(p=>p.value));
      const pad = (rawMax - rawMin || Math.abs(rawMin) * .01 || 1) * .15;
      const min = rawMin - pad, max = rawMax + pad;
      const coords = points.map(p=>`${(64 + (p.time - start) / (end - start || 1) * 436).toFixed(2)},${(252 - (p.value - min) / (max - min) * 224).toFixed(2)}`).join(' ');
      const day = t => obs.historyKind === 'intraday' ? new Date(t).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,hour:'2-digit',minute:'2-digit'}) : new Date(t).toLocaleDateString('zh-CN',{ timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit' });
      const grid = [0,.5,1].map(t=>`<line x1="64" x2="500" y1="${28+t*224}" y2="${28+t*224}" stroke="#26364b"/><text x="56" y="${32+t*224}" fill="#8d9eb6" text-anchor="end" font-size="10">${escape(format(max-t*(max-min)))}</text>`).join('');
      $('chart').innerHTML = `<svg viewBox="0 0 520 290" role="img" aria-label="${escape(item.name)} ${points.length}条源记录历史曲线" style="width:100%;height:100%">${grid}<polyline points="${coords}" fill="none" stroke="#91bcff" stroke-width="2.5" stroke-linejoin="round"/><text x="64" y="278" fill="#8d9eb6" font-size="10">${escape(day(start))}</text><text x="500" y="278" fill="#8d9eb6" font-size="10" text-anchor="end">${escape(day(end))}</text></svg>`;
      $('chartHint').textContent = (obs.referenceFallback ? '已核验日终参考，云端源读取未成功，不声明自动更新。' : '') + `${obs.historySource || obs.source || '源记录'}。` + (fund ? `最近${points.length}条净值记录，末次净值日期 ${obs.navDate}。` : obs.historyKind === 'intraday' ? `最近${points.length}条源分时记录；源时间另见核查卡片。` : `最近${points.length}条源日线，末根可能未完成。`) + '连线仅辅助阅读，不代表逐笔行情。';
    } else {
      $('chart').innerHTML = `<p class="empty">${points.length === 1 ? '行情源仅提供1条历史记录，尚不能形成曲线。' : obs.historyError ? '历史源读取失败，当前报价请看列表。' : '尚无足够的源历史记录，等待后台核查。'}<br>不插入估算点，不绘制模拟走势。</p>`;
      $('chartHint').textContent = '只绘制后台读取的源记录；不把网页时间当行情时间。';
    }
    const external = safeUrl(obs.sourceUrl || item.sourceUrl);
    $('chartExternal').hidden = !external;
    if (external) $('chartExternal').href = external;
  }
}

function renderStatus() {
  if (!snapshot) return;
  const age = (Date.now() - Date.parse(snapshot.generatedAt)) / 1000;
  const target = snapshot.scheduler?.targetIntervalSeconds || 300;
  const late = !Number.isFinite(age) || age > Math.max(target * 3, 180);
  $('cloudCheck').textContent = timestamp(snapshot.generatedAt);
  $('cadence').textContent = `${snapshot.scheduler?.name === 'cloudflare-cron' ? '每分钟任务 · 按预算轮转' : '备用任务'} · 不保证准点`;
  $('cloudState').textContent = late ? '快照超时，可能未运行' : '已取得快照 · 非实时保证';
  $('cloudState').className = late ? 'amber' : '';
  const s = snapshot.statistics || {};
  const available = catalog.filter(x=>hasValue(x,observations.get(x.id))).length;
  const issues = catalog.filter(x=>hasIssue(x,observations.get(x.id))).length;
  const referenceCount = snapshot.items.filter(x=>x.referenceFallback).length;
  $('totalCount').textContent = `${available} / ${catalog.length}`;
  $('coverageNote').textContent = `${catalog.length-available}项暂无数值 · ${referenceCount}项日终参考 · ${issues}项源或历史异常`;
  $('issuesTab').textContent = `缺失 / 异常 ${issues}`;
  $('requestCount').textContent = `${s.succeeded ?? '—'} / ${s.attempted ?? '—'}`;
  $('advancedCount').textContent = s.newQuoteTimestamps ?? '—';
  $('requestBudget').textContent = `${s.httpRequests ?? '—'}次HTTP请求（含历史）；读取成功不等于新报价`;
  $('healthNote').textContent = `${late ? '快照已超时，请检查后台。' : ''}页面每60秒读取快照；后台按预算轮转，主要美股指数优先。${s.newQuoteTimestamps ?? 0}项源时间推进、${s.newNavDates ?? 0}项净值日期推进、${s.failed ?? 0}项读取失败、${s.deferred ?? 0}项轮转暂缓。日终指数与净值按小时核查，源时间不变时不会冒充新行情。`;
  const sources = new Map();
  for (const item of catalog) {
    const key = item.kind === 'fund' ? 'eastmoney-nav' : item.provider || 'yahoo';
    if (!sources.has(key)) sources.set(key,[]);
    sources.get(key).push(item);
  }
  const sourceCards = [...sources].map(([key,items])=>{
    const count = items.filter(x=>hasValue(x,observations.get(x.id))).length;
    const refs = items.filter(x=>observations.get(x.id)?.referenceFallback).length;
    const note = key === 'spglobal' ? '价格收益口径，日终日期按源记录；按小时核查。' : key === 'csindex' ? '指数官网点位与分时序列；不拿ETF价格替代指数。' : key === 'sina-futures' ? '连续合约报价；映射月份未知，涨跌相对前结算价。' : key === 'eastmoney-nav' ? '净值对应日期独立显示；渠道限额和实际发布时刻未知。' : '源常规交易时段报价，时延未知；源仅有一条历史记录时不补画曲线。';
    return `<div><strong>${escape(providerNames[key]||key)}</strong><p>${count} / ${items.length} 项有数值。${refs ? `其中${refs}项为已核验日终参考，云端读取未成功。` : ''}${escape(note)} ${link(items[0].sourceUrl,'核查来源')}</p></div>`;
  }).join('');
  const backendStatus = snapshot.scheduler?.name === 'cloudflare-cron' ? link(runtime.healthUrl, '后台健康状态') : link('https://github.com/sanqingzushi/-2/actions/workflows/monitor.yml', '后台运行记录');
  $('sourceInfo').innerHTML = sourceCards + `<div><strong>后台：${escape(snapshot.scheduler?.name)}</strong><p>生成时间 ${escape(timestamp(snapshot.generatedAt))}；采集版本 ${escape(snapshot.collectorVersion || '旧版')}。${backendStatus} · ${link(runtime.snapshotUrl, '原始快照')}</p></div>`;
}

async function fetchSnapshot() {
  if (busy) return;
  busy = true;
  $('refreshBtn').disabled = true;
  $('pageCheck').textContent = timestamp(new Date().toISOString());
  try {
    const url = new URL(runtime.snapshotUrl);
    if (url.protocol !== 'https:') throw new Error('数据源地址无效');
    url.searchParams.set('check', String(Math.floor(Date.now() / 60000)));
    const response = await fetch(url, { cache:'no-store', signal:AbortSignal.timeout(18000) });
    if (!response.ok) throw new Error(response.status === 404 ? '后台首个快照尚未发布' : '快照请求失败 HTTP ' + response.status);
    const data = await response.json();
    if (data.schemaVersion !== 1 || !Array.isArray(data.items) || !Number.isFinite(Date.parse(data.generatedAt)) || Date.parse(data.generatedAt) > Date.now() + 60000) throw new Error('快照格式或时间异常');
    if (snapshot && Date.parse(data.generatedAt) < Date.parse(snapshot.generatedAt)) throw new Error('收到较旧缓存，保留当前快照');
    snapshot = data;
    observations = new Map(data.items.filter(Boolean).map(x => [x.id, x]));
    renderStatus(); renderRows(); renderDetails();
  } catch (error) {
    $('cloudState').textContent = snapshot ? '本次页面请求失败，保留旧快照' : '尚未取得云端快照';
    $('cloudState').className = 'amber';
    $('healthNote').textContent = `${error.message}。页面请求时间不代表后台采集时间，现有数字保留原源时间。`;
  } finally { busy = false; $('refreshBtn').disabled = false; }
}

document.querySelectorAll('[data-group]').forEach(button => button.addEventListener('click', () => {
  group = button.dataset.group;
  document.querySelectorAll('[data-group]').forEach(x => { x.classList.toggle('active', x === button); x.setAttribute('aria-pressed', String(x === button)); });
  renderRows();
}));
$('search').addEventListener('input', renderRows);
$('refreshBtn').addEventListener('click', fetchSnapshot);
try {
  const values = await Promise.all(['./data/catalog.json','./data/runtime.json'].map(async url => { const r = await fetch(url, { cache:'no-store' }); if (!r.ok) throw new Error('配置请求失败'); return r.json(); }));
  [catalog, runtime] = values;
  $('totalCount').textContent = `— / ${catalog.length}`;
  $('cadence').textContent = `${runtime.nominalIntervalSeconds === 60 ? '每分钟' : '每5分钟'} · 等待后台快照验证`;
  renderRows(); renderDetails(true);
  await fetchSnapshot();
  setInterval(fetchSnapshot, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchSnapshot(); });
} catch { $('healthNote').textContent = '标的目录或云端配置读取失败，请稍后重新打开网页。'; }
