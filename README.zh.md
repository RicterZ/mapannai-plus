# MapAnNai Plus（マップ案内）

[English](README.md) | 中文 · [iOS 客户端](https://github.com/RicterZ/mapannai-ios)

把想去的地方放到地图上，再把它们整理成每天的旅行计划。

MapAnNai Plus 是一个可自行部署的地点收藏与旅行行程编辑工具。你可以记录餐厅、酒店、景点和交通站点，添加笔记与图片，按旅行和日期安排访问顺序，也可以让 AI 助手直接帮你整理行程。网页、iOS 客户端和 MCP 使用同一服务端的地点与旅行数据。

## 产品功能

- **收藏地点与旅行笔记**：点击地图或搜索添加地点，用十类图标区分美食、住宿、购物、景点等；富文本笔记支持列表、链接和图片。
- **按天安排行程**：创建旅行后自动生成每天的安排，支持调整旅行日期、增减天数，以及将已有地点加入不同日期。
- **自由组织访问顺序**：一天可以有多条路线，拖动调整路线中的地点顺序；同一个地点可以出现在多条路线中，方便安排不同活动。
- **在地图上看清整体安排**：切换全部地点、旅行总览与每日视图，用颜色区分日期，点击地点或路线查看对应安排。
- **选择路线呈现方式**：使用曲线连接地点，或开启路线规划，让连线更贴合步行、驾车道路；自动模式按每段距离选择步行或驾车。路线用于表达地点关系和访问顺序，逐路口导航可通过地点的外部导航入口打开。
- **在当前地图范围内搜索**：搜索结果同时出现在列表和地图上，确认后再保存为自己的地点。
- **让 AI 帮你规划**：在网页中配置自己的 AI API，用多轮对话创建旅行、寻找地点和编排路线；聊天记录保存在当前浏览器。也可通过 MCP 连接外部 AI 助手，继续调整同一份行程。
- **随时查看和编辑**：网页适配桌面与手机，支持安装为 PWA；也可使用 [原生 iOS 客户端](https://github.com/RicterZ/mapannai-ios)，客户端的安装与配置见对应仓库。
- **自行保管旅行数据**：地点、行程和路线缓存存储在自己的服务端，可设置访问 token；图片上传可选接入腾讯云 COS。

<img width="1481" height="918" alt="地图与旅行行程总览" src="https://github.com/user-attachments/assets/8cc1543e-1e5c-4f9b-93b8-66b72e73fce9" />

<img width="1481" height="918" alt="每日地点与路线编辑" src="https://github.com/user-attachments/assets/5e806e0e-86ff-4758-a85e-dae49e4afc8a" />

## 开始规划

1. 在地图上搜索或点击添加想去的地方，记录类型、笔记与图片。
2. 创建旅行并选择日期，把收藏的地点加入每天的安排。
3. 为当天建立一条或多条路线，拖动地点调整访问顺序。
4. 在总览中检查每天的安排，出行时用手机查看地点与笔记。

希望 AI 帮忙时，点击网页右上角“AI 规划”并配置 API，或连接下方的 MCP 服务，再描述目的地、日期和偏好。例如：“帮我安排东京三日游，喜欢美食和公园，优先使用我已经收藏的地点。”

## 部署自己的服务

### 1. 获取项目并选择地图服务

```bash
git clone https://github.com/RicterZ/mapannai-public.git
cd mapannai-public
cp env.example .env
```

编辑 `.env`。底图与搜索、地点详情、路线服务可以分别选择，完整配置见 [env.example](env.example)。

| 使用场景 | 底图 | 搜索 / 详情 / 路线 | 所需配置 |
| --- | --- | --- | --- |
| 中国境内使用高德 | `MAP_RENDERER=amap` | 三项 provider 设为 `amap` | 高德 Web 端 JS Key、配套安全密钥、独立的 Web 服务 Key |
| 海外地点使用 Google 服务 | `MAP_RENDERER=osm` | 三项 provider 设为 `google` | Google API Key，并启用所用的 Places、Geocoding、Directions API；配置 OSM 瓦片访问 |

全高德配置示例：

```dotenv
MAP_RENDERER=amap
MAP_SEARCH_PROVIDER=amap
MAP_DETAILS_PROVIDER=amap
MAP_DIRECTIONS_PROVIDER=amap
AMAP_JS_KEY=your-web-js-key
AMAP_JS_SECURITY_CODE=your-js-security-code
AMAP_API_KEY=your-web-service-key
API_TOKEN=your-access-token
```

高德 JS Key 与安全密钥需配套，并在控制台配置部署域名；服务端使用的 Web 服务 Key 单独申请。选择 Google 服务时填写 `GOOGLE_API_KEY`。只使用 OSM 底图、手动添加地点无需地图服务 Key；搜索、详情和道路路线需要对应服务凭据。

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

点击右上角 **AI 规划**，在设置中填写 API 地址、API Key 和模型名称。支持 OpenAI 兼容的 **Chat Completions** 接口及工具调用；地址可填写 API 基础地址（例如 `https://your-api.example/v1`）或完整的 `/chat/completions` 地址。仅提供 Responses、Anthropic Messages 等其他协议的服务需要兼容网关。

可以先讨论偏好，再让 AI 创建或调整行程。AI 复用本站的 MCP 工具进行搜索、收藏地点、创建旅行和编排路线，操作结果会同步到地图。支持新建、切换和删除会话；删除聊天记录不删除已保存的旅行或地点。

聊天记录与地址、模型设置保存在当前浏览器，不在不同设备之间同步。Key 默认仅保留在当前页面，勾选“在本浏览器记住 Key”后会明文保存在本地。每次请求会将本次会话记录、必要的行程工具结果和 Key 经本站后端发送到所配置的 AI 服务；本站不将 Key 或聊天记录写入数据库。

默认只连接公共 HTTPS API。自托管 AI 服务需要访问私有网络或 HTTP 地址时，可由部署者在 `.env` 设置 `AI_ALLOW_PRIVATE_ENDPOINTS=true` 并重启服务；此时地址必须能从本站服务端访问，Docker 中的 `localhost` 指容器自身。

停止回复不会撤销已保存的行程操作，正在执行的工具也可能仍会完成。断线或停止后先确认地图数据，再继续规划。

## 连接外部 AI 助手

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

## 本地开发

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
