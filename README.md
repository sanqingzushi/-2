# 石小鑫的全球指数与基金观测平台

网址：<https://sanqingzushi.github.io/-2/>

## 当前在线状态

- 前台：GitHub Pages，`main / (root)`；手机可直接打开上方网址。
- 后台：Cloudflare Workers + D1，<https://2.2815956617.workers.dev/>。
- 健康检查：<https://2.2815956617.workers.dev/health>；公开快照：<https://2.2815956617.workers.dev/api/snapshot>。
- 每分钟启动任务，主要美股指数及对应期货优先，其余行情按最近读取时间公平轮转；日终指数与净值按小时核查。网页每60秒读取结果，关闭网页不影响云端任务。
- GitHub Actions 自动采集已停用，保留手动备用入口，避免重复请求数据源。

2026-10-24（北京时间）初始上线核查：相邻快照11:32:27与11:33:26实际推进，采集开始时间相隔59.246秒。该版本已有46项行情和12项净值，另8项待接入。本次更新为原8项增加独立适配器，行情源代码、价格/总收益口径、源时间与合约类型均校验。当前是否读取成功以线上完整度和逐项状态为准，不把接口配置数当作成功数。GitHub旧调度曾相隔超过2小时，不视为稳定5分钟监测。

公开手机页面，GitHub Pages 从 `main / (root)` 发布。无账户连接、自动下单或买入信号。关注标的保存在当前浏览器，不上传个人持仓或资产。

## 已实现

- 66项观察目录：纳指100与纳斯达克综合分别列示，标普500、道琼斯、VIX、中国宽基、全球主要股指、红利低波策略、重要期货、10只场内ETF与12只场外基金。
- 54项结构化行情配置、12项基金净值配置。新增恒生科技、中证红利低波动、标普红利低波50与5类中金所连续期货；接口失败仍明确保留空值或原记录。
- 网页每60秒请求Cloudflare快照；任务按48次HTTP请求预算轮转，核心指数与美股期货优先，其余标的按最久未尝试顺序调度。单项频率以最近读取时间为准，快照超过3分钟未生成时提示超时。
- 各标的独立显示源报价时间/净值披露日、最近读取时间、本轮状态、来源及错误。相同源时间不会计为新报价。
- 失败时保留原价格、原源时间和上次成功时间，另记失败。源时间倒退或处于未来会被拒绝。
- 场外净值每小时核查，基金名称用已验证源全名。渠道限额、开放状态、IOPV和溢价当前均未知，保留空值。
- 历史曲线按源类型显示：Yahoo日线、中证官网分时、标普日终价格指数、期货连续日线、基金净值。一条历史记录不能形成曲线，界面明确说明，不补画走势。
- 完整度统计与「缺失 / 异常」筛选，区分当前数值、历史读取错误与正常轮转；历史请求失败不抹去可用报价。
- 搜索、分类、浏览器关注清单、手机布局与“石小鑫观测平台”快捷方式名称。

## 时间与数据契约

| 字段 | 含义 |
| --- | --- |
| 页面请求时间 | 此设备尝试请求快照的时间，不能代表采集或行情更新 |
| `generatedAt` | 后台完成本轮快照的时间 |
| `collectionStartedAt` | 本轮后台采集开始时间 |
| `asOf` | 行情源返回的记录时间，不用网页或采集时间代替；日级记录结合 `sourceTimePrecision` 展示为日期 |
| `sourceTimePrecision` | `date` 表示编制方日终日期，不将其中的存储时刻冒充逐笔报价时刻 |
| `navDate` | 原始净值对应日期，不是公告发布时刻；不补造当日净值 |
| `lastSuccessAt` | 最近成功读取的轮次时间，失败不重置 |
| `sourceTimeAdvanced` | 本次源时间是否较上一快照推进；首次成功读取也计入 |
| `statistics.httpRequests` | 本轮实际发出的HTTP请求数（包括历史读取），以此约束预算 |
| `statistics.attempted/succeeded/failed` | 本轮标的核查数，不等于HTTP次数；一条期货批量响应包含5项独立校验 |

Yahoo Finance公共图表接口是第三方研究数据源，不是交易所直连或有服务保障的行情API；时延未知。显示的是源常规交易时段价格，不宣称逐笔实时、可交易价格或扩展交易时段报价。原始标的、币种及品种会校验。近月/连续期货可能换月，合约名按源返回显示。

天天基金公开净值是第三方披露记录，不是基金公司对交易渠道额度的授权确认。解析只读取JSON字面量，不执行第三方脚本。不把最小申购金额当上限，不把估算净值、T-1净值当IOPV。不提供数据再分发许可保证；公开或商业用途应另行核查数据源条款与授权。

## 补齐数据的口径

| 标的 | 数据源与校验 | 展示边界 |
| --- | --- | --- |
| 恒生科技 | Yahoo `HSTECH.HK`，校验 `INDEX` 类型 | 源币种缺失保留未知，按指数点显示；源历史序列可能只有1条 |
| 中证红利低波动 | 中证官网 `H30269`，校验源代码与北京时间 | 官网点位及分时记录，时延未知 |
| 标普中国A股大盘红利低波50 | 标普官网 `92372168 / SPCLLHCP / CNY / P-` | 仅价格收益；与 `SPCLLHCT` 总收益严格区分。公开日终日期按小时核查 |
| 中金所5类期货 | 新浪 `IF0 / IC0 / IM0 / IH0 / T0`，一条批量请求，逐项校验名称、时间及字段 | 连续报价，映射月份未知；涨跌相对源前结算价。不是固定月份合约 |

