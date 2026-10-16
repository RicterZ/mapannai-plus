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

Docker / Compose 仅构建和启动 `mapannai` 一个容器，入口 `scripts/start-services.cjs` 管理 Web 与 Agent 两个独立 Node 进程。Agent 只监听容器内回环地址，不公开端口；内部 WebSocket / MCP 地址由入口按端口生成。任一进程退出会停止另一个并让容器退出，由 restart 策略重启；SIGTERM 同时转发给两者。

所有服务配置统一在项目 `.env`；生产路径为 `/root/docker-services/build/mapannai-public/.env`。不再使用额外的 Agent env 或 Compose override。地图数据库与独立 Agent 执行日志均持久化在原 `/app/data` 挂载内（不同文件）；Agent 仍仅通过 MCP 访问地图业务，不直接操作地图数据库。部署继续使用原服务器 `deploy.sh`，只构建一个镜像、更新一个服务。

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

工具循环：`model → tools → model → … → END`。模型无工具调用时结束；工具串行执行，整批重复调用 ID 在执行前拒绝。每次请求最多 64 轮模型执行（每轮可调用多个工具），历史最多 1200 条消息，图步数上限随轮数计算为 136。取消信号传播至模型与 MCP，工具可能已部分写入时仍通知前端刷新。模型上下文窗口和请求大小限制仍独立适用；提高轮数不等于自动压缩历史。

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

Text-only stage requests omit null/blank turns after stripping tool calls. A tool-only assistant turn must not be sent as `content: null` without its original tool calls, which strict Chat Completions providers may reject with HTTP 400. Original text order is retained; tool results remain excluded from assessment evidence.

### Private diagnostic transcript

Set `AGENT_TRACE_ENABLED=true` in the same project `.env` to record private traces in `trace_records` in the existing Agent SQLite file. Records are linked by run ID and include incoming conversation/context, graph nodes, outgoing model messages/tools, parsed assistant responses, tool events, bounded upstream HTTP error details and exception stacks. Raw SSE frames and hidden reasoning are not recorded. Known credentials and signed URLs are redacted; the database remains private conversation data and is chmod 600. Retention is seven days, cleaned on startup/write, capped at 20 million characters per run; trace write failure does not replay or stop map operations. Old failures cannot be reconstructed retroactively. Test with `npx tsx scripts/test-agent-trace.ts`.

诊断开关未设置时开发默认开启、生产默认关闭；`AGENT_TRACE_ENABLED=true/false` 显式覆盖。生产镜像设置 `NODE_ENV=production`。

### Chat interaction cards

`ask_datetime`, `ask_choice` and `preview_itinerary` are Agent-only tools. Updated Web requests advertise `supportsInteractions`; an NDJSON `interaction` event renders a chat card and a separate authenticated `/api/ai/interactions` request submits a one-shot capability token to the same Agent process. The server validates options/dates and resolves only one result before the fixed 60-second deadline. Disconnect/cancel rejects the wait; late/duplicate submissions return 409. Legacy clients receive immediate `unsupported` results without waiting. Timeout switches to a text question and waits for user input; no assumptions, further tools or map writes are allowed. Preview is an unsaved textual daily outline, not a saved trip. Interaction prompts are ephemeral, while final tool results remain in normal chat history. No checkpoint or card restoration after refresh is provided in this version. No new environment settings are required.

### Replay identity and conversation isolation

Replay requires both explicit UUID `conversationId` and `requestId`, plus identical request contents/configuration. Web uses its local conversation UUID and generates a fresh request UUID on each send. Legacy clients omitting either ID get a new execution identity on every request; identical text must never retrieve another client's run. The versioned hash excludes old content-only keys. Titles are presentation only, not identity. This is request replay isolation, not cross-device chat sync or an account authorization mechanism. No environment changes are required.

Choice cards always include a built-in “none / explain in text” action, documented in the tool description so models do not add duplicate fallback options. It resolves as `declined`, not a selection or timeout. Remaining tool execution in that turn is blocked and the model is instructed to ask one open question in text and wait for a new user message.

### Draft approval, saved overview and chatting

Full drafts must be reviewed with `preview_itinerary` before any map writes. Explicit `continue` permits saving that draft, not arbitrary deletion, bookings or payments. Saving then verifies each day and the entire trip; `submit_trip_review` returns an overview read from actual saved days and marker names, automatically rendered in chat. The graph transitions into a real `chatting` node with the same system and tool definitions; execution rejects tools in this state. Assessment can route later modifications/new tasks back to planning with fresh draft approval. Approval currently relies on conversation tool history, not a signed/versioned plan object; do not claim a complete approval system.

## Background execution and result polling

Updated Web uses POST `/api/ai/runs` with the normal ChatRequest, UUID conversationId/requestId and a random per-request `x-run-token` (32–100 alphanumeric/hyphen characters). Response 202 returns `{id}`. GET `/api/ai/runs/{id}?after=0` with the same token returns `{status,events:[{seq,event}],cursor}` (up to 100 events); continue immediately for a full page, otherwise poll. DELETE with the same token explicitly cancels. Existing API_TOKEN authentication remains required where configured. Tokens are not URL parameters and only their hash is stored by Agent. Persist the returned run ID, token, conversation association and cursor locally; never infer identity from titles/text. iOS adoption is not implemented here.

New tasks run independently of subscribers. Web restores pending polling on page startup, preserves final messages and cursor, and resumes unexpired interaction cards. Partial output is journaled as cumulative `partial` events at one-second intervals; final assistant messages replace partial text. Closing a page does not cancel. The Stop button sends DELETE; original `/api/ai/chat` retains legacy streaming/cancel behavior.

Events live in the same Agent SQLite file. Model keys remain in memory. This survives client disconnection, not execution process crashes: completed results remain retrievable after restart; formerly running tasks become `interrupted`. Do not automatically replay uncertain writes. It is not LangGraph checkpoint recovery. Pending interactions still expire after 60 seconds and fall back to waiting for text.

### 独立地点操作

`acting` 用于地点查询、收藏及单项编辑，不要求旅行日期或每日归属，不运行标题、骨架、逐日核实与全程草案确认。写入仍需明确用户授权，当前仅开放 create_marker/update_marker；旅行操作不得借此绕过草案批准。chatting/completed 与超时拒选后的模型请求保留固定工具定义，但动态尾部只指示文字回复，不再混入规划工具执行要求。历史草案批准只作用于规划状态，不改变独立任务状态。

### 图片输入

用户消息可附加 `images: string[]`，最多4个HTTPS图片URL；content仍是文本，旧客户端无需变更。Web复用已有COS上传，支持每张10MB以内JPG/PNG/WebP、预览及发送前移除。模型请求在传输边界转成标准Chat Completions的text/image_url内容块，需求评估和执行均可看图。模型必须支持视觉输入且能够访问该URL；图片会交给用户配置的第三方模型服务，请勿上传敏感证件。
