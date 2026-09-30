# MapAnNai Plus — Interactive Travel Map Editor

English | [中文](README.zh.md)

A Next.js 14 travel planning platform. Create and manage location markers on an interactive map, organize them into trips and days, and let AI assistants (Claude Desktop, Cursor, etc.) operate the map directly via the built-in **MCP server**.

<img width="1481" height="918" alt="Clipboard_Screenshot_1774582478" src="https://github.com/user-attachments/assets/8cc1543e-1e5c-4f9b-93b8-66b72e73fce9" />


<img width="1481" height="918" alt="Clipboard_Screenshot_1774582430" src="https://github.com/user-attachments/assets/5e806e0e-86ff-4758-a85e-dae49e4afc8a" />

---

## Features

- **Interactive map** — Select MapLibre + OpenStreetMap or the official AMap JS API 2.0 at deployment. Click to add markers and edit their rich text notes.
- **Trip planning** — Organize markers by trip and day, build multiple ordered chains by dragging or with MCP, and choose curved association lines or walking/driving route shapes cached in the browser and on the server. Display geometry simplifies small traffic circles, rounds corners, and gently separates overlapping outbound/inbound paths within a day while preserving waypoint endpoints.
- **MCP server** — Any MCP-compatible AI client can create markers, plan itineraries, and query routes directly.
- **Place services** — Choose Google or AMap independently for search, place details, and walking/driving directions.
- **Viewport search** — The search box uses the visible map bounds with a 20% margin on each side. AMap searches that area and maps hotel/train-station category keywords to POI types; Google biases results toward the viewport center and radius. MCP place-name searches remain unscoped.
- **Image uploads** — Attach images to markers via Tencent Cloud COS.
- **PWA** — Installable as a Progressive Web App with offline tile caching. Mobile panels share enter/exit motion and day navigation responds immediately. Form dialogs follow the visible viewport when the keyboard opens; lists contain scrolling, and map animations pause in the background and respect reduced motion.
- **Optional auth** — Static token authentication; omit `API_TOKEN` for open access.

---

## Quick Start

### 1. Environment variables

```bash
cp env.example .env
# Edit .env before starting the app
```

The map renderer and the three place services are configured independently. `env.example` lists every setting and an all-AMap example. For an AMap deployment in China:

```env
MAP_RENDERER=amap
MAP_SEARCH_PROVIDER=amap
MAP_DETAILS_PROVIDER=amap
MAP_DIRECTIONS_PROVIDER=amap
AMAP_JS_KEY=your-amap-web-js-key
AMAP_JS_SECURITY_CODE=your-amap-js-security-code
AMAP_API_KEY=your-amap-web-service-key
```

Get `AMAP_JS_KEY` (Web JS API key) and its security code from the AMap console and configure your deployment domain there. `AMAP_API_KEY` must be a separate **Web Service** key. AMap place and route services cover China; use Google providers for other countries. The AMap JS key and security code are sent to the browser by the current implementation.

| Variable | Default / when needed | Purpose |
|----------|-----------------------|---------|
| `MAP_RENDERER` | `osm` | `osm` uses MapLibre + OSM tiles; `amap` uses AMap JS API 2.0. |
| `MAP_SEARCH_PROVIDER` | `google` | Search backend: `google` or `amap`. |
| `MAP_DETAILS_PROVIDER` | `google` | Place details backend: `google` or `amap`. |
| `MAP_DIRECTIONS_PROVIDER` | `google` | Walking/driving directions backend: `google` or `amap`. |
| `AMAP_JS_KEY`, `AMAP_JS_SECURITY_CODE` | Required for `MAP_RENDERER=amap` | AMap Web JS API credentials. |
| `AMAP_API_KEY` | Required for any AMap place service | AMap Web Service key. |
| `GOOGLE_API_KEY` | Required for any Google place service | Enable the corresponding Places, Geocoding, and Directions APIs. |
| `AMAP_API_BASE_URL`, `GOOGLE_API_BASE_URL` | Provider defaults | Optional API proxy base URLs; see `env.example`. |
| `NEXT_PUBLIC_OSM_TILE_PROXY` | `true` | Set `false` to fetch OSM tiles directly. Otherwise configure `/osm-tiles/` on your reverse proxy. |
| `SQLITE_PATH` | `./data/mapannai.db` | SQLite database file. |
| `API_TOKEN` | Empty | Optional API and MCP bearer token; empty means open access. |
| `TENCENT_COS_SECRET_ID`, `TENCENT_COS_SECRET_KEY`, `TENCENT_COS_REGION`, `TENCENT_COS_BUCKET` | Optional | Tencent COS image uploads. |
| `NEXT_PUBLIC_IMAGE_DOMAINS` | Optional | Allowed remote image hostnames; set before building. |

Restart or redeploy after changing server variables. Set `NEXT_PUBLIC_*` variables before building. Map coordinates are stored as WGS-84 and converted at the AMap boundary.

Directions are cached both in the browser and in SQLite's `direction_cache` table. Devices share cached routes when provider, mode, and endpoint coordinates match. Changing the mode, provider, or marker coordinates produces a new cache key. Persist the directory containing `SQLITE_PATH`; Docker Compose mounts `/app/data` in the `mapannai_data` volume by default.

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
| | `create_day_chain` | Connect existing marker IDs in order; does not create places |
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

3. For places already on the map, call create_day_chain(tripId, dayId, markerIds)
   → connects existing marker IDs without creating places

4. Repeat for each day
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

## OSM tile proxy

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

Routes and terminal AMap OVER_DIRECTION_RANGE and unsupported-region results persist in SQLite direction_cache, shared by Web and MCP. Range failures display a dashed Bézier association with no travel metrics and are not retried; changing endpoints, mode or provider uses a new cache key.

Route progress disappears after calculation completes; terminal coverage failures do not produce retry prompts.

Automatic route mode selects walking for endpoint straight-line distances below 2km and driving otherwise. The compact Auto toggle remembers the last manual mode; choosing Walking or Driving disables Auto. Cache keys use the resolved mode, sharing existing server and browser caches.

On each page launch, center the map at zoom 15 on the first valid stop of the first day of the nearest upcoming trip (including today), using chain order before day membership order without selecting a trip, day or marker. Use the local date, skip trips whose first day has no valid places, and retain the previous/default camera if no upcoming trip has places. Startup no longer restores a trip/day selection from the URL or sessionStorage.
