# MapAnNai Plus — 交互式旅行地图编辑器

[English](README.md) | 中文

基于 Next.js 14 的旅行规划平台。在交互式地图上创建和管理地点标记，按旅行和天组织行程，并通过内置 **MCP 服务器**让 AI 助手（Claude Desktop、Cursor 等）直接操作地图。

<img width="1481" height="918" alt="Clipboard_Screenshot_1774582478" src="https://github.com/user-attachments/assets/8cc1543e-1e5c-4f9b-93b8-66b72e73fce9" />

<img width="1481" height="918" alt="Clipboard_Screenshot_1774582430" src="https://github.com/user-attachments/assets/5e806e0e-86ff-4758-a85e-dae49e4afc8a" />

---

## 功能特点

- **交互式地图** — 基于 MapLibre GL + OpenStreetMap 瓦片。点击地图放置标记，使用富文本编辑器编写笔记。
- **行程规划** — 将标记组织到旅行和天中，支持拖拽排序，并以折线可视化路线。
- **MCP 服务器** — 任何支持 MCP 协议的 AI 客户端都可直接创建标记、规划行程、查询路线。
- **地点搜索** — 集成 Google Places，支持地点搜索、详情获取和步行路线规划。
- **图片上传** — 通过腾讯云 COS 为标记附加图片。
- **PWA** — 可作为渐进式 Web App 安装，支持离线瓦片缓存。
- **可选鉴权** — 静态 Token 认证；不设置 `API_TOKEN` 即为开放访问。

---

## 快速开始

### 1. 环境变量

```bash
cp env.example .env
# 编辑 .env，填入配置
```

| 变量 | 必填 | 说明 |
|------|------|------|
| `GOOGLE_API_KEY` | ✅ | Google Maps API Key，用于地点搜索和路线规划 |
| `GOOGLE_API_BASE_URL` | | Google API 地址，默认 `https://maps.googleapis.com`（国内可填反代地址） |
| `TENCENT_COS_SECRET_ID` | | 腾讯云 COS，图片上传必填 |
| `TENCENT_COS_SECRET_KEY` | | 腾讯云 COS |
| `TENCENT_COS_REGION` | | COS 地域，如 `ap-chongqing` |
| `TENCENT_COS_BUCKET` | | COS 存储桶名称 |
| `NEXT_PUBLIC_IMAGE_DOMAINS` | | 允许加载的图片域名（填你的 COS 域名） |
| `SQLITE_PATH` | | SQLite 数据库路径，默认 `./data/mapannai.db` |
| `API_TOKEN` | | 静态鉴权 Token，不填则关闭鉴权 |
| `NEXT_PUBLIC_OSM_TILE_PROXY` | | 设为 `false` 直接从 OSM 获取瓦片，不经过自托管代理 |

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

3. 重复步骤2为每天规划地点
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


