# AGENTS.md — MapAnNai Plus 开发入口

所有接入本仓库的开发 agent 请先阅读此文件，再查看相关源码。这里记录产品理念、架构边界和已确认的交互约定，适用于整个仓库。修改功能时同步维护本文件、`env.example` 和相关 README，避免把过时实现当作设计要求。

## 产品理念：地点关联，不是导航

MapAnNai Plus（マップ案内）是地图上的地点整理与旅行行程编辑工具，也提供 MCP 让 AI 操作相同的数据。

- 核心对象是地点（Marker）、旅行（Trip）、每日行程（TripDay）和有序地点链（chains）。用户关心地点之间的关联、访问顺序以及每日安排。
- **连线是关联路线，不是逐路口导航。** 用户不会被要求沿展示线行走。后端寻路只提供更贴合地图的连线形状，不能由此把产品改造成导航应用。
- 路线卡片保留地点数、访问顺序、查看路线等信息；开启路线规划时，在相邻地点之间的一行左侧显示原始规划路段距离（m / km），与地点卡片左边缘对齐，向下箭头独立保持水平居中，随计算完成刷新并复用现有缓存；关闭规划时不显示距离；开启后尚在计算、请求失败、无有效路程缓存或虚线回退时均显示 WGS-84 两点距离，仅显示数值；有效规划路程返回后自动替换。API 与前端共用 `routeDistance`，不添加距离类型字段；服务端按坐标补算必须带 `fallback`，缺少有效路程/路径为 `NO_ROUTE`，临时失败为 `PLANNING_FAILED`（HTTP 500、不缓存、保留重试）。不要添加预计耗时、导航步骤。外部单地点导航入口与关联路线是不同功能。
- 未开启路线规划时使用贝塞尔关联曲线；开启后使用后端路径并做显示平滑、局部剪枝。允许简化行程点附近的小掉头、回环和支路，保留行程点、主要走向和较大绕行。
- 显示优化不能修改原始寻路数据、路程、时长或行程地点。线条、白色描边、动画、透明点击范围必须使用同一条显示路径。
- 交互保持紧凑、自然，优先考虑移动端。减少 sidebar 占用、重复按钮、冗余状态文字和不必要的确认步骤。

## 文档维护

- `README.md` 与 `README.zh.md` 面向产品使用者，保持功能介绍、使用方式、部署与本地开发内容同步，并保留 iOS 客户端入口。
- 环境变量说明集中在 `env.example`；架构边界、交互约定与开发验证要求维护在本文件。不要把接口细节、测试记录或逐次变更日志追加到 README 或环境变量示例。
- 清理与当前源码不符的旧设计文档；AI 接入以现有 MCP 为准。

## 开发起步

1. 查看 `git status`，保留用户未提交的改动。
2. 阅读本文件、`README.zh.md` / `README.md`、`env.example`，再定位任务涉及的组件与服务。
3. 以当前源码为准；历史命名可能没有更新，不要仅凭变量名推断所用 provider。
4. 不输出 `.env`、API Key、token、预签名上传 URL 或其他凭据。线上数据检查尽量只读；功能测试使用 mock 或独立临时数据库。

```bash
npm ci
npm run dev                        # 默认端口 3000
npm run dev -- --port 3101          # 需要独立 review 服务时
npm run type-check
npm run build                      # 含编译、lint 检查、类型校验；standalone 输出
npm start                          # 需要先构建
git diff --check
```

当前没有独立测试框架或 `npm test`。`npm run lint` 存在，但没有仓库 ESLint 配置时会进入交互设置，不要把脚本存在当作已配置完成。选择与改动相关的算法检查、临时 SQLite 测试、浏览器交互测试，不为简单文案修改机械地添加测试。

`better-sqlite3` 是原生依赖。更换 Node 版本导致 ABI 不匹配时可用 `npm rebuild better-sqlite3`；生产 Docker 使用 Node 20。不要同时在同一工作目录运行 `next dev` 与 `next build`，两者会争用 `.next`。

## 技术栈与数据流

- Next.js 14 App Router、React 18、TypeScript、Tailwind CSS。
- Zustand 管理 UI 与行程状态；dnd-kit 实现排序与链路拖动；Tiptap 编辑地点富文本。
- OSM 渲染使用 MapLibre / react-map-gl；高德渲染使用官方 JS API 2.0。
- SQLite / better-sqlite3 持久化地点、旅行、每日行程与寻路缓存。
- MCP 使用 Streamable HTTP；腾讯 COS 保存图片；next-pwa 提供 PWA。
- TypeScript 别名 `@/*` 对应 `src/*`。

