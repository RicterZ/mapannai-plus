# AGENTS.md — MapAnNai Plus 开发入口

所有接入本仓库的开发 agent 请先阅读此文件，再查看相关源码。这里记录产品理念、架构边界和已确认的交互约定，适用于整个仓库。修改功能时同步维护本文件、`env.example` 和相关 README，避免把过时实现当作设计要求。

## 产品理念：地点关联，不是导航

MapAnNai Plus（マップ案内）是地图上的地点整理与旅行行程编辑工具，也提供 MCP 让 AI 操作相同的数据。

- 核心对象是地点（Marker）、旅行（Trip）、每日行程（TripDay）和有序地点链（chains）。用户关心地点之间的关联、访问顺序以及每日安排。
- **连线是关联路线，不是逐路口导航。** 用户不会被要求沿展示线行走。后端寻路只提供更贴合地图的连线形状，不能由此把产品改造成导航应用。
- 路线卡片保留地点数、访问顺序、查看路线等信息；不要重新加入寻路公里数、预计耗时、导航步骤等无用展示。外部单地点导航入口与关联路线是不同功能。
- 未开启路线规划时使用贝塞尔关联曲线；开启后使用后端路径并做显示平滑、局部剪枝。允许简化行程点附近的小掉头、回环和支路，保留行程点、主要走向和较大绕行。
- 显示优化不能修改原始寻路数据、路程、时长或行程地点。线条、白色描边、动画、透明点击范围必须使用同一条显示路径。
- 交互保持紧凑、自然，优先考虑移动端。减少 sidebar 占用、重复按钮、冗余状态文字和不必要的确认步骤。

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
| `src/lib/mcp/server.ts`, `tools/` | MCP server factory、workflow prompt、地点 / 行程 / 搜索工具 |
| `src/lib/upload/`, `src/lib/cos-client.ts` | COS 直传、压缩图片展示 |
| `src/middleware.ts`, `src/lib/auth.ts`, `fetch-with-auth.ts` | API 认证与前端 token 注入 |
| `env.example`, `Dockerfile`, `docker-compose.yml`, `next.config.js` | 配置说明、构建、容器与 PWA |

## 数据与业务约定

- 数据库默认 `./data/mapannai.db`，可通过 `SQLITE_PATH` 指定。Docker 默认数据目录 `/app/data`，需要持久化挂载。
- schema 初始化 / 迁移入口是 `src/lib/db/index.ts`。新增字段需兼容现有数据库，优先非破坏性迁移。
- `TripDay.markerIds` 表示当天地点成员；`chains: string[][]` 表示各链的访问顺序。成员关系和路线顺序不能混为一谈。
- 一个 marker 可以属于多个路线，列表应显示全部路线归属。删除地点或从某天移除时维护相关 chains，不能留下悬空引用。
- marker 去重使用坐标 hash 与距离兜底逻辑；不要因创建新链而重复创建已有地点。
- 修改旅行开始日期沿用现有天数并顺移每日日期；删除指定一天后维护剩余日期与旅行范围。
- `TripDay.colorIndex` 是持久化每日色号；日期变更、其他天删除、视图切换不应造成颜色漂移。地图、侧栏、标签使用统一色彩函数，避免相邻天都落入同一色系。
- 地点内容主要是 Tiptap HTML；不要把历史 `markdownContent` 命名误认为仅支持纯 Markdown。

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
- 高德地点服务主要面向中国，海外地点服务可以选择 Google。不要把没有搜索结果一概解释为权限或政策，先检查请求参数和返回值。

## 连线、缓存与动画：易回归点

