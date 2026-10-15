# 独立 Agent 接入与验收

当前实现是独立进程、LangGraph 阶段门禁、逐日核实和持久化执行日志的可测试版，不是无人值守任务系统。断线停止本次运行；相同请求可在重启后取回已记录结果，但未知写入不会自动重放。没有完整图 checkpoint，不能将普通写工具自动重试。

## 启动与兼容性

使用 Node 22。在 `.env` 中配置 `env.example` 的 Agent 设置，模型地址与 Key 仍由现有客户端按原协议提供，不保存到 Agent 数据库。

```bash
npm ci
npm run agent:start
# 另一个终端，使用相同 .env
npm run dev
```

打开原网页即可聊天；客户端无需更新请求结构。旧 `/api/ai/chat`、`ChatEvent` 和 NDJSON 内容保持不变，Web 在服务端将 WebSocket 事件转换成 NDJSON。旧 MCP 客户端也能继续使用原工具参数。

Compose 部署前先生成 `AGENT_TOKEN` 并写入部署端 `.env`，不要提交它。执行 `docker compose up -d --build mapannai` 会同时启动 agent。Agent 不映射宿主机端口，也不挂载地图数据库；Web 依赖 Agent 健康检查启动。Agent 无需依赖 Web 启动，收到聊天时才建立 MCP 连接。

生产自定义 `deploy.sh` 不在仓库，已按本次部署授权升级为同时构建 Web/Agent，并使用独立 Compose override 更新两个服务。原脚本与既有 override 已备份；内部 env 放在构建上下文之外，Agent 使用独立持久化目录，不对公网映射端口。

## 进程边界

```text
浏览器 -- 原 HTTP/NDJSON --> Web /api/ai/chat
                              |
                              | WebSocket + AGENT_TOKEN
                              v
                         独立 Agent
                         LangGraph / 模型请求
                              |
                              | HTTP MCP + API_TOKEN（如有）
                              v
                         Web /api/mcp
                         业务服务 / 地图 SQLite
```

- Agent 不导入 DB 服务、Next.js API 或内存 MCP transport；通过固定的 `AGENT_MCP_URL` 调用现有工具。
- 每轮模型调用前通过只读 `list_trips` 获取最新旅行上下文，不把数据库逻辑搬到 Agent。
- 原 endpoint URL、DNS、私网与重定向校验继续用于 Agent 的模型请求；私网模型仅由部署端 `AI_ALLOW_PRIVATE_ENDPOINTS` 开启。
- 联网工具仍由现有 MCP 服务提供，复用其官方子进程、校验和输出限制。这轮不迁移联网工具，以保证外部 MCP 能力与旧配置一致。
- `src/lib/ai/planner.ts` 是旧隔离测试的适配入口，不被生产聊天 API 调用。生产路线不回退到进程内执行；Agent 不可用时明确返回错误。

## 当前图与规划流程

执行图：`START → model → tools → model → … → END`。模型无工具调用时结束；工具串行执行，整批重复调用 ID 在执行前拒绝。最多 16 轮，取消信号传播至模型与 MCP，工具可能已部分写入时仍通知前端刷新。

业务规划仍通过统一提示词指导：需求讨论 → 每日主题与核实 → 用户授权后保存地点 → 创建旅行并保存每日标题 → 建立每日路线 → 汇总。用户已有旅行只修改相关日期。阶段评估以模型提取用户意图，程序按授权、缺项与阶段限制工具，逐日控制工具核实结构后推进；不应将这些约束宣称为确定性的人工审批或完整日规划子图。

下一阶段可恢复保存子图应按以下边界落地，而不是直接给当前通用图加 checkpoint：

1. 计划结构化，明确日期、每日标题、核实地点与顺序。
2. 服务端记录用户批准的计划版本，修改计划使旧批准失效。
3. 按日核实 → 保存地点 → 创建或复用旅行 → 保存日标题与路线 → 查询核实。
4. 坐标异常或关键缺项暂停，用户补充后继续；失败写入先核实，不盲目重试。
5. 引入 thread/run 归属、稳定操作 ID、SQLite checkpoint 和事件序号，再支持断线续传与重启恢复。API Key 只放单次运行上下文，不进入 checkpoint、事件或日志。