```text
Web UI → Zustand / fetchWithAuth → Next.js API → DB 服务 / 地图 provider
MCP client → POST /api/mcp → MCP tools → 同一 DB 服务 / 地图 provider
```

MCP 工具直接调用服务层，不需要绕回本站 HTTP API。Web 与 MCP 必须共享数据规则和 provider 能力，避免出现两套业务实现。

## 目录导航

| 位置 | 职责 |
| --- | --- |
| `src/app/page.tsx`, `map-client.tsx` | 从服务端环境变量选择渲染引擎，下发 JS 配置，完成客户端认证启动 |
| `src/app/api/` | markers、trips、dataset、search、places、directions、upload、mcp 等入口 |
| `src/store/map-store.ts` | 地点与行程数据、选中状态、弹窗、sidebar、编辑模式、ActiveView 与业务操作 |
| `src/components/map/abstract-map.tsx` | 地图页面编排、定位、搜索、视图切换、marker/popup、两种 renderer 接入 |
| `src/components/map/amap-renderer.tsx` | 官方高德地图与覆盖物、事件、React portals、路径与动画更新 |
| `src/components/map/connection-lines.tsx` | OSM / MapLibre 关联线、透明点击层、高亮与动画 |
| `src/components/map/view-mode-banner.tsx` | 顶部旅行 / 日期胶囊与日期选择菜单 |
| `src/components/sidebar/left-sidebar.tsx` | 旅行总览、每日行程、路线链、地点列表、编辑和紧凑路线设置 |
| `src/components/sidebar/sidebar.tsx` | 地点详情侧栏 |
| `src/components/ui/`, `modal/` | 共用 Modal、富文本编辑、图标与表单 |
| `src/lib/db/` | schema 与运行时迁移、marker-service、trip-service、direction-cache |
| `src/types/` | Marker、Trip、TripDay、ActiveView、地图 provider 合约 |
| `src/lib/map/providers/` | 服务端 Google / 高德实现与按能力选取的 factory |
| `src/lib/map/basemap.ts`, `src/lib/coord-transform.ts` | OSM 样式、渲染边界与坐标转换 |
| `src/lib/map/connection-geometry.ts` | 不寻路时的贝塞尔几何 |
| `src/lib/map/route-geometry.ts` | 显示路径去重、剪枝、平滑；按原始路径引用缓存结果 |
| `src/lib/map/route-cache.ts` | 客户端路径缓存、共享请求队列、等距离动画采样 |
| `src/lib/map/use-planned-routes.ts` | 当前视图路段计算、可见范围优先、进度、重试 |
| `src/lib/map/route-settings.ts`, `route-progress.ts` | 全局路线模式设置与计算进度 |
| `src/lib/map/route-presentation.ts` | 每日 / 链路颜色、地址简写、路线镜头计算 |
| `src/components/ai/ai-planner.tsx`, `src/lib/ai/`, `src/app/api/ai/chat/` | 网页 AI 设置、本地会话、流式聊天与复用 MCP 的工具循环 |
| `src/lib/mcp/server.ts`, `tools/` | MCP server factory、workflow prompt、地点 / 行程 / 搜索工具 |
| `src/lib/upload/`, `src/lib/cos-client.ts` | COS 直传、压缩图片展示 |
| `src/middleware.ts`, `src/lib/auth.ts`, `fetch-with-auth.ts` | API 认证与前端 token 注入 |
| `env.example`, `Dockerfile`, `docker-compose.yml`, `next.config.js` | 配置说明、构建、容器与 PWA |

## 数据与业务约定

