# 石小鑫的全球指数与基金观测平台

网址：<https://sanqingzushi.github.io/-2/>

## 当前在线状态

- 前台：GitHub Pages，`main / (root)`；手机可直接打开上方网址。
- 后台：Cloudflare Workers + D1，<https://2.2815956617.workers.dev/>。
- 健康检查：<https://2.2815956617.workers.dev/health>；公开快照：<https://2.2815956617.workers.dev/api/snapshot>。
- 行情检查目标每分钟，净值按小时核查；网页每60秒读取后台结果。关闭网页不影响云端任务。
- GitHub Actions 自动采集已停用，保留手动备用入口，避免重复请求数据源。

2026-10-24（北京时间）线上核查：相邻快照11:32:27与11:33:26实际推进，采集开始时间相隔59.246秒；后一轮47次数据源请求全部成功，已取得46项行情和12项净值记录，另8项仍待接入。源报价时间推进为0。后台检查成功不等于行情更新，休市或源未更新时保留原报价时间。GitHub旧调度曾相隔超过2小时，不视为稳定5分钟监测。

公开手机页面，GitHub Pages 从 `main / (root)` 发布。无账户连接、自动下单或买入信号。关注标的保存在当前浏览器，不上传个人持仓或资产。

## 已实现

- 66项观察目录：纳指100与纳斯达克综合分别列示，标普500、道琼斯、VIX、中国宽基、全球主要股指、红利低波策略、重要期货、10只场内ETF与12只场外基金。
- 46项结构化行情配置、12项基金净值配置；其余8项明确标记待接入，不冒充行情覆盖。
- 网页每60秒请求Cloudflare快照；后台行情检查目标每分钟，快照超过3分钟未生成时提示超时。调度目标不是准点或实时行情保证。
- 各标的独立显示源报价时间/净值披露日、最近读取时间、本轮状态、来源及错误。相同源时间不会计为新报价。
- 失败时保留原价格、原源时间和上次成功时间，另记失败。源时间倒退或处于未来会被拒绝。
- 场外净值每小时核查。渠道限额、开放状态、IOPV和溢价当前均未知，保留空值。
- 历史曲线只使用同源返回的近1月日线/最近60条净值记录；缺失点不补造，末根日线可能未完成。
- 搜索、分类、浏览器关注清单、手机布局与“石小鑫观测平台”快捷方式名称。

## 时间与数据契约

| 字段 | 含义 |
| --- | --- |
| 页面请求时间 | 此设备尝试请求快照的时间，不能代表采集或行情更新 |
| `generatedAt` | 后台完成本轮快照的时间 |
| `collectionStartedAt` | 本轮后台采集开始时间 |
| `asOf` | 行情源返回的报价时间，不用网页或采集时间代替 |
| `navDate` | 原始净值记录对应的披露日期，不补造当日净值 |
| `lastSuccessAt` | 最近成功读取的轮次时间，失败不重置 |
| `sourceTimeAdvanced` | 本次源时间是否较上一快照推进；首次成功读取也计入 |

Yahoo Finance公共图表接口是第三方研究数据源，不是交易所直连或有服务保障的行情API；时延未知。显示的是源常规交易时段价格，不宣称逐笔实时、可交易价格或扩展交易时段报价。原始标的、币种及品种会校验。近月/连续期货可能换月，合约名按源返回显示。

天天基金公开净值是第三方披露记录，不是基金公司对交易渠道额度的授权确认。解析只读取JSON字面量，不执行第三方脚本。不把最小申购金额当上限，不把估算净值、T-1净值当IOPV。不提供数据再分发许可保证；公开或商业用途应另行核查数据源条款与授权。

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

Worker限制每轮最多48个外部请求，当前46项行情优先，基金净值按最久未读排序填余量，冷启动约6轮补齐12项净值。公开行情源可能限流、变更或拒绝云端访问，错误会明确显示；HTTP429后退避15分钟。免费计划的CPU、子请求和数据源额度仍需部署后实测，不能承诺永不超限。

如需另建部署，可使用自己的浏览器直接导入本仓库，或使用下方按钮复制后端仓库；原站继续使用本仓库的GitHub Pages。部署副本的后续源码需单独同步。`wrangler.json` 自动创建D1并配置每分钟Cron，首次访问或定时运行时建表，不需要在聊天中提供凭证。若URL未启用，在Worker的「域名」页启用 `workers.dev`。新部署必须检查健康状态及连续快照时间，首轮等待时会返回 `waiting_first_run`，不可仅以构建成功判断采集成功。

[![通过普通浏览器另建分钟后台](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sanqingzushi/-2)

## 核查与维护

- 查看页面的数据状态、后台健康检查与逐项源时间，不能只看页面能打开。Cloudflare运行日志需在账户控制台查看；Actions仅显示手动备用采集。
- 增加标的在 `data/catalog.json`，核对名称、代码、交易所、币种及基金份额。没有验证的映射保留为空。
- `008163` 为南方标普中国A股大盘红利低波50ETF联接A，其目标ETF为 `515450`；不要与华泰柏瑞 `512890` 的中证红利低波动策略混淆。
- `verifiedPremium` 仅是已测试的未来接入校验器，当前没有官方IOPV适配器，页面不会调用其生成任何溢价。只有同一证券、同币种、官方IOPV、源时间相近且足够新鲜才可能计算；仍不是买入信号。
- 不向公开仓库提交API密钥、Cookie、登录凭证、账号余额或私人持仓。修改均保留Git历史，可回滚。

## 依据

- GitHub调度与限制：<https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule>
- Cloudflare部署按钮与自动资源配置：<https://developers.cloudflare.com/workers/platform/deploy-buttons/>
- Wrangler自动资源创建：<https://developers.cloudflare.com/changelog/post/2025-10-24-automatic-resource-provisioning/>
- Cloudflare每分钟Cron：<https://developers.cloudflare.com/workers/configuration/cron-triggers/>
- Workers额度：<https://developers.cloudflare.com/workers/platform/limits/>
- D1额度：<https://developers.cloudflare.com/d1/platform/pricing/>

更新日期：2026-10-24（北京时间）。
