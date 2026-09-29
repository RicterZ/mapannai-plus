# MapAnNai Plus — Interactive Travel Map Editor

English | [中文](README.zh.md)

A Next.js 14 travel planning platform. Create and manage location markers on an interactive map, organize them into trips and days, and let AI assistants (Claude Desktop, Cursor, etc.) operate the map directly via the built-in **MCP server**.

<img width="1481" height="918" alt="Clipboard_Screenshot_1774582478" src="https://github.com/user-attachments/assets/8cc1543e-1e5c-4f9b-93b8-66b72e73fce9" />


<img width="1481" height="918" alt="Clipboard_Screenshot_1774582430" src="https://github.com/user-attachments/assets/5e806e0e-86ff-4758-a85e-dae49e4afc8a" />

---

## Features

- **Interactive map** — Powered by MapLibre GL + OpenStreetMap tiles. Click to drop markers, edit with a rich markdown editor.
- **Trip planning** — Organize markers into trips and days, with drag-and-drop reordering and polyline route visualization.
- **MCP server** — Any MCP-compatible AI client can create markers, plan itineraries, and query routes directly.
- **Place search** — Google Places integration for place search, details, and walking directions.
- **Image uploads** — Attach images to markers via Tencent Cloud COS.
- **PWA** — Installable as a Progressive Web App with offline tile caching.
- **Optional auth** — Static token authentication; omit `API_TOKEN` for open access.

---

## Quick Start

### 1. Environment Variables

```bash
cp env.example .env
# Edit .env and fill in your values
```

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_API_KEY` | ✅ | Google Maps API key — used for place search and routing |
| `GOOGLE_API_BASE_URL` | | Google API base URL. Default: `https://maps.googleapis.com` (set a reverse proxy for mainland China) |
| `TENCENT_COS_SECRET_ID` | | Tencent Cloud COS — required for image uploads |
| `TENCENT_COS_SECRET_KEY` | | Tencent Cloud COS |
| `TENCENT_COS_REGION` | | COS region, e.g. `ap-chongqing` |
| `TENCENT_COS_BUCKET` | | COS bucket name |
| `NEXT_PUBLIC_IMAGE_DOMAINS` | | Allowed image domains (your COS domain) |
| `SQLITE_PATH` | | SQLite database path. Default: `./data/mapannai.db` |
| `API_TOKEN` | | Static auth token. Omit to disable authentication |
| `NEXT_PUBLIC_OSM_TILE_PROXY` | | Set `false` to fetch OSM tiles directly instead of through the self-hosted proxy |

### 2. Local Development

```bash
npm install
npm run dev        # http://localhost:3000
npm run type-check # TypeScript check
```

### 3. Docker

```bash
docker-compose up -d mapannai
docker-compose logs -f mapannai
```

The SQLite database is persisted to the `mapannai_data` Docker volume.

---

## MCP Integration

MapAnNai exposes an MCP server at `/api/mcp`. AI clients supporting Streamable HTTP can connect and operate the map. Authentication uses the `Authorization: Bearer <token>` header on every request.

### Client configuration

For clients using `.mcp.json` (such as Claude Code):

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

With authentication (`API_TOKEN` set):

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

Replace `localhost:3000` with your domain for remote deployments.

### Available MCP Tools

| Category | Tool | Description |
|----------|------|-------------|
| **Trips** | `create_trip` | Create a trip with auto-generated days |
| | `list_trips` | List all trips |
| | `get_trip_detail` | Get trip details including all days and markers |
| | `add_day_to_trip` | Add a day to an existing trip |
| | `delete_trip` | Delete a trip (markers are kept) |
| **Planning** | `plan_trip_day` | ⭐ Batch-create places and add them to a day in one step |
| | `assign_marker_to_day` | Assign an existing marker to a day |
| | `reorder_day_markers` | Reorder markers within a day |
| **Markers** | `create_marker` | Create a marker by place name |
| | `list_markers` | List all markers on the map |
| | `update_marker` | Update marker content or icon |
| | `delete_marker` | Delete a marker |
| **Search** | `search_places` | Search for places (returns coordinates) |
| | `get_place_details` | Get place details (phone, rating, hours) |
| | `get_walking_directions` | Get walking directions between two points |

### Recommended Workflow

```
1. create_trip("Tokyo Spring 2024", "2024-03-01", "2024-03-05")
   → returns trip.id and days[0..4].id

2. plan_trip_day(tripId, days[0].id, [
     { name: "Shinjuku Gyoen", iconType: "park" },
     { name: "Tokyo Tower",    iconType: "landmark" },
     { name: "Tsukiji Market", iconType: "food" }
   ])
   → creates markers and adds them to day 1 in one call

3. Repeat step 2 for each day
```

After connecting, invoke the `workflow` prompt to have the AI automatically retrieve usage guidance.

---

## Marker Icon Types

| Icon | Type | Description |
|------|------|-------------|
| 🎯 | `activity` | Activities & entertainment |
| 📍 | `location` | General locations |
| 🏨 | `hotel` | Accommodation |
| 🛍️ | `shopping` | Shopping |
| 🍜 | `food` | Food & dining |
| 🌆 | `landmark` | Landmarks & buildings |
| 🎡 | `park` | Parks & amusement |
| 🗻 | `natural` | Natural scenery |
| ⛩️ | `culture` | Cultural & heritage sites |
| 🚉 | `transit` | Transit hubs |

---

## OSM Tile Proxy

By default, map tiles are fetched through the same origin at `/osm-tiles/{z}/{x}/{y}.png`. Configure your nginx or CDN to forward this path to `https://tile.openstreetmap.org/`:

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

To skip the proxy and fetch tiles directly from OSM:

```env
NEXT_PUBLIC_OSM_TILE_PROXY=false
```




## 可切换的地图服务

地图右上角的「地图设置」可独立选择底图（OpenStreetMap / 高德）、地点搜索、地点详情和路线规划（Google / 高德）。选择保存在当前浏览器中。数据库坐标统一为 WGS-84，高德服务和瓦片所需的 GCJ-02 在边界转换。

高德底图直接使用高德公开瓦片地址；地点服务需要在服务端设置 `AMAP_API_KEY`（高德开放平台的 Web 服务 Key）。可通过 `MAP_SEARCH_PROVIDER`、`MAP_DETAILS_PROVIDER`、`MAP_DIRECTIONS_PROVIDER` 分别设置服务端默认值，网页初始选择由对应的 `NEXT_PUBLIC_MAP_*_PROVIDER` 指定。完整变量示例见 `env.example`。高德地点和路线服务限中国，海外建议使用 Google；`search_places`、`get_place_details`、`get_walking_directions` MCP 工具可传 `provider` 单独覆盖默认值。