- 数据库默认 `./data/mapannai.db`，可通过 `SQLITE_PATH` 指定。Docker 默认数据目录 `/app/data`，需要持久化挂载。
- schema 初始化 / 迁移入口是 `src/lib/db/index.ts`。新增字段需兼容现有数据库，优先非破坏性迁移。
- `Trip.markerIds` 是旅行待分配地点列表（旧数据默认空），仅保存尚未属于该旅行任何日期的地点。同一地点可以在另一旅行待分配或已排日期；保存每日成员或链时事务性移除该旅行待分配归属。旅行详情在日期列表下方显示“未分配日期”，编辑模式可拖到日期或点击“分配”；不自动创建链。旅行总览新建地点自动加入待分配列表，已有地点弹窗可“加入旅行”；从旅行列表移除不删除地点。全局独立地点和旅行地点数量、删除独占地点统计均包含旅行待分配归属。
- `TripDay.markerIds` 表示当天地点成员；`chains: string[][]` 表示各链的访问顺序。成员关系和路线顺序不能混为一谈。
- 一个 marker 可以属于多个路线，列表应显示全部路线归属。删除地点或从某天移除时维护相关 chains，不能留下悬空引用。
- `Marker.placeReferences` 为可选 Apple / Google / 高德 POI 引用，普通 Marker 顶层字段、Dataset `properties` 字段；无引用返回 null。公共严格校验、按平台合并与坐标变化清理见 `src/lib/places/place-references.ts` 和 [接口合约](docs/place-references.md)。SQLite `markers.place_references` 可空 JSON TEXT，运行时非破坏性新增列；不得推断身份、使用内部去重 ID 或按引用转换坐标。
- 所有地点写入在事务内合并引用；坐标六位小数确实变化时清除旧引用，再应用调用方显式引用。普通 Web 编辑省略引用，不把旧引用重发成新身份。去重返回已有地点时不附加附近搜索身份。搜索/详情仅提取正式平台 ID；坐标反查身份只代表返回的附近 POI，不能自动赋给手动标点。AI 不编造 ID，`update_marker` 的显式引用只是调用方声明。
- marker 去重使用坐标 hash 与距离兜底逻辑；不要因创建新链而重复创建已有地点。
- 修改旅行开始日期沿用现有天数并顺移每日日期；删除指定一天后维护剩余日期与旅行范围。
- `TripDay.colorIndex` 是持久化每日色号；日期变更、其他天删除、视图切换不应造成颜色漂移。地图、侧栏、标签使用统一色彩函数，避免相邻天都落入同一色系。
- 地点内容主要是 Tiptap HTML；不要把历史 `markdownContent` 命名误认为仅支持纯 Markdown。

- 旅行层级的 `Trip.description` 已停用：创建表单、Web API、数据返回和 MCP 工具不再读写/暴露。SQLite 旧列只保留兼容，更新其他旅行字段不覆盖历史值；地点富文本和路线访问/交通备注继续使用。此变更不需要新增环境变量。

## 路线游览与交通安排

- `TripDay.routeChains` 为权威路线结构，持久化在 SQLite `route_chains` JSON；旧库事务迁移，为路线和每次地点访问生成稳定 ID。`chains` 保持 `string[][]` 格式，仅是 stops 的 marker ID 顺序兼容投影，两者由服务层同一事务更新，不能各自修改。
- `RouteChain={id,stops,legs,inactiveLegs?}`。`ChainStop={id,markerId,startTime?,durationMinutes?,note?}`；`ChainLeg={fromStopId,toStopId,mode,serviceNumber?,startTime?,durationMinutes?,note?}`。共用 `Schedule` 类型，不使用运行时 class。安排属于路线中的一次访问或有方向的相邻路段，不属于全局 Marker。
- `serviceNumber` 是独立字符串字段，涵盖地铁线路、公交号、火车车次、航班号、船班号；不能塞进 note。`note` 是补充纯文本。mode 支持 walking/cycling/driving/taxi/bus/subway/train/flight/ferry/other。
- startTime 为所属行程日当地钟表时间 HH:mm；durationMinutes 为非负整数计划分钟数，可为0；省略未知值，不自动推算下一站，不作跨时区转换，不覆盖寻路缓存中的 distance/duration。侧栏展示和编辑安排；交通方式决定该有向路段的寻路模式，时间/时长/车次备注不参与本轮寻路，不改写用户计划时长。
- API：`POST /api/trips/[id]/days/[dayId]/chains` 用 markerIds 创建路线；`GET/PATCH/DELETE .../chains/[chainId]` 读取、局部修改、删除。PATCH 接收可选完整 markerIds 顺序、stops/legs 局部修改列表；字段省略保留，null清除可选安排字段，空白 serviceNumber/note 清除。leg remove=true清除交通记录，不能同时修改其他字段。严校验字段、时间、访问归属、方向相邻、重复地点/修改项；失败整次回滚。
- 服务 `src/lib/db/route-chain-service.ts` 和 schema `src/lib/trips/route-chain-schema.ts` 由 Web/MCP 共用。create_day_chain 返回 routeChain；update_day_chain 支持 chainId 或旧 chainIndex（二选一）、stops/legs；delete_day_chain 同样兼容。get_trip_detail 返回完整 routeChains。修改删除不创建或删除全局地点。
- 旧 chains 写入先匹配原样路线，再识别无歧义的修改；安排跟随同一路线访问ID，仍有方向相邻的交通才展示，暂时断开的同路线有向边保存在 `inactiveLegs`，移回原方向相邻时恢复；反向边独立，不能继承原方向。删除地点/路线和明确清除安排才删除对应记录。存在多个候选且可能串用安排时拒绝旧写入，要求 chainId；不把不确定的安排迁移到其他路线。一般标题、日期、当天成员更新保留全部安排。
- 从日期移除或全局删除 marker 时同时清理所有相关 stops/legs，保留其他访问安排；日期顺移保留钟表时间与时长。新结构允许历史单点/空链迁移，但新建与重排路线仍要求至少两个不重复地点，暂不开放同一路线重复访问同一 marker。
- 验证：`npx tsx scripts/test-route-chain-schedules.ts` 使用隔离旧库测试迁移、ID持久化、Web/MCP安排写入与清除、错误回滚、旧客户端兼容、路线/地点删除与相邻交通清理；不可使用生产数据做写入测试。

