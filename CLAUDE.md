# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MapAnNai Plus** (マップ案内) is a Next.js 14 interactive map editor with MCP-powered trip planning. Users create and manage location markers on a map, edit them with markdown content, and plan trips via external AI assistants (e.g. Claude Desktop) using the built-in MCP server.

## Commands

```bash
npm run dev          # Start dev server on port 3000
npm run build        # Production build (standalone output)
npm start            # Run production server
npm run type-check   # TypeScript check without emit
```

There is no test framework configured in this project. ESLint is not yet configured (running `npm run lint` will trigger interactive setup).

Docker:
```bash
docker-compose up -d mapannai    # Start production container
docker-compose logs -f mapannai  # View logs
```

## Architecture

### Data Flow

**Frontend** → Zustand store (`src/store/map-store.ts`) → **Next.js API routes** (`src/app/api/`) → **Service layer** (`src/lib/`) → External APIs (MapLibre GL, Google, Tencent COS)

**External AI** → MCP Client → `POST /api/mcp` → **MCP Server** (`src/lib/mcp/server.ts`) → Service layer

### Key Layers

**State Management** — A single Zustand store (`src/store/map-store.ts`) holds all markers, UI state (sidebar open/closed, selected marker, active chains), trip data, and active view state (`ActiveView`).

**Map Rendering** — The frontend uses `react-map-gl/maplibre`. The tile URL is constructed in `src/components/map/abstract-map.tsx` and defaults to the self-hosted reverse proxy path `/osm-tiles/{z}/{x}/{y}.png` (nginx/CDN proxies `tile.openstreetmap.org`). Set `NEXT_PUBLIC_OSM_TILE_PROXY=false` to bypass the proxy and fetch tiles directly from the official OSM server. The provider abstraction in `src/lib/map/providers/` now only exposes `GoogleServerProvider` (backend-only, for place search) via `MapProviderFactoryImpl`.

**MCP Server** — Lives in `src/lib/mcp/`. Each request gets a fresh `McpServer` instance (via `createMcpServer()` factory) because McpServer binds 1:1 with a transport:
- `server.ts` — factory with all tools registered + `workflow` prompt
- `tools/marker-tools.ts` — `list_markers`, `create_marker`, `update_marker`, `delete_marker`
- `tools/search-tools.ts` — `search_places`, `get_place_details`, `get_walking_directions`
- `tools/trip-tools.ts` — `list_trips`, `get_trip_detail`, `create_trip`, `add_day_to_trip`, `assign_marker_to_day`, `plan_trip_day`, `reorder_day_markers`, `delete_trip`

The MCP endpoint is at `src/app/api/mcp/route.ts` using `WebStandardStreamableHTTPServerTransport` (stateless mode — one transport instance per request). Tools call the service layer directly without going through HTTP.

**Marker Storage** — Markers are stored in a local **SQLite** database (`./data/mapannai.db`) via `src/lib/db/marker-service.ts`. The API routes at `src/app/api/markers/` handle CRUD; `v2/route.ts` creates markers by place name — it calls the Google provider service layer directly (no internal HTTP) to resolve coordinates, then upserts. Deduplication uses a coordinate MD5 hash as feature ID (`coord_<hash>`), with a 10m radius fallback check.

**Trip Management** — Structured trip planning with `Trip` and `TripDay` entities stored in SQLite via `src/lib/db/trip-service.ts`. Types defined in `src/types/trip.ts`. API routes at `src/app/api/trips/`. The active view state (`ActiveView` with modes `overview` / `trip` / `day`) controls which trip/day is displayed in the UI.

**Trip Chains** — Ordered sequences of markers stored as `chains: string[][]` on `TripDay`. Visualized as polylines by `src/components/map/connection-lines.tsx`.

**Image Upload** — Direct upload to Tencent COS via `src/lib/upload/direct-upload.ts` and `src/app/api/upload/route.ts`.

**Authentication** — Optional static token auth via `src/middleware.ts`. Set `API_TOKEN` env var to enable; omit to skip (backwards-compatible). Token is read from headers in priority order: `Authorization: Bearer <token>` (frontend and MCP clients), then `x-api-token` (server-side HTTP calls). Every MCP POST is authenticated; query tokens are not accepted. Frontend stores the token in `localStorage` via `src/lib/auth.ts` and injects it automatically through `src/lib/fetch-with-auth.ts`. On first load or after a 401, `src/components/auth/auth-modal.tsx` prompts the user to enter the token.

### MCP Integration

MCP client `.mcp.json` config (no auth):
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

MCP client `.mcp.json` config (with `API_TOKEN` set):
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

Available MCP tools:
- **Markers**: `list_markers`, `create_marker`, `update_marker`, `delete_marker`
- **Search**: `search_places`, `get_place_details`, `get_walking_directions`
- **Trips**: `list_trips`, `get_trip_detail`, `create_trip`, `add_day_to_trip`, `assign_marker_to_day`, `plan_trip_day`, `reorder_day_markers`, `delete_trip`

Recommended workflow: `create_trip` → `plan_trip_day` (批量创建地点并加入某天，自动生成行程链)

### Configuration

- `src/lib/config.ts` — Zoom levels, Google API config reading from env vars
- `src/types/marker.ts` — Marker type definitions and 10 emoji-based icon categories (`MarkerIconType`): `activity` 🎯, `location` 📍, `hotel` 🏨, `shopping` 🛍️, `food` 🍜, `landmark` 🌆, `park` 🎡, `natural` 🗻, `culture` ⛩️, `transit` 🚉
- `src/types/trip.ts` — `Trip`, `TripDay`, `ActiveView` type definitions
- `env.example` — All environment variables (Google API key, Tencent COS credentials, optional `API_TOKEN`, optional `NEXT_PUBLIC_OSM_TILE_PROXY`)
- TypeScript path alias: `@/*` maps to `src/*`

### OSM Tile Proxy

By default the app proxies OSM tiles through the same origin (`/osm-tiles/…`). Configure your nginx or CDN to forward `/osm-tiles/` → `https://tile.openstreetmap.org/`:

```nginx
location /osm-tiles/ {
    proxy_pass https://tile.openstreetmap.org/;

    proxy_ssl_server_name on;
    proxy_ssl_name tile.openstreetmap.org;

    proxy_set_header Host tile.openstreetmap.org;
    proxy_set_header User-Agent "MapAnNai/1.0 (your@email.com)";

    proxy_cache osm;
    proxy_cache_valid 200 30d;
    proxy_cache_use_stale error timeout updating;

    add_header X-Cache-Status $upstream_cache_status;
    add_header Access-Control-Allow-Origin *;

    expires 30d;
}
```

To skip the proxy and hit OSM directly, set:

```env
NEXT_PUBLIC_OSM_TILE_PROXY=false
```

### External API Integrations

| Service | Used For | Key File |
|---------|----------|----------|
| MapLibre GL (react-map-gl) | Map rendering (frontend) | `src/components/map/abstract-map.tsx` |
| SQLite (better-sqlite3) | Marker + Trip storage | `src/lib/db/` |
| Google Places | Place search + details | `src/lib/api/search-service.ts` |
| Google Directions | Route planning | `src/lib/api/google-directions-service.ts` |
| Tencent COS | Image storage | `src/lib/cos-client.ts` |
