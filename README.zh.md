# MapAnNai Plus（マップ案内）

[English](README.md) | 中文 · [iOS 客户端](https://github.com/RicterZ/mapannai-ios)

把想去的地方放到地图上，再把它们整理成每天的旅行计划。

MapAnNai Plus 是一个可自行部署的地点收藏与旅行行程编辑工具。你可以记录餐厅、酒店、景点和交通站点，添加笔记与图片，按旅行和日期安排访问顺序，也可以让 AI 助手直接帮你整理行程。网页、iOS 客户端和 MCP 使用同一服务端的地点与旅行数据。

## 产品功能

- **收藏地点与旅行笔记**：点击地图或搜索添加地点，用十类自绘图标区分美食、住宿、购物、景点等，旅行和日期可选择60款图标（含10面国旗）；富文本笔记支持列表、链接和图片。
- **按天安排行程**：创建旅行时可搜索选择多个目的地省市，以输入框内标签添加或移除，保存中心坐标用于地图定位和旅行内搜索；自动生成每天的安排，支持调整旅行日期、增减天数，以及将已有地点加入不同日期。 删除旅行或日期时，可选择同时删除仅属于一个旅行、一个日期的地点；跨旅行或跨日期共用的地点会保留。
- **自由组织访问顺序**：地点可以先收藏到旅行，暂不分配日期；在旅行详情中拖到某天，再安排路线。一天可以有多条路线，拖动调整路线中的地点顺序；同一个地点可以出现在多条路线中，方便安排不同活动。
- **在地图上看清整体安排**：切换全部地点、旅行总览与每日视图，用颜色区分日期，点击地点或路线查看对应安排。
- **选择路线呈现方式**：使用曲线连接地点，或开启路线规划，按每段已安排的交通方式显示步行、骑行、驾车或公共交通路线。未安排交通时按距离选择步行或驾车；无法规划的路段保持虚线曲线，并显示两点间的距离。路线用于表达地点关系和访问顺序，逐路口导航可通过地点的外部导航入口打开。
- **搜索附近地点**：同时匹配已收藏地点和平台结果；旅行内分别搜索各目的地附近并合并结果，总览及未设置目的地的旅行使用当前地图范围；相同坐标优先显示已收藏地点，点击即可定位。桌面端在左侧工作区切换旅行与日期，点击“添加地点”在同一区域搜索，顶部输入关键词，下方结果正文用于查看右侧地图，加号用于添加；已有地点直接复用，新地点可以一次填写名称、分类、封面和富文本笔记后保存，已有地点使用同一编辑器；保存失败保留输入，加入行程失败可直接重试。搜索期间切换视图仍保留原添加目标。
- **让 AI 帮你规划**：在网页中配置自己的 AI API，用多轮对话创建旅行、寻找地点和编排路线；聊天记录保存在当前浏览器。也可通过 MCP 连接外部 AI 助手，继续调整同一份行程，包括修改已有路线的地点顺序和删除路线；删除路线会保留地点。AI 还可记录每次访问的游览时间和停留时长，以及路段交通方式、独立线路／车次号和备注；每日路线中可查看这些安排，开启编辑模式即可修改；交通信息与地点卡片分别展示。
- **随时查看和编辑**：网页采用白色与中性灰阅读区，区分地点、访问安排和交通层级，并以独立颜色标识每日路线，适配桌面与手机，支持安装为 PWA；也可使用 [原生 iOS 客户端](https://github.com/RicterZ/mapannai-ios)，客户端的安装与配置见对应仓库。
- **自行保管旅行数据**：地点、行程和路线缓存存储在自己的服务端，可设置访问 token；图片上传可选接入腾讯云 COS。

<img width="1481" height="918" alt="地图与旅行行程总览" src="https://github.com/user-attachments/assets/8cc1543e-1e5c-4f9b-93b8-66b72e73fce9" />

<img width="1481" height="918" alt="每日地点与路线编辑" src="https://github.com/user-attachments/assets/5e806e0e-86ff-4758-a85e-dae49e4afc8a" />

## 开始规划

1. 从侧栏点击“添加地点”搜索想去的地方，或开启编辑模式在地图上选点，记录类型、笔记与图片。
2. 创建旅行，搜索选择一个或多个目的地省市并设置日期，把收藏的地点加入每天的安排。
3. 为当天建立一条或多条路线，拖动地点调整访问顺序。
4. 在总览中检查每天的安排，出行时用手机查看地点与笔记。

左侧工作区按年份浏览旅行；进入旅行后，可按日期查看各条路线的访问顺序预览和未加入路线的地点。日详情按访问序号展示地点，右侧显示计划时间与停留时长，访问备注位于地点下方，交通安排位于相邻地点之间；开启编辑模式可调整顺序与安排。

希望 AI 帮忙时，点击网页右上角“AI 规划”并配置 API，或连接下方的 MCP 服务，再描述目的地、日期和偏好。例如：“帮我安排东京三日游，喜欢美食和公园，优先使用我已经收藏的地点。”

## 部署自己的服务

### 1. 获取项目并选择地图服务

```bash
git clone https://github.com/RicterZ/mapannai-public.git
cd mapannai-public
cp env.example .env
```

编辑 `.env`：`MAP_RENDERER=amap` 按现有中国范围判断函数，以地图中心自动选择境内高德、境外 Google，移动结束后切换并保留地图位置与行程状态；`osm` 保持固定 OSM 底图。后端按现有中国范围判断函数自动选择服务：境内优先高德，获取不到有效结果时回退 Google，境外使用 Google。跨境路线不请求寻路，展示虚线与两点距离。搜索按地图范围中心判断，无范围时按国家选择。完整配置见 [env.example](env.example)。

高德底图搭配双后端服务的配置示例：

```dotenv
MAP_RENDERER=amap
AMAP_JS_KEY=your-web-js-key
AMAP_JS_SECURITY_CODE=your-js-security-code
AMAP_API_KEY=your-web-service-key
GOOGLE_API_KEY=your-google-api-key
API_TOKEN=your-access-token
```

高德 JS Key 与安全密钥需配套，并在控制台配置部署域名；后端 Web 服务 Key 单独申请。Google 需启用 Places、Geocoding、Directions API，用于海外服务及境内回退。Google 底图默认采用清爽浅色配色，保留地点与交通标签。另外需要启用 Maps JavaScript API 和计费，默认复用 `GOOGLE_API_KEY`，也可通过 `GOOGLE_JS_KEY` 配置专用浏览器 Key。后端服务选择与前端底图切换独立，旧 `MAP_*_PROVIDER` 服务配置不再控制自动选择。

设置 `API_TOKEN` 后，网页首次访问会要求输入 token，iOS 与 MCP 使用相同 token。留空时，任何能访问服务的人都可以操作数据。需要图片上传时再填写 `TENCENT_COS_*`，并配置存储桶的上传跨域规则和 `NEXT_PUBLIC_IMAGE_DOMAINS`。

### 2. 使用 Docker Compose 启动

安装 Docker 与 Compose 后，在项目目录运行：

```bash
docker compose up -d --build mapannai
docker compose logs -f mapannai
```

高德配置完成后，可打开 `http://localhost:3000`；远程部署时使用服务器地址，或通过反向代理配置 HTTPS 域名。后续更新：

```bash
git pull
docker compose up -d --build mapannai
```

默认 Compose 使用 `mapannai_data` 命名卷保存 `/app/data`，包含地点、旅行和路线缓存。更新时保留该卷，并定期备份；`docker compose down -v` 会删除数据卷。自定义 `SQLITE_PATH` 时，应指向持久化挂载目录。

### 3. OSM 底图配置

OSM 默认从同源 `/osm-tiles/{z}/{x}/{y}.png` 加载瓦片，需要在应用前配置反向代理。以下规则放入已有的 Nginx `server` 块中，与转发至应用 3000 端口的规则配合使用：

```nginx
location /osm-tiles/ {
    proxy_pass https://tile.openstreetmap.org/;
    proxy_set_header Host tile.openstreetmap.org;
    proxy_set_header User-Agent "MapAnNai/1.0 (your-contact-email)";
}
```

将联系邮箱换成自己的地址。直接访问应用的 3000 端口不会经过这条代理规则。

本地开发或直接使用 Node 构建时，可在 `.env` 中设置 `NEXT_PUBLIC_OSM_TILE_PROXY=false`，让浏览器直接加载 OSM 瓦片。`NEXT_PUBLIC_*` 变量在构建时生效；当前 Docker 构建只透传 `NEXT_PUBLIC_IMAGE_DOMAINS`，若要在 Docker 中关闭瓦片代理，需要同时为 Dockerfile 和 Compose 增加对应构建参数后重新构建。

服务端配置变更后重启服务，`NEXT_PUBLIC_*` 配置变更后重新构建。

## 在网页中用 AI 规划

点击右上角 **AI 规划**，在设置浮层中填写 API 地址、API Key 和模型名称。支持 OpenAI 兼容的 **Chat Completions** 接口及工具调用；地址可填写 API 基础地址（例如 `https://your-api.example/v1`）或完整的 `/chat/completions` 地址。仅提供 Responses、Anthropic Messages 等其他协议的服务需要兼容网关。

可以先讨论偏好，再让 AI 创建或调整行程。AI 复用本站的 MCP 工具进行搜索、收藏地点、创建旅行和编排路线，操作结果会同步到地图。支持新建、切换和删除会话；删除聊天记录不删除已保存的旅行或地点。

助手叫“M酱”，像熟络的旅行搭子一样直接聊安排，不发 emoji，偶尔用颜文字。

每个话题独立保留对话上下文，每次请求自动附带最新旅行列表与 ID，无需 AI 重复查询列表。AI 回复支持 Markdown，标题与正文保持紧凑。 新建地点后地图自动展示对应地点或批量地点范围。聊天面板可保持打开并操作地图。

聊天记录与地址、模型设置保存在当前浏览器，不在不同设备之间同步。Key 默认仅保留在当前页面，勾选“在本浏览器记住 Key”后会明文保存在本地。每次请求会将本次会话记录、必要的行程工具结果和 Key 经本站后端发送到所配置的 AI 服务；本站不将 Key 或聊天记录写入数据库。

默认只连接公共 HTTPS API。自托管 AI 服务需要访问私有网络或 HTTP 地址时，可由部署者在 `.env` 设置 `AI_ALLOW_PRIVATE_ENDPOINTS=true` 并重启服务；此时地址必须能从本站服务端访问，Docker 中的 `localhost` 指容器自身。

停止回复不会撤销已保存的行程操作，正在执行的工具也可能仍会完成。断线或停止后先确认地图数据，再继续规划。

## 连接外部 AI 助手

服务器 `.env` 配置 `BRAVE_API_KEY` 和 `FIRECRAWL_API_KEY` 即可启用 `search_web` 和 `fetch_web`。Node 22 主容器已安装固定版本 Brave / Firecrawl 官方 MCP，通过 stdio 调用，不需要额外容器、端口或 MCP URL。使用原有 `docker compose up -d --build` 部署。联网经第三方服务处理，可能计费。非 Docker 部署需在 Node 22 下全局安装 `@brave/brave-search-mcp-server@2.1.4` 和 `firecrawl-mcp@3.29.1`。

在支持 **Streamable HTTP** 的 MCP 客户端中添加服务地址 `https://your-domain/api/mcp`；本地地址为 `http://localhost:3000/api/mcp`。启用认证时配置请求头 `Authorization: Bearer YOUR_TOKEN`。

使用 `mcpServers` 配置格式的客户端可参考：

```json
{
  "mcpServers": {
    "mapannai": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}
```

未设置 `API_TOKEN` 时可移除 `headers`。不同客户端的配置格式以其设置界面为准。

连接后，AI 可以搜索与收藏地点、创建旅行、安排每天的地点，以及用已有地点建立路线。支持 prompt 的客户端可读取 `workflow` 获取操作指南。描述地点时带上城市名，海外搜索明确国家；让 AI 先确认搜索结果，再保存行程。

从官方搜索结果收藏地点时会保留平台 POI 引用，供客户端恢复原地点；旧地点仍可使用坐标。iOS 接入规则见 [客户端 API 合约](docs/place-references.md)。

## 本地开发

网页 AI 由独立 Node Agent 执行，原网页聊天接口保持兼容。本地同时运行 `npm run agent:start` 与 `npm run dev`；Docker 在同一容器内启动 Web 与 Agent 两个独立进程，配置统一放在项目 `.env`，两份数据库均持久化到 `/app/data`；不再需要 Agent 容器或额外 env 文件。接入、限制与验收步骤见 [Agent 服务](docs/agent-service.md)。

Node 服务启动后会后台补全有坐标但地址为空的地点，随后每轮完成一小时后再次扫描。国内优先高德、失败或无地址时回退 Google，境外直接使用 Google；只补地址，不修改坐标或已有地址。需要配置对应地图服务 Key，批量补全可能产生 API 费用；此任务需要持续运行的 Node 服务。

使用 Node.js 20 与 npm，在项目目录中执行：

```bash
cp env.example .env
npm ci
```

编辑 `.env` 配置地图服务。使用默认 OSM 底图且没有瓦片反向代理时，将 `NEXT_PUBLIC_OSM_TILE_PROXY` 设为 `false`，然后启动：

```bash
npm run dev
```

打开 `http://localhost:3000`。需要其他端口时运行 `npm run dev -- --port 3101`。数据库默认保存在 `./data/mapannai.db`，首次运行自动创建。

常用检查与生产运行命令：

```bash
npm run type-check
npm run build
npm start
git diff --check
```

构建前停止同一目录下的开发服务，避免争用 `.next`。`npm start` 使用已完成的构建；不使用 Docker 时，也可用这种方式运行服务并持久化 `data` 目录。更换 Node 版本后若 SQLite 原生依赖报 ABI 错误，可运行 `npm rebuild better-sqlite3`。

项目使用 Next.js、React、TypeScript 与 SQLite。开发约定、源码职责和验证要求见 [AGENTS.md](AGENTS.md)；环境变量说明统一维护在 [env.example](env.example)。

诊断时可在同一 `.env` 开启 `AGENT_TRACE_ENABLED`，脱敏 transcript 写入现有 Agent 数据库；仍含私人对话，不要公开，详见 [Agent 服务](docs/agent-service.md)。

网页 AI 可通过聊天内日期时间、单选/多选和逐日草案预览卡片收集反馈；等待最多60秒，超时只允许明确标注的草案假设，不代表用户授权保存、删除或预订。旧客户端仍可文字对话。