## 地图与服务抽象

渲染引擎和服务端能力独立组合，由**后端环境变量**选择；不要恢复前端 provider 切换 UI。

- `MAP_RENDERER=osm|amap`。
- `MAP_SEARCH_PROVIDER`、`MAP_DETAILS_PROVIDER`、`MAP_DIRECTIONS_PROVIDER` 分别支持 `google|amap`。
- 合约入口 `src/types/map-provider.ts`；factory 在 `src/lib/map/providers/map-provider-factory.ts`。新能力先考虑合约，再实现各 provider，不把高德逻辑散落到通用 UI。
- 高德底图使用官方 JS API 2.0；不要退回直接抓取 `webrd*.is.autonavi.com` 非标准瓦片的实现。
- JS 地图使用 `AMAP_JS_KEY` 和配套 `AMAP_JS_SECURITY_CODE`；服务端使用独立的 Web 服务 Key `AMAP_API_KEY`。Google 使用 `GOOGLE_API_KEY`。其他变量详见 `env.example`。
- 内部 DB、服务合约、路由缓存统一为 **WGS-84**，高德接口 / 渲染边界进行 **GCJ-02** 转换，避免双重偏移。Google 境内坐标按现有 provider 转换约定处理。
- `isInChina` 是历史兼容的矩形坐标判断，不是精确国境、行政区或服务覆盖判断。改动转换逻辑前检查中国边界和海外地点的实际行为。
- 网页搜索使用当前可见范围，每侧扩展 20%；高德使用 polygon 搜索，泛词酒店 / 高铁站等映射为 POI 类型；Google 使用中心点与半径偏好。MCP 无范围名称搜索保留原行为。
- 搜索分页：`GET /api/search` 使用 `page=1..100`、`pageSize=1..25`，返回 `page/pageSize/hasMore/nextPage`，高德返回可用 `total`；Google 后续页附带上一页 `nextPageToken` 作为 `pageToken`，以实际返回的 `pageSize` 为准。无分页参数保留旧 `limit`（默认5、最多20）的数组接口。分页范围/关键词保持同一快照；客户端取消和去重，不因加载更多移动镜头。MCP原有首批名称搜索兼容，不能静默分页并增加搜索费用。
- 高德地点服务主要面向中国，海外地点服务可以选择 Google。不要把没有搜索结果一概解释为权限或政策，先检查请求参数和返回值。

## 连线、缓存与动画：易回归点

