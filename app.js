const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const validNumber = value => typeof value === 'number' && Number.isFinite(value);
const timestamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false, month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '尚无数据';
const format = value => validNumber(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits:4 }) : '—';
const safeUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : null; } catch { return null; } };
const link = (url, text) => safeUrl(url) ? `<a href="${escape(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${escape(text)} ↗</a>` : escape(text);
const labels = { all:'全部观察标的', us:'美国主要指数', cn:'中国市场与红利策略', global:'全球主要指数', futures:'重要期货', etf:'场内ETF', otc:'场外基金', saved:'我的关注' };
const states = { ok:'本轮取得源数据', error:'本轮请求失败，保留旧值', unconfigured:'结构化行情未接入', not_due:'净值按小时核查', backoff:'数据源限流退避', budget_deferred:'本轮预算暂缓，保留旧值' };
let catalog = [], runtime = {}, snapshot = null, observations = new Map(), group = 'all', selected = 'sp500', busy = false;
let saved = new Set();
try { const ids = JSON.parse(localStorage.getItem('shixiaoxin-watchlist') || '[]'); if (Array.isArray(ids)) saved = new Set(ids.filter(x => typeof x === 'string')); } catch { /* local storage unavailable */ }

function renderRows() {
  const term = $('search').value.trim().toLowerCase();
  const rows = catalog.filter(x => (group === 'all' || (group === 'saved' ? saved.has(x.id) : x.group === group)) && (!term || [x.name, x.code, x.symbol, observations.get(x.id)?.sourceName].join(' ').toLowerCase().includes(term)));
  $('listTitle').textContent = labels[group];
  $('visibleCount').textContent = rows.length + ' 项';
  $('marketRows').innerHTML = rows.map(item => {
    const obs = observations.get(item.id) || {};
    const fund = item.kind === 'fund';
    const price = fund ? obs.nav : obs.price;
    const change = !fund && validNumber(obs.changePercent) ? `<span class="change ${obs.changePercent >= 0 ? 'green' : 'red'}">${obs.changePercent >= 0 ? '+' : ''}${obs.changePercent.toFixed(2)}%</span>` : '';
    const time = fund ? '净值披露日 ' + (obs.navDate || '未知') : '源报价 ' + timestamp(obs.asOf);
    const state = item.kind === 'etf' ? 'IOPV / 溢价：未验证' : fund ? '申购限额：渠道待核查' : states[obs.checkStatus] || '等待云端数据';
    const statusError = ['error','backoff','budget_deferred'].includes(obs.checkStatus) ? `<div class="rowstate">${escape(states[obs.checkStatus])}</div>` : '';
    return `<article class="marketrow ${selected === item.id ? 'selected' : ''}"><button class="favorite ${saved.has(item.id) ? 'saved' : ''}" data-save="${escape(item.id)}" aria-label="${saved.has(item.id) ? '取消关注' : '关注'} ${escape(item.name)}" aria-pressed="${saved.has(item.id)}">${saved.has(item.id) ? '★' : '☆'}</button><button class="selectrow" data-select="${escape(item.id)}"><span class="rowname">${escape(fund && obs.sourceName ? obs.sourceName : item.name)}</span><span class="rowcode">${escape(item.code || item.symbol || '待接入')} · ${escape(fund ? '单位净值' : item.kind === 'future' ? '期货 / 源合约' : item.currency || '指数')}${fund ? '' : ' · 时延未知'}</span></button><div class="rowvalue"><div class="price ${validNumber(price) ? '' : 'pending'}">${format(price)}${change}</div><div class="rowtime">${escape(time)}</div><div class="rowstate">${escape(state)}</div>${statusError}</div></article>`;
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
    + detailRow('源数据时间', escape(fund ? obs.navDate || '未知' : timestamp(obs.asOf)))
    + detailRow('最近成功读取', escape(timestamp(obs.lastSuccessAt)))
    + detailRow('最近尝试读取', escape(timestamp(obs.lastAttemptAt)))
    + detailRow('来源', link(obs.sourceUrl || item.sourceUrl, obs.source || '查看标的来源'))
    + (!fund ? detailRow('行情性质', '源常规交易时段报价；时延未知，不声明实时。') : detailRow('净值性质', '第三方披露净值，日期按原记录；QDII可能滞后。'))
    + (item.kind === 'future' ? detailRow('合约', escape(obs.sourceName || '尚未取得具体合约；不填造合约月份')) : '')
    + (item.kind === 'etf' ? detailRow('IOPV与溢价', '缺少可验证的官方IOPV，不计算溢价。历史NAV不会代替IOPV。') : '')
    + (fund ? detailRow('渠道与申购上限', '未知。直销与具体代销渠道需分别查看公告和实际下单页。') : '')
    + (fund && item.officialUrl ? detailRow('基金公司', link(item.officialUrl, '官方核查入口')) : '')
    + (item.note ? `<p>${escape(item.note)}</p>` : '')
    + (obs.error ? `<p class="amber">${escape(obs.error)}</p>` : '');
  if (changeChart) {
    $('chartTitle').textContent = item.name;
    if (item.tvSymbol) {
      const url = new URL('https://s.tradingview.com/widgetembed/');
      for (const [k,v] of Object.entries({ symbol:item.tvSymbol, interval:item.kind === 'future' ? '60' : 'D', theme:'dark', style:'1', timezone:'Asia/Shanghai', locale:'zh_CN', hidesidetoolbar:'1', symboledit:'0', saveimage:'0', hideideas:'1' })) url.searchParams.set(k,v);
      $('chart').innerHTML = `<iframe title="${escape(item.name)} 第三方行情图表" src="${escape(url.href)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    } else $('chart').innerHTML = '<p class="empty">该标的未配置嵌入图表。<br>请核查来源页面，本站不绘制估算行情。</p>';
    const external = safeUrl(obs.sourceUrl || item.sourceUrl);
    $('chartExternal').hidden = !external;
    if (external) $('chartExternal').href = external;
  }
}

function renderStatus() {
  if (!snapshot) return;
  const age = (Date.now() - Date.parse(snapshot.generatedAt)) / 1000;
  const target = snapshot.scheduler?.targetIntervalSeconds || 300;
  const late = !Number.isFinite(age) || age > Math.max(target * 3, 900);
  $('cloudCheck').textContent = timestamp(snapshot.generatedAt);
  $('cadence').textContent = `${snapshot.scheduler?.name === 'cloudflare-cron' ? '每分钟' : '每5分钟'} · 不保证准点`;
  $('cloudState').textContent = late ? '快照超时，可能未运行' : '已取得快照 · 非实时保证';
  $('cloudState').className = late ? 'amber' : '';
  const s = snapshot.statistics || {};
  $('requestCount').textContent = `${s.succeeded ?? '—'} / ${s.attempted ?? '—'}`;
  $('advancedCount').textContent = s.newQuoteTimestamps ?? '—';
  $('healthNote').textContent = `${late ? '快照已较久未生成，请检查后台运行记录。' : ''}页面每60秒请求一次快照；本轮 ${s.newQuoteTimestamps ?? 0} 项源报价时间推进、${s.newNavDates ?? 0} 项净值披露日推进、${s.failed ?? 0} 项源请求失败。后台读取成功也可能仍是收盘价或延迟数据。`;
  const configured = catalog.filter(x => x.symbol).length;
  const withQuote = snapshot.items.filter(x => validNumber(x.price)).length;
  const withNav = snapshot.items.filter(x => validNumber(x.nav)).length;
  $('sourceInfo').innerHTML = `<div><strong>行情：Yahoo Finance 公共接口</strong><p>${withQuote} / ${configured} 项有价格记录。每行保留源报价时间；时延未知，无实时承诺。${link('https://finance.yahoo.com/', '行情源')}</p></div><div><strong>净值：天天基金公开披露</strong><p>${withNav} 项有单位净值，按小时核查；实际披露日单独显示。IOPV与渠道限额尚未接入。</p></div><div><strong>后台：${escape(snapshot.scheduler?.name)}</strong><p>生成时间 ${escape(timestamp(snapshot.generatedAt))}。${link('https://github.com/sanqingzushi/-2/actions/workflows/monitor.yml', '后台运行记录')} · ${link(runtime.snapshotUrl, '原始快照')}</p></div>`;
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
  $('totalCount').textContent = catalog.length;
  $('cadence').textContent = '每5分钟 · GitHub Actions';
  renderRows(); renderDetails(true);
  await fetchSnapshot();
  setInterval(fetchSnapshot, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchSnapshot(); });
} catch { $('healthNote').textContent = '标的目录或云端配置读取失败，请稍后重新打开网页。'; }