本轮没有承诺后台运行，因此页面关闭/请求取消会结束执行；已写入数据不撤销，后续消息通过现有聊天历史和查询继续。

## 工具补充

- `create_trip.dayTitles`：可选 `{date,title}[]`，日期必须属于旅行且不可重复；校验失败不创建旅行。旧调用省略即可。
- `update_trip_day`：通过 `tripId/dayId/title` 改标题，`title=null` 清除；不改变日期、成员、路线或访问交通安排。
- `create_trip.operationId`、`create_day_chain.operationId`：可选幂等 ID。业务写入和结果记录在同一 SQLite 事务提交；同 ID 同参数重放原结果，不同参数拒绝。已删除的数据不会因重放而重建。
- 当前其他写工具尚未全部覆盖幂等，也未给模型调用自动附加稳定操作 ID；所以没有打开图级写入自动重试或持久化恢复。操作记录不存模型 Key，但会保存相关业务返回值，跟随地图数据库备份与删除策略管理。

## 内部接口

`GET /health` 返回进程存活状态。`POST /chat` 提供受 Bearer 内部凭据保护的 NDJSON 调试接口。

`WS /chat` 是 Web 服务到 Agent 的内部接口，不直接开放给浏览器。带 Origin 的升级请求拒绝，避免绕开现有 Web 认证；认证失败或 5 秒内未认证关闭连接。

```json
{"type":"auth","token":"内部凭据"}
```

认证成功返回 `{"type":"ready"}`；随后发送 `{"type":"chat","request":原ChatRequest}`，接收原 `ChatEvent`。`{"type":"cancel"}` 取消当前执行；连接关闭同样取消。每连接同一时间最多一轮，最多 64 个连接、4 个活动执行，消息和待发送缓冲均有大小限制。当前没有可靠事件投递或自动重连重放。

## 自测与人工验收

```bash
npx tsx scripts/test-agent-service.ts
npx tsx scripts/test-ai-planner.ts
npx tsx scripts/test-route-chain-schedules.ts
npm run type-check
npm run build
git diff --check
```

`test-agent-service.ts` 真正启动独立 Node 子进程，以 HTTP MCP 驱动隔离 SQLite，模型是本地 mock。检查新工具、幂等冲突、标题清除、安排保留、旧 Web NDJSON、内部 WebSocket 及 Agent 不打开地图数据库。它不验证真实模型规划质量、真实 provider 或生产部署。

人工测试请使用独立 `SQLITE_PATH`，避免启动后台地址补全影响生产数据：

1. 用原聊天界面连接自己的模型，先讨论两日草案，确认没有提前建旅行。
2. 明确要求保存，检查每天文艺标题写入日期栏，地点与路线正常出现。
3. 要求仅修改一天标题，检查路线、交通安排未丢失，也没有多创建一天。
4. 点击停止后继续询问保存状态，确认不声称已撤销、不重复建立已有旅行。
5. 停止 Agent 后发送消息，检查错误提示；重新启动后使用原会话继续核实。

本次按用户授权部署至现有 HTTPS 入口，真实模型行为仍需人工验收；不要将 mock 测试当作真实模型质量保证。

## 阶段评估接入（进行中）

Agent 已增加独立 assess 节点，结构化提取事实、缺项、用户授权原句、全程骨架及修改日期。缺关键条件或 collecting/outline/review/completed 阶段不向执行模型提供地图写工具；执行工具时再次检查可用集合。授权原句必须出自用户消息，外部工具结果不参与授权评估。评估仍由模型完成，逐字匹配只能阻止虚构引用，不代表完全可靠的用户意图认证。测试适配入口跳过评估，生产入口不跳过。