新浪报价的GB18030文本和历史JSON包装只解析、不执行。期货历史日线按小时读取；失败时保留已有历史并单独标记，不改变报价读取结果。每轮为净值和历史读取预留有限位置，避免新增数据永远排不到预算。

## 云端运行

正式后台由Cloudflare Cron `* * * * *`（UTC）触发，结果写入D1的一行快照。前端只读取结果，不通过页面按钮触发源采集。`/health` 的 `ready` 仅说明后台快照未超时，各标的是否成功、新报价是否推进需查看快照统计和逐项状态。

备用工作流：`.github/workflows/monitor.yml`，仅手动执行，不再按计划或代码推送重复采集。入口：Actions → Cloud market checks → Run workflow。备用结果独立发布到 `monitor-data` 分支的 `latest.json`，避免重建Pages。需要切回时明确修改 `data/runtime.json` 的快照URL、调度名称与目标间隔；网页不会静默改用旧快照冒充分钟后台。

```sh
npm test
npm run check
node scripts/collect.mjs
```

无需安装第三方运行依赖。Node 24；本地采集结果 `data/latest.json` 不提交。测试中的数字仅为明确的测试fixture，绝不会发布为市场快照。

## 每分钟后台配置

Cloudflare Workers + D1共享同一采集逻辑。正式部署配置在 `wrangler.json`，Worker名称 `2` 与已部署项目一致；`wrangler.example.jsonc` 仅保留为手动绑定已有数据库的参考。D1每分钟只更新一个快照，不按标的逐行写，正常约1,440次快照更新/天。资源自动创建，应用幂等初始化表结构。部署命令 `npm run deploy` 不需要云端浏览器。

Worker限制每轮最多48个外部请求。主要美股指数及对应期货优先，其余行情按最久未尝试排序；净值每轮预留最多2次请求，历史预留1次，剩余预算继续填充。5类中金所期货合并为1次HTTP请求。日终指数、净值和期货历史按小时缓存，冷启动逐轮补齐。HTTP429后按服务退避15分钟，期货历史服务与报价服务分开退避。源可能限流、变更或拒绝云端访问；免费计划长期CPU、请求与数据源额度须结合运行情况核查。

如需另建部署，可使用自己的浏览器直接导入本仓库，或使用下方按钮复制后端仓库；原站继续使用本仓库的GitHub Pages。部署副本的后续源码需单独同步。`wrangler.json` 自动创建D1并配置每分钟Cron，首次访问或定时运行时建表，不需要在聊天中提供凭证。若URL未启用，在Worker的「域名」页启用 `workers.dev`。新部署必须检查健康状态及连续快照时间，首轮等待时会返回 `waiting_first_run`，不可仅以构建成功判断采集成功。

[![通过普通浏览器另建分钟后台](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sanqingzushi/-2)

## 核查与维护

- 查看页面的数据状态、后台健康检查与逐项源时间，不能只看页面能打开。Cloudflare运行日志需在账户控制台查看；Actions仅显示手动备用采集。
- 增加标的在 `data/catalog.json`，核对名称、代码、交易所、币种及基金份额。没有验证的映射保留为空。
- `008163` 为南方标普中国A股大盘红利低波50ETF联接A，其目标ETF为 `515450`；不要与华泰柏瑞 `512890` 的中证红利低波动策略混淆。
- `collectorVersion` 用于确认前端与后台是否已更新，不能仅以Pages部署成功判断新适配器已经运行。后台版本也在 `/health` 返回。
- `verifiedPremium` 仅是已测试的未来接入校验器，当前没有官方IOPV适配器，页面不会调用其生成任何溢价。只有同一证券、同币种、官方IOPV、源时间相近且足够新鲜才可能计算；仍不是买入信号。
- 不向公开仓库提交API密钥、Cookie、登录凭证、账号余额或私人持仓。修改均保留Git历史，可回滚。

## 依据

- GitHub调度与限制：<https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule>
- Cloudflare部署按钮与自动资源配置：<https://developers.cloudflare.com/workers/platform/deploy-buttons/>
- Wrangler自动资源创建：<https://developers.cloudflare.com/changelog/post/2025-10-24-automatic-resource-provisioning/>
- Cloudflare每分钟Cron：<https://developers.cloudflare.com/workers/configuration/cron-triggers/>
- Workers额度：<https://developers.cloudflare.com/workers/platform/limits/>
- D1额度：<https://developers.cloudflare.com/d1/platform/pricing/>
- 中证红利低波动编制方案：<https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/H30269_Index_Methodology_cn.pdf>
- 标普红利低波50指数：<https://www.spglobal.com/spdji/zh/indices/dividends-factors/sp-china-a-share-largecap-low-volatility-high-dividend-50-index/>
- 恒生科技指数：<https://www.hsi.com.hk/eng/indexes/all-indexes/hstech>
- 新浪期货报价页与字段映射：<https://finance.sina.com.cn/futures/quotes/IF0.shtml>、<https://n.sinaimg.cn/finance/futures/moudler20200421.js>

更新日期：2026-10-24（北京时间）。