- `POST /api/directions` 经 `src/lib/db/direction-cache.ts` 缓存原始路径。缓存键包含 provider、模式、起终点坐标；共享 in-flight 请求减少重复计算。
- 客户端同时使用内存和 localStorage 缓存。只计算未缓存的路段；多终端依赖服务端缓存，不因重绘重新寻路。
- 客户端共享队列串行请求并做高德 QPS 退避；服务器不需要照搬逐条排队。优先计算当前屏幕路段，再向外扩展。
- 地点坐标、连接关系、路段实际寻路模式或 provider 变化时，使用正确的新缓存键；纯高亮和视图动画不应触发额外寻路。
- 平滑 / 剪枝只修改显示几何，单段剪枝使用 `smoothRoutePath`，整日显示布局使用 `layoutRoutePaths`。短距离小转盘允许拉直；同一天持续重合的往返路段允许渐进偏离道路、向两侧舒展，端点保持不动。普通交叉点、不同日期不做这种分离。原始寻路 API 输出和缓存不变；不要把显示路径的长度当作行程路程。
- 高德覆盖物尽量复用；**已有 Polyline 路径变化必须调用 `setPath()`**，不能只调用 `setOptions()`。可见线、白边、点击层都要更新，动画必须跟随同一条路径。
- 多天路线重叠时统一按屏幕距离选择候选；相邻路线优先最近一条，重叠处使用统一候选选择，不能由覆盖物层级决定唯一可选日期。点击路线直接进入所属旅行的对应 day 视图，同步 URL、侧栏与日期高亮，保留当前地图镜头，不自动定位当天首个地点；每日视图内不重复跳转，移动端不自动展开侧栏。已锁定的日期高亮优先于悬停。
- 路线的透明点击区域约 28px，避免只按视觉线宽响应手机触摸。保持完全透明，阻止背景点击把刚选中的路线清空。白色描边保持细，不要产生宽色带。
- 动画使用时间而非每帧固定增量；缓存路径长度，避免每帧扫描整条路线。减少覆盖物重建，尊重 reduced-motion，后台页面避免持续计算。

## 已确认的 UI 约定

- 启动认证与地图模块加载共用一个“加载地图中…”提示，保持相同布局，避免连续出现重复连接提示。

- 编辑开关用 toggle；开启后才出现增减天数、删除旅行 / 日期等编辑控件，不要增加重复的“编辑中”提示。
- 删除旅行和指定日期共用弹出 Modal 二次确认，不恢复二段式删除按钮或只删除最后一天的逻辑。确认框提供默认关闭的“同时删除独占地点”及数量；删除前按所有日期的 markerIds 与 chains 合并计数，同一日期内重复引用只计一次，关联多个旅行或多个日期的地点始终保留（即使这些日期都在被删除的旅行中）。服务端事务重新计算并返回 deletedMarkerIds，网页同步移除地点和选中弹窗。MCP delete_trip 通过 deleteExclusiveMarkers 显式启用，默认保留地点。验证：`npx tsx scripts/test-trip-deletion.ts` 使用独立临时数据库。
- 路线卡片单列，一个地点可显示多个“路线 N”归属。路线标题与查看按钮保持移动端可触控大小。
- 路线规划只保留一个开关，进度和重试保持紧凑；不显示自动、步行、驾车选择。每条有向边按自己的交通安排选择寻路模式。底部设置使用 8px 顶部留白，底部取 8px 与系统安全区的较大值，不在侧栏容器重复叠加底部安全区。
- 桌面端搜索结果浮层锚定输入框容器，与输入框左右边缘和宽度一致；定位按钮不计入浮层宽度。移动端维持原有全宽结果列表布局；点击搜索结果按面板实测高度和可见视口，将地点定位到面板上方空余区域中心，两种 renderer 均支持镜头 offset。
- sidebar 可收起；移动端在 topbar 切换日期时更新内容但不自动打开 sidebar。
- 切换某天后定位到第一条链的第一个有效 marker。点击地点、查看路线 / 全天时，镜头与对应高亮保持同步。
- 顶部胶囊按钮不显示 outline；日期按钮仅截断文字，展开箭头固定保留，不对整个 flex 按钮使用 truncate。
- 日期下拉菜单相对整个顶部胶囊水平居中，距胶囊底边 8px，左右保持至少 8px 视口边距；不得按内部按钮右对齐或用按钮底边计算垂直位置。
- 总览胶囊文案为“总览 · 共N天”，保持单行。日期菜单不得继承胶囊横向布局，被 sidebar 遮挡或超出视口；注意长行程滚动、外部关闭与 Escape。
- sidebar 关闭使用统一的返回地图 / X 入口，不堆叠重复按钮。
- marker 弹窗里的操作保持短文案，例如“删除”，避免“删除地点”挤换行；按钮文字不换行，图标不被压缩。
- 移动端页面不缩放，地图仍允许手势缩放；变更手势行为时分别测试两者。
- 已有地点弹窗尖头与 marker 中心至少间隔 28px，避开选中 / 悬停圆环；高德卡片偏移需额外包含向上伸出的 8px 尖头。
- 保留 marker popup 小尖头；检查旋转方块的阴影、接缝和边缘，避免破坏原有指向感。