当前阶段每轮从聊天记录重新评估；新增执行日志与逐日核实见下节，完整 checkpoint 与跨重启自动续跑仍待实现。新增 `npx tsx scripts/test-agent-workflow.ts` 验证阶段与缺项写入门禁。

## 可测试版：逐日核实与执行日志

已增加 `finish_planning_day` 和 `submit_trip_review` 两个 Agent 本地控制工具，不扩展公开地图 MCP。按骨架日期限制 dayId 写入；当天必须从 MCP 读取确认名称、成员、路线后才推进。整改时清除受影响日期的完成标记。全程核实提交审阅后，本轮写入门禁关闭。无地点的纯休息日目前不能通过自动核实，应先补明确安排，不宣称已完成。

Agent 使用独立 `AGENT_SQLITE_PATH` 记录请求指纹、最终消息、工具结果、数据变更和完成状态。相同请求重复提交只重放结果，不再次执行模型和工具。启动时未完成请求标记 interrupted，重放已记录结果后提示用户查询实际数据并继续，不自动重放未知写入。请求指纹包含凭据的不可逆摘要用于隔离，但凭据本身不保存；换模型或 Key 后不是同一个请求。日志包含私人会话和工具结果，请按私有数据备份、删除，当前不自动清理。

这不是 LangGraph checkpoint：新一轮依旧通过聊天历史与实时查询恢复业务进度，不能保证任意崩溃点的自动续跑；原客户端不变，相同请求可取回已保存结果。仅支持单个 Agent 进程持有该日志库，不支持多副本共同启动。所有相关写工具全面幂等、审批版本与稳定 thread 归属尚未完成，禁止自动后台恢复。

新增自测：

```bash
npx tsx scripts/test-agent-workflow.ts
npx tsx scripts/test-agent-day-loop.ts
npx tsx scripts/test-agent-recovery.ts
```

分别验证授权缺项门禁、每日顺序与审阅后写入拦截、日志重启及敏感信息不落盘。外部模型仍可能错误解释用户意图或不遵守日流程；控制工具只核实保存结构，不核实营业时间、路线实际可行性或用户最终满意程度。

## 缓存友好的请求布局

工具列表及顺序固定，system 提示词固定。原始历史不改写，最新旅行上下文与阶段状态追加到尾部，仅存在于当次模型请求中。所有工具对模型可见不代表有执行权限：执行入口校验阶段与授权，收集期拒绝 change_title。这样保留静态前缀，但不承诺具体 provider 的缓存命中；动态尾部在循环间仍会变化。业务状态目前仍部分在闭包与历史中，尚未实现可 checkpoint 的完整状态图，不应称为完整 LangGraph 持久化工作流。

## 标题与骨架的实际节点

当前图为 assess →（缺项：collecting；信息齐全：title → skeleton）→ planning/collecting → tools 循环，提交审阅转 review。title 节点单独生成标题并提交事件后 skeleton 才能执行；骨架生成使用结构化日期校验，连续日期不可重复，结果以 record_plan_skeleton 阶段记录保存至消息及执行日志。固定主 system 和工具集不随阶段改变，阶段生成器各有固定 system，不使用阶段增删工具破坏前缀。收集/规划/审阅模型节点共享流式模型执行实现，差异由图路由与执行权限决定。

`npx tsx scripts/test-agent-stage-order.ts` 检查缺项不改标题、title 事件先于 skeleton 请求、未授权不写入、工具定义固定。此版本仍通过显式请求及聊天记录跨轮继续，不宣称具有完整 checkpoint 自动恢复、完全确定性的授权识别或所有写入的幂等。

### Structured generation compatibility

Assessment, title and skeleton generation use streaming Chat Completions, while accepting non-stream JSON responses as well. Invalid JSON/schema output gets one read-only repair attempt; transport errors and map writes are not retried. Safe diagnostics distinguish upstream HTTP status from invalid structured output without logging response bodies or credentials. Run `npx tsx scripts/test-agent-structured-completion.ts` for the compatibility checks. No additional environment variables are required.
