# MapAnNai Plus — 交互式旅行地图编辑器

[English](README.md) | 中文

基于 Next.js 14 的旅行规划平台。在交互式地图上创建和管理地点标记，按旅行和天组织行程，并通过内置 **MCP 服务器**让 AI 助手（Claude Desktop、Cursor 等）直接操作地图。

<img width="1481" height="918" alt="Clipboard_Screenshot_1774582478" src="https://github.com/user-attachments/assets/8cc1543e-1e5c-4f9b-93b8-66b72e73fce9" />

<img width="1481" height="918" alt="Clipboard_Screenshot_1774582430" src="https://github.com/user-attachments/assets/5e806e0e-86ff-4758-a85e-dae49e4afc8a" />

---

## 功能特点

- **交互式地图** — 部署时可选 MapLibre + OpenStreetMap 或高德 JS API 2.0；点击地图添加标记并编辑富文本笔记。
- **行程规划** — 按旅行、日期组织标记；拖拽或通过 MCP 创建多条行程链，可选关联曲线或带客户端与服务端缓存的步行、驾车寻路形状；显示时简化小转盘、平滑转角，并适度分开同一天重合的往返线，保留地点端点。
- **MCP 服务器** — 任何支持 MCP 协议的 AI 客户端都可直接创建标记、规划行程、查询路线。
- **地点服务** — 地点搜索、详情和步行／驾车寻路可独立选择 Google 或高德后端。
- **地图范围搜索** — 搜索框使用当前可见范围并向外扩展 20%。高德按范围搜索，“酒店”“高铁站／火车站”按 POI 类别匹配；Google 使用中心点与半径优先返回附近结果。MCP 的地点名称搜索不受地图范围限制。
- **图片上传** — 通过腾讯云 COS 为标记附加图片。
- **PWA** — 可作为渐进式 Web App 安装，支持离线瓦片缓存。
- **可选鉴权** — 静态 Token 认证；不设置 `API_TOKEN` 即为开放访问。

---

## 快速开始

### 1. 环境变量

```bash
cp env.example .env
# 启动前编辑 .env
```

地图渲染和三项地点服务分别配置，可自由组合。`env.example` 包含全部变量说明及全高德示例。在中国地区使用高德的配置如下：

```env
MAP_RENDERER=amap
MAP_SEARCH_PROVIDER=amap
MAP_DETAILS_PROVIDER=amap
MAP_DIRECTIONS_PROVIDER=amap
AMAP_JS_KEY=你的高德Web端JS_API_Key
AMAP_JS_SECURITY_CODE=对应的安全密钥
AMAP_API_KEY=你的高德Web服务Key
```

在高德控制台申请 **Web 端 JS API Key** 和对应安全密钥，并配置部署域名；`AMAP_API_KEY` 须另行申请 **Web 服务 Key**。高德地点与寻路服务适用于中国，海外地点请选择 Google。当前实现会将高德 JS Key 和安全密钥下发到浏览器。

| 变量 | 默认值／使用条件 | 用途 |
|------|-----------------|------|
| `MAP_RENDERER` | `osm` | `osm` 为 MapLibre + OSM；`amap` 为高德 JS API 2.0。 |
| `MAP_SEARCH_PROVIDER` | `google` | 搜索后端：`google` 或 `amap`。 |
| `MAP_DETAILS_PROVIDER` | `google` | 地点详情后端：`google` 或 `amap`。 |
| `MAP_DIRECTIONS_PROVIDER` | `google` | 步行、驾车寻路后端：`google` 或 `amap`。 |
| `AMAP_JS_KEY`、`AMAP_JS_SECURITY_CODE` | `MAP_RENDERER=amap` 时必填 | 高德 Web 端 JS API 凭据。 |
| `AMAP_API_KEY` | 使用任一高德地点服务时必填 | 高德 Web 服务 Key。 |
| `GOOGLE_API_KEY` | 使用任一 Google 地点服务时必填 | 按实际功能启用 Places、Geocoding、Directions API。 |
| `AMAP_API_BASE_URL`、`GOOGLE_API_BASE_URL` | 各服务默认地址 | 可选的 API 代理地址，见 `env.example`。 |
| `NEXT_PUBLIC_OSM_TILE_PROXY` | `true` | 设为 `false` 可直接获取 OSM 瓦片；否则须配置 `/osm-tiles/` 反代。 |
| `SQLITE_PATH` | `./data/mapannai.db` | SQLite 数据库文件。 |
| `API_TOKEN` | 空 | 可选 API 与 MCP Bearer Token；留空即开放访问。 |
| `TENCENT_COS_SECRET_ID`、`TENCENT_COS_SECRET_KEY`、`TENCENT_COS_REGION`、`TENCENT_COS_BUCKET` | 可选 | 腾讯云 COS 图片上传。 |
| `NEXT_PUBLIC_IMAGE_DOMAINS` | 可选 | 允许加载的图片域名，须在构建前设置。 |

