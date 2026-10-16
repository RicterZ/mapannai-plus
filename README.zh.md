# MapAnNai Plus（マップ案内）

[English](README.md) | 中文 · [iOS 客户端](https://github.com/RicterZ/mapannai-ios)

**把想去的地方钉在地图上，再慢慢排成一趟旅行。**

刷到一家想吃的店、朋友推荐的小巷、攻略里的观景台——先收进地图。等旅行日期定下来，再把它们分到每一天，排好先后，记下几点出门、坐哪班车。出发后，打开手机就是同一份行程。

MapAnNai Plus 可以自己部署，数据留在你自己的服务器上；网页、iPhone / iPad 客户端和 AI 助手共用同一份旅行。

<img width="1481" height="918" alt="地图与旅行行程总览" src="https://github.com/user-attachments/assets/8cc1543e-1e5c-4f9b-93b8-66b72e73fce9" />

## 用它做什么

### 先收藏，不急着排

搜索或直接在地图上点选，把餐厅、酒店、景点、车站收进来。每个地点可以配封面照片、分类图标和图文笔记——营业时间、要点的菜、朋友的原话，都记在它旁边。

### 一天一天地编排

一趟旅行可以有多个目的地。还没想好哪天去的地点，先放在旅行里待分配；想好了再拖到某一天。每天可以有几条路线，拖动调整先后；同一个地点可以出现在不同的日子和路线里。

为每一站写上到达时间、打算待多久；为两站之间写上坐地铁还是打车、几号线、哪趟航班。改了出发日期，整趟行程会跟着顺移。

### 在地图上看清一天

每一天有自己的颜色。点地点或点路线，侧栏就跳到对应的安排。打开路线规划，能看到每段大概多远。

这些连线表达的是“先去这、再去那”，不是逐路口导航——它帮你看清一天的走向，真正出门时再交给你习惯的导航 App。

<img width="1481" height="918" alt="每日地点与路线编辑" src="https://github.com/user-attachments/assets/5e806e0e-86ff-4758-a85e-dae49e4afc8a" />

### 和 M酱 一起规划

不想从零排？打开 AI 规划，跟 M酱 聊聊去哪、哪几天、喜欢什么、有什么已经订好的。她会一个一个地问清楚，用卡片让你选日期、选偏好，然后给出一份逐日草案。你点头之后才会真正保存进地图；之后想改哪天，直接说。

可以丢给她截图和照片——攻略长图、菜单、车票都行（需要支持看图的模型）。也可以让她联网查资料。卡片会一直等你回答，不会倒计时替你做决定；刷新页面或者断网，回来还能接着看。

### 带着出门

桌面和手机浏览器都能用，也能添加到主屏幕；原生的 [iPhone / iPad 客户端](https://github.com/RicterZ/mapannai-ios) 看的是同一份数据。Claude、Cursor 这类支持 MCP 的 AI 助手也能直接读写你的旅行。

## 三步跑起来

**1. 准备配置。** 在服务器上建一个 `.env`：

```dotenv
MAP_RENDERER=amap                       # 国内用高德，境外自动切换 Google
AMAP_API_KEY=your-amap-web-service-key
AMAP_JS_KEY=your-amap-js-key
AMAP_JS_SECURITY_CODE=your-matching-js-security-code
GOOGLE_API_KEY=your-google-server-key
GOOGLE_JS_KEY=your-google-browser-key
API_TOKEN=replace-with-a-long-random-token
```

这几个 Key 怎么申请、要开通哪些服务，见下面的[地图 Key](#地图-key)。`API_TOKEN` 是你自己编的访问口令，网页、iOS 和 MCP 都用它；部署在公网上一定要设。

**2. 启动。**

```bash
docker run -d --name mapannai --restart unless-stopped \
  -p 3000:3000 --env-file .env \
  -v mapannai_data:/app/data \
  ghcr.io/ricterz/mapannai-plus:latest
```

**3. 打开 `http://localhost:3000`。** 远程访问建议套上 HTTPS。网页和 AI 服务都在这一个镜像里，不用额外开端口。

想用 AI 规划，在网页的 AI 设置里填上模型服务的地址、Key 和模型名就行——任何兼容 OpenAI Chat Completions、支持工具调用的服务都可以。

> 地点、旅行和 AI 记录都在 `mapannai_data` 数据卷里。更新前先备份；**不要执行 `docker compose down -v`**，它会把数据卷一起删掉。

## 地图 Key

推荐 `MAP_RENDERER=amap`：地图中心在国内时用高德，移到境外自动换成 Google；搜索和路线也按地区选服务，高德查不到时回退 Google。所以通常两家的 Key 都要准备。

| 你要的功能 | 填什么 | 去哪申请 |
| --- | --- | --- |
| 国内地点搜索、路线 | `AMAP_API_KEY` | 高德控制台，**Web 服务**平台 |
| 国内底图 | `AMAP_JS_KEY` + `AMAP_JS_SECURITY_CODE` | 高德控制台，**Web 端（JS API）**平台，两者配套 |
| 境外地点搜索、路线 | `GOOGLE_API_KEY` | Google Cloud，开 Places / Geocoding / Directions |
| 境外底图 | `GOOGLE_JS_KEY` | Google Cloud，开 Maps JavaScript API |

<details>
<summary>Google Maps Platform 详细说明</summary>

在 [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/overview) 创建项目、关联结算账号，并为每个 Key 设置 API 限制。**服务端、网页和 iOS 分别建 Key**，它们的应用限制不能混用。

| 用途 | 配置位置 | 需要启用的 API | Key 限制 |
| --- | --- | --- | --- |
| 服务端地点搜索、详情、目的地与地址查询、路线规划（网页和 iOS 共用） | `.env` 的 `GOOGLE_API_KEY` | **Places API（Legacy）**、**Geocoding API**、**Directions API（Legacy）** | 可按服务器出口 IP 限制；不要设网站或 iOS 限制 |
| 网页境外底图 | `.env` 的 `GOOGLE_JS_KEY` | **Maps JavaScript API** | 网站 HTTP referrer 限制，包含实际域名；本地开发单独允许 localhost |
| iOS 原生 Google 底图 | iOS 仓库 `Config/Local.xcconfig` 的 `GOOGLE_MAPS_IOS_KEY` | **Maps SDK for iOS** | iOS 应用限制，绑定最终 Bundle ID |

**服务端用的是旧版 Places 与 Directions 接口，只开 Places API (New) 或 Routes API 不够。** Google 对新项目开通旧版接口有限制；控制台里开不了时，先确认项目资格，换 Key 解决不了。

`GOOGLE_JS_KEY` 留空时网页会复用 `GOOGLE_API_KEY`，这个 Key 会因此发到浏览器，还得允许 Maps JavaScript API；不建议复用已经限制了服务器 IP 的 Key。

</details>

<details>
<summary>高德开放平台详细说明</summary>

在 [高德控制台](https://console.amap.com/) 创建应用，按平台分别申请 Key。高德不是勾选同名 API 的流程，关键是 **Key 的平台类型对，且对应服务的权限和配额可用**；不同平台的 Key 不能互相代填。

| 用途 | 配置位置 | 平台与能力 | 注意 |
| --- | --- | --- | --- |
| 服务端国内地点搜索、详情、目的地与地址查询、路线规划（网页和 iOS 共用） | `.env` 的 `AMAP_API_KEY` | **Web 服务**：POI 搜索（关键字、多边形、详情）、地理／逆地理编码、步行／驾车／骑行／公交路径规划 | 设 IP 白名单时填服务器出口 IP |
| 网页国内底图 | `.env` 的 `AMAP_JS_KEY` 与 `AMAP_JS_SECURITY_CODE` | **Web 端（JS API）**，JS API 2.0 | 配置域名白名单；安全密钥须与 JS Key 配套，两者都会下发到浏览器 |
| iOS 原生高德底图 | iOS 仓库 `Config/Local.xcconfig` 的 `AMAP_IOS_KEY` | **iOS** 平台 | 绑定最终签名的 Bundle ID；AltStore 等重签可能改变它 |

iOS 的搜索和寻路走的是服务器，只有 iOS SDK Key 不够。

</details>

<details>
<summary>iOS 客户端需要什么</summary>

- 装好现成客户端的用户，只需在应用设置里填本站地址和 `API_TOKEN`，不用碰地图 Key。
- 自己构建时，原生地图 Key 放在 iOS 仓库的 `Config/Local.xcconfig`，不是本站 `.env`。详见 [iOS 客户端](https://github.com/RicterZ/mapannai-ios)。
- 选择 Apple 地图不需要 Google／高德底图 Key；搜索和路线仍依赖服务器上配好的地图服务。

</details>

## 可选功能

| 想要 | 配置 |
| --- | --- |
| 地点封面、AI 看图片 | 腾讯云 COS：`TENCENT_COS_SECRET_ID`、`TENCENT_COS_SECRET_KEY`、`TENCENT_COS_REGION`、`TENCENT_COS_BUCKET`。建议用只有该存储桶读写权限的子账号；存储桶要配置 CORS，允许本站来源 PUT 上传，图片要能被浏览器和模型读取 |
| AI 联网搜索 | `BRAVE_API_KEY`（Brave Search API） |
| AI 读网页 | `FIRECRAWL_API_KEY`（Firecrawl） |

所有变量的完整说明见 [env.example](env.example)。地图、AI、存储和联网服务可能各自计费；浏览器端 Key 会随网页下发，记得设好平台限制，服务端 Key 和密钥不要提交进仓库。

<details>
<summary>更多部署方式</summary>

**Docker Compose（GHCR 镜像）**

```bash
docker compose -f docker-compose.ghcr.yml up -d
# 更新
docker compose -f docker-compose.ghcr.yml pull && docker compose -f docker-compose.ghcr.yml up -d
```

默认用 `latest`；在 `.env` 里设 `MAPANNAI_IMAGE=ghcr.io/ricterz/mapannai-plus:<版本>` 可固定到某个已发布版本。

**从源码构建**

```bash
git clone https://github.com/RicterZ/mapannai-plus.git && cd mapannai-plus
cp env.example .env
docker compose up -d --build mapannai
```

**发布自己的镜像**

在 GitHub **Actions → Publish container image → Run workflow** 手动构建，或发布 Release 自动触发。镜像推到 `ghcr.io/<所有者>/<仓库名>`，支持 `linux/amd64` 与 `linux/arm64`，使用内置 `GITHUB_TOKEN`。正式 Release 生成版本标签和 `latest`，预发布不覆盖 `latest`；默认分支手动构建生成 `edge` 和提交 SHA 标签。首次发布后到 GitHub Packages 检查包的可见性。

`NEXT_PUBLIC_IMAGE_DOMAINS` 是构建期配置：需要自定义图片域名时，在 Actions 仓库变量里设置后构建自己的镜像，或从源码构建。

**使用 OSM 底图**

设 `MAP_RENDERER=osm` 时使用 OpenStreetMap 底图，不需要地图 Key，但搜索和路线仍需要上面的服务端 Key。（未设置时程序默认就是 OSM，所以想用高德／Google 请显式写 `amap`。）瓦片默认走同源 `/osm-tiles/`，需要在反向代理里转发：

```nginx
location /osm-tiles/ {
    proxy_pass https://tile.openstreetmap.org/;
    proxy_set_header Host tile.openstreetmap.org;
    proxy_set_header User-Agent "MapAnNai/1.0 (your-contact-email)";
}
```

换成你的联系邮箱，并遵守瓦片服务的使用政策。本地 Node 运行可在构建前设 `NEXT_PUBLIC_OSM_TILE_PROXY=false` 改为浏览器直连。

</details>

## 连接其他 AI 助手

在支持 **Streamable HTTP** 的 MCP 客户端里添加：

```json
{
  "mcpServers": {
    "mapannai": {
      "type": "http",
      "url": "https://your-domain/api/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

没设 `API_TOKEN` 就去掉 `headers`。连上之后，助手可以搜索和收藏地点、创建旅行、安排每天的路线和交通，改动在网页和 iOS 上同步可见。

## 隐私

- 聊天记录和模型设置保存在你自己的浏览器里，不跨设备同步。勾选“记住 Key”会把 Key 明文存在浏览器。
- 和 AI 对话时，对话内容、必要的行程信息和图片链接会发给你配置的模型服务。
- 服务器会保存 AI 的运行结果和工具记录，以便断线后恢复；开启诊断日志时还会记录对话内容。请把数据库和备份当作私人数据对待。

## 本地开发

需要 Node.js 22 和 npm，配置参考 [env.example](env.example)。

```bash
npm ci
npm run dev           # 网页，默认 http://localhost:3000
npm run agent:start   # 另开一个终端，网页 AI 需要它
```

提交前：

```bash
npm run type-check
npm run build
git diff --check
```

不要在同一目录同时跑开发服务和构建。换了 Node 版本后 SQLite 报错，运行 `npm rebuild better-sqlite3`。AI 服务与联网工具的细节见 [Agent 服务](docs/agent-service.md)，开发约定见 [AGENTS.md](AGENTS.md)。