- 面板进出动画统一使用 `app-panel` / `panel-backdrop`；退出结束后才隐藏，关闭时立即设为 inert，快速开关必须清理旧动画帧和定时器。
- 日期 / 旅行切换立即提交内容，新内容仅播放短入场动画；不得为播放退出动画延迟导航或锁住按钮。拖拽后的短暂点击隔离保留，并清理解锁定时器。
- 表单弹窗使用 `modal-viewport` 跟随 VisualViewport（含软键盘与视口偏移），地图画布不跟随键盘缩小。移动端打开表单不自动唤起键盘，弹窗保持键盘焦点与 Escape 关闭行为。
- 地图小圆球动画通过 `src/lib/ui/animation-loop.ts` 调度；隐藏页面取消帧，回到前台恢复，运行时切换减少动态效果设置也应停止动画并清理小圆球。

## 图片与认证

- 图片上传：前端向 `/api/upload` 获取预签名 URL，然后直接 `PUT` 到 COS；凭据只留在服务端。
- 默认展示压缩图片，由 `src/lib/upload/image-url.ts` 添加 COS 图片处理参数，正文图片延迟加载；保留原文件，不把数 MB 原图恢复为默认展示。
- 可选 `API_TOKEN` 保护 `/api/*`；前端用 `fetchWithAuth` 注入 `Authorization: Bearer ...`。也支持 `x-api-token`，不把 token 放在 URL 查询串。
- 不把生产 token 写进本文件、README、测试或日志。

## 网页 AI 对话

- 网页配置 OpenAI 兼容 Chat Completions API 地址、Key 与支持工具调用的模型。会话与完整工具结果保存在浏览器；Key 默认仅保留在当前页面，用户显式勾选后才保存到 localStorage。不得把 Key 或聊天记录写入服务端数据库、日志或 URL。
- `POST /api/ai/chat` 继承 API 认证，将多轮消息转发至配置的 AI API，以 NDJSON 返回文本、工具结果与数据变更事件。AI 回复的 Markdown 由 marked 分词后渲染为 React 元素，H1–H6 统一紧凑字号；不能直接注入模型返回的 HTML，链接仅允许 HTTP(S) / mailto。
- `src/lib/ai/mcp-tools.ts` 使用 SDK 内存 transport 连接现有 MCP server，复用 schema 和服务规则；不要维护另一套工具定义或绕回本站 HTTP。
- 助手自称“M酱”，口吻熟络爽快、有元气，直接接话，不复述需求、写报告或例行追问；回复和地点笔记不发 emoji，可偶尔用颜文字，不堆砌卖萌与模板套话；保留真实 AI 身份和工具结果边界。系统提示词只在服务端 `src/lib/ai/prompt.ts` 维护，由 `/api/ai/chat` 的 planner 注入，客户端不维护副本，也不提供提示词下发接口。旅行上下文在 `trip-context.ts` 单独组装。
- 网页提示词说明产品定位、对象关系、工具能力、完整创建旅行流程与必要业务规则，不拼接 MCP workflow 全文。每次模型请求将最新旅行列表（ID、名称、日期范围）和当前日期 / 视图 ID 附加到第一条 user 消息；附加内容不写回本地 transcript。只使用当前话题的完整 transcript，不增加跨话题记忆或压缩层。
- 话题下拉框使用自定义箭头，箭头距右边缘 12px，文本留出空间。
- 默认仅允许公共 HTTPS endpoint；连接时校验实际 DNS 地址，不跟随重定向。仅部署者设置 `AI_ALLOW_PRIVATE_ENDPOINTS=true` 时允许私有地址及 HTTP。此配置需重启服务。
- 工具按顺序执行；写入（含可能部分失败）后刷新地点与旅行。网页 `useAiMapEffects` hook 仅处理当前聊天 `create_marker` / `plan_trip_day` 工具结果中 status=created 的地点：刷新完成后单点定位、批量按范围定位，镜头考虑聊天面板及左栏遮挡；关闭面板取消尚未执行的定位，历史记录、已有地点及外部 MCP 不触发定位。停止请求不承诺撤销已执行操作；恢复会话补齐缺失工具结果，提示模型查询实际数据，不自动重放写入。
- AI 聊天输入框与发送 / 停止按钮放在同一圆角输入区域，输入区默认单行约 46px 高，多行输入自适应至 120px；按钮保留 44px 点击范围，内部仅 28px 浅色圆角背景及小图标，相对输入区域垂直居中；不添加欢迎引导、示例提示或底部帮助文字，设置仅显示必要字段与操作。
- 地图 AI 入口仅显示圆形聊天图标，不显示“AI 规划”文字，保留无障碍标签及运行状态圆点。
- AI 面板为非模态面板，不加地图遮罩或锁定 Tab 焦点，点击 / 拖动地图不关闭聊天；PC 宽 560px，手机底部占可见视口 65%，上方保留地图。关闭按钮及面板内 Escape 可关闭，表单 Modal 保留自己的焦点约束。
- AI 面板遵循共享进出动画、inert、焦点管理与 VisualViewport 约定。独立临时 SQLite 与模拟 AI 的验证脚本：`npx tsx scripts/test-ai-planner.ts`；必须在加载数据库模块前设置临时路径。Markdown 渲染与链接 / HTML 边界验证：`npx tsx scripts/test-chat-markdown.ts`。网页建点结果筛选验证：`npx tsx scripts/test-ai-map-effects.ts`。