修改服务端变量后需重启或重新部署；`NEXT_PUBLIC_*` 变量须在构建前设置。数据库坐标统一保存为 WGS-84，接入高德时在边界转换坐标。

寻路结果同时缓存在浏览器和 SQLite 的 `direction_cache` 表中。不同设备请求相同 provider、模式及起终点坐标时可复用服务端结果；更换模式、provider 或移动标记会使用新的缓存键。部署时需持久化 `SQLITE_PATH` 所在目录，Docker Compose 默认将 `/app/data` 挂载为 `mapannai_data` 卷。

### 2. 本地开发

```bash
npm install
npm run dev        # http://localhost:3000
npm run type-check # TypeScript 类型检查
```

### 3. Docker 部署

```bash
docker-compose up -d mapannai
docker-compose logs -f mapannai
```

SQLite 数据库持久化存储在 `mapannai_data` Docker Volume 中。

---

## MCP 接入（AI 助手操作地图）

MapAnNai 在 `/api/mcp` 暴露 MCP 服务器，支持 Streamable HTTP 的 AI 客户端均可接入。启用鉴权后，每次请求通过 `Authorization: Bearer <token>` Header 传递 token。

### 客户端配置

使用 `.mcp.json` 的客户端（如 Claude Code）可配置为：

```json
{
  "mcpServers": {
    "mapannai": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
```

开启鉴权（设置了 `API_TOKEN`）时：

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

远程部署时将 `localhost:3000` 替换为实际域名。

### 可用 MCP 工具

| 分类 | 工具 | 说明 |
|------|------|------|
| **旅行** | `create_trip` | 创建旅行，按日期自动生成每天行程 |
| | `list_trips` | 列出所有旅行 |
| | `get_trip_detail` | 获取旅行详情（含每天地点） |
| | `add_day_to_trip` | 为旅行手动新增一天 |
| | `delete_trip` | 删除旅行（不删除标记） |
| **行程规划** | `plan_trip_day` | ⭐ 批量创建地点并加入指定天，一步完成 |
| | `assign_marker_to_day` | 将已有标记加入某天 |
| | `reorder_day_markers` | 调整当天地点顺序 |
| | `create_day_chain` | 使用已有标记 ID 按顺序建链，不创建新地点 |
| **标记** | `create_marker` | 按地名创建标记 |
| | `list_markers` | 列出地图上所有标记 |
| | `update_marker` | 更新标记内容或图标 |
| | `delete_marker` | 删除标记 |
| **搜索** | `search_places` | 搜索地点（返回坐标） |
| | `get_place_details` | 获取地点详情（电话、评分、营业时间） |
| | `get_walking_directions` | 获取两点间步行路线 |

### 推荐工作流

```
1. create_trip("东京2024春", "2024-03-01", "2024-03-05")
   → 返回 trip.id 和 days[0..4].id

2. plan_trip_day(tripId, days[0].id, [
     { name: "新宿御苑",   iconType: "park" },
     { name: "东京塔",     iconType: "landmark" },
     { name: "筑地市场",   iconType: "food" }
   ])
   → 一步创建标记并加入第1天

3. 若地点已存在，调用 create_day_chain(tripId, dayId, markerIds)
   → 按已有标记 ID 建链，不重复创建地点

4. 按需为其他日期规划
```

连接后可调用 `workflow` prompt，让 AI 自动获取操作指南。

---

## 标记类型

| 图标 | 类型 | 说明 |
|------|------|------|
| 🎯 | `activity` | 活动和娱乐 |
| 📍 | `location` | 一般地点 |
| 🏨 | `hotel` | 住宿 |
| 🛍️ | `shopping` | 购物 |
| 🍜 | `food` | 美食 |
| 🌆 | `landmark` | 地标建筑 |
| 🎡 | `park` | 公园游乐 |
| 🗻 | `natural` | 自然景观 |
| ⛩️ | `culture` | 人文景观 |
| 🚉 | `transit` | 交通枢纽 |

---

## OSM 瓦片代理

默认通过同源路径 `/osm-tiles/{z}/{x}/{y}.png` 获取地图瓦片。在 nginx 或 CDN 中配置转发：

```nginx
location /osm-tiles/ {
    proxy_pass https://tile.openstreetmap.org/;
    proxy_set_header Host tile.openstreetmap.org;
    proxy_set_header User-Agent "MapAnNai/1.0 (your@email.com)";
    proxy_cache osm;
    proxy_cache_valid 200 30d;
    add_header Access-Control-Allow-Origin *;
}
```

如需直接从 OSM 获取瓦片（跳过代理）：

```env
NEXT_PUBLIC_OSM_TILE_PROXY=false
```