- `POST /api/directions` 经 `src/lib/db/direction-cache.ts` 缓存原始路径。缓存键包含 provider、模式、起终点坐标；共享 in-flight 请求减少重复计算。
- 客户端同时使用内存和 localStorage 缓存。只计算未缓存的路段；多终端依赖服务端缓存，不因重绘重新寻路。
- 客户端共享队列串行请求并做高德 QPS 退避；服务器不需要照搬逐条排队。优先计算当前屏幕路段，再向外扩展。
- 地点坐标、连接关系、步行 / 驾车模式或 provider 变化时，使用正确的新缓存键；纯高亮和视图动画不应触发额外寻路。
- 平滑 / 剪枝只修改显示几何，单段剪枝使用 `smoothRoutePath`，整日显示布局使用 `layoutRoutePaths`。短距离小转盘允许拉直；同一天持续重合的往返路段允许渐进偏离道路、向两侧舒展，端点保持不动。普通交叉点、不同日期不做这种分离。原始寻路 API 输出和缓存不变；不要把显示路径的长度当作行程路程。
- 高德覆盖物尽量复用；**已有 Polyline 路径变化必须调用 `setPath()`**，不能只调用 `setOptions()`。可见线、白边、点击层都要更新，动画必须跟随同一条路径。
- 多天路线重叠时统一按屏幕距离选择候选；相邻路线优先最近一条，重叠处使用统一候选选择，不能由覆盖物层级决定唯一可选日期。点击路线直接进入所属旅行的对应 day 视图，同步 URL、侧栏与日期高亮；每日视图内不重复跳转，移动端不自动展开侧栏。已锁定的日期高亮优先于悬停。
- 路线的透明点击区域约 28px，避免只按视觉线宽响应手机触摸。保持完全透明，阻止背景点击把刚选中的路线清空。白色描边保持细，不要产生宽色带。
- 动画使用时间而非每帧固定增量；缓存路径长度，避免每帧扫描整条路线。减少覆盖物重建，尊重 reduced-motion，后台页面避免持续计算。

## 已确认的 UI 约定

- 编辑开关用 toggle；开启后才出现增减天数、删除旅行 / 日期等编辑控件，不要增加重复的“编辑中”提示。
- 删除旅行和指定日期共用弹出 Modal 二次确认，不恢复二段式删除按钮或只删除最后一天的逻辑。
- 路线卡片单列，一个地点可显示多个“路线 N”归属。路线标题与查看按钮保持移动端可触控大小。
- 路线规划的开关与步行 / 驾车选择放同一行，进度和重试保持紧凑。
- sidebar 可收起；移动端在 topbar 切换日期时更新内容但不自动打开 sidebar。
- 切换某天后定位到第一条链的第一个有效 marker。点击地点、查看路线 / 全天时，镜头与对应高亮保持同步。
- 总览胶囊文案为“总览 · 共N天”，保持单行。日期菜单不得继承胶囊横向布局，被 sidebar 遮挡或超出视口；注意长行程滚动、外部关闭与 Escape。
- sidebar 关闭使用统一的返回地图 / X 入口，不堆叠重复按钮。
- marker 弹窗里的操作保持短文案，例如“删除”，避免“删除地点”挤换行；按钮文字不换行，图标不被压缩。
- 移动端页面不缩放，地图仍允许手势缩放；变更手势行为时分别测试两者。
- 保留 marker popup 小尖头；检查旋转方块的阴影、接缝和边缘，避免破坏原有指向感。

## 图片与认证

- 图片上传：前端向 `/api/upload` 获取预签名 URL，然后直接 `PUT` 到 COS；凭据只留在服务端。
- 默认展示压缩图片，由 `src/lib/upload/image-url.ts` 添加 COS 图片处理参数，正文图片延迟加载；保留原文件，不把数 MB 原图恢复为默认展示。
- 可选 `API_TOKEN` 保护 `/api/*`；前端用 `fetchWithAuth` 注入 `Authorization: Bearer ...`。也支持 `x-api-token`，不把 token 放在 URL 查询串。
- 不把生产 token 写进本文件、README、测试或日志。

## MCP 接入

- 入口 `POST /api/mcp`，每个请求创建 server 与 transport，不能复用绑定过 transport 的 `McpServer` 实例。
- 工具注册在 `src/lib/mcp/tools/`，完整工作流参考 `server.ts` 的 `workflow` prompt。
- `plan_trip_day` 按地点名称搜索 / 创建标记并加入当天，会生成链；创建同一天地点后校验坐标，任意两点超过 100km 或定位失败应报告，不默默继续。
- **`create_day_chain` 使用已有 marker ID 创建链，不创建地点**；校验旅行 / 天、marker 是否存在及链内重复，并将尚未属于当天的 marker 加入当天成员。
- 搜索名称应包含城市 / 区域，海外显式传 country 并选择合适 provider。MCP 与 Web 维护相同的数据一致性。

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