## MCP 接入

- 入口 `POST /api/mcp`，每个请求创建 server 与 transport，不能复用绑定过 transport 的 `McpServer` 实例。
- 工具注册在 `src/lib/mcp/tools/`，完整工作流参考 `server.ts` 的 `workflow` prompt。
- `plan_trip_day` 按地点名称搜索 / 创建标记并加入当天，会生成链；创建同一天地点后校验坐标，任意两点超过 100km 或定位失败应报告，不默默继续。
- **`create_day_chain` 使用已有 marker ID 创建链，不创建地点**；校验旅行 / 天、marker 是否存在及链内重复，并将尚未属于当天的 marker 加入当天成员。
- `update_day_chain` 以完整已有 marker ID 列表替换一条链，校验索引、重复与地点存在，并补齐当天成员；`delete_day_chain` 仅移除链。二者保留地点、原有当天成员及其他路线，通过服务层事务写入。优先使用最新 `get_trip_detail` 的 `routeChains[].id` 作为 `chainId`；兼容 `chainIndex`（`chains` 数组从0开始的索引，二选一）；删除后后续索引前移，继续操作先重读详情。网页 AI 自动复用这两个 MCP 工具，写入后刷新地图与行程。
- `assign_marker_to_trip` / `remove_marker_from_trip` 操作旅行待分配地点；`assign_marker_to_day` 分配到日期时移出当前旅行待分配列表，保留其他旅行归属。
- 搜索名称应包含城市 / 区域，海外显式传 country 并选择合适 provider。MCP 与 Web 维护相同的数据一致性。

## 路线安排前端

- 正式侧栏复用 `src/components/trips/route-schedule.tsx`。地点时间与计划时长放在右上角，交通信息在浅灰虚线容器内，距离靠左，时间靠右；上下沿用原有蓝色折角箭头并居中。整小时显示1小时/2小时，90分钟仍显示90分钟，编辑和存储使用分钟。
- 编辑态地点卡片顶部对齐拖拽、序号、图标、标题和时间；长标题最多两行，地址紧跟标题；编辑模式下未填时间和时长的地点右上角使用灰色钟表图标 + `--:--` 时间占位，不使用“设时间”等行动文案；只有浏览模式不显示空占位，已有时间/时长沿用同一位置和字号。移除、上下移统一放底部32px操作栏。移动端紧凑按钮覆盖需使用不低于通用 `button:not([role="switch"])` 的选择器优先级，实测 coarse pointer 的高度，不只看桌面截图。
- 安排编辑统一由已有“编辑模式”控制，使用紧凑弹窗，不增加铅笔按钮。交通方式、线路/车次号和备注分开输入；可清除交通安排，字段留空清除对应值。保存采用服务端返回的完整 TripDay，旧 chains 重排也刷新权威 routeChains，不能让访问 ID 或安排残留在旧顺序。快速重排按日期串行写入，过时响应不覆盖较新的乐观顺序。
- 未设置交通安排时卡片不显示推测的交通方式（寻路内部按2km阈值选择）：浏览模式有距离就只展示距离，无距离时只展示一支居中箭头，不显示空虚线框；编辑模式显示水平居中的“无交通安排”入口，有距离时距离仍靠左且不影响文案居中。已填交通但无距离时仍展示交通信息，不填0km或虚构距离。
- 开发环境 `/dev/route-designs` 使用正式侧栏和组件配合模拟数据，展示已设置/未设置安排的状态；生产环境返回404。测试写入由浏览器mock或独立SQLite承接，不操作线上数据。无新增环境变量。

## 验证与交付

- 代码变更通常执行 `npm run type-check`、`npm run build`、`git diff --check`。文档变更检查内容、路径与 diff，无需无意义地重新构建。
- 地图改动检查两种 renderer 的相关逻辑；至少说明哪种进行了真实 SDK 测试、哪种是 mock，不能把 mock 结果声称为生产验证。
- 路径算法改动用真实缓存数据生成前后对比图，先看图再下结论；检查起终点、有限坐标、正常转弯、大掉头、远离行程点的环路、原始路径不变与缓存复用。
- 浏览器验证用只读线上数据或 mock；临时 DB 通过 `SQLITE_PATH` 指向独立文件。测试图与临时导出不要混入正式资源。
- 用户要求先图片审阅时，在审阅前不要推送 / 部署该功能；用户批准后按授权继续。常规已授权的 push / deploy 可直接执行，避免重复索要确认。
- 提交前检查 diff，不夹带其他任务或敏感数据。完成后报告 commit、验证结果、部署状态和实际限制。
- 本项目现有生产部署命令（仅在获得部署授权时使用）：

```bash
ssh -p 2222 -o BatchMode=yes root@server \
  'bash /root/docker-services/build/mapannai-public/deploy.sh'
```

部署脚本位于服务器，不在本仓库。等待构建与容器重建完成，再检查 `mapannai` 容器运行状态及容器内 `http://127.0.0.1:3000/` 的 HTTP 状态；不要在脚本仍运行时宣布部署成功。文档更新不需要重建生产服务。

路径与高德 `OVER_DIRECTION_RANGE` 和不支持地区终止结果永久保存在 SQLite `direction_cache`，Web / MCP 共用；超范围仅显示起终点之间的虚线贝塞尔关联曲线，距离由 WGS-84 两点计算，耗时为null；界面仅显示距离数值，不增加“直线”字样，不自动或手动重试。坐标、模式或 provider 变化后使用新缓存键。

路线计算完成后移除进度显示；高德不支持地区的路段保存为不可规划结果，显示虚线贝塞尔关联曲线，不反复请求或显示重试。仅临时失败保留重试入口。

每段路线按 `routeChains` 中当前有向相邻 stops 的 active leg 选择方式：步行→walking，自行车→bicycling，自驾/出租车→driving，公交/地铁/火车→transit；飞机/轮船/其他不调用寻路，使用虚线贝塞尔曲线。没有交通安排时按 WGS-84 起终点直线距离，小于2km步行，否则驾车。公共映射在 `route-mode.ts`，地图两种 renderer 与侧栏距离使用同一映射；不改变剪枝、平滑、显示路径与点击动画约定。旧本地设置仅保留 enabled，忽略原 auto/mode。缓存按实际模式复用；公共交通正常结果和 NO_ROUTE 缓存1小时。接口与MCP见 [行程路线合约](docs/itinerary-routing.md)。

每次页面启动按本地日期定位到最近尚未开始的旅行（含今天），镜头居中在第一天第一条路线的第一个有效地点（没有路线则按当天地点顺序），使用默认概览缩放 zoom=11，不使用旅行范围中心或 popup 偏移，保持总览且不选中旅行 / 日期 / 地点。不再从 URL hash 或 sessionStorage 自动恢复选中；第一天无有效地点的旅行跳过，无可定位的未来旅行时保留上次 / 默认镜头。等待地点、旅行和地图全部加载后仅执行一次，普通数据刷新不重置镜头。

- Web 搜索结果同步显示临时蓝色圆点，地图圆点与列表共用选择和添加弹窗，选中项高亮；清空、换关键词、失败和退出地图移除临时覆盖物。两种 renderer 共享样式和POI稳定ID，高德覆盖物复用并在边界转换GCJ-02；搜索结果不会自动写入地点或行程。
