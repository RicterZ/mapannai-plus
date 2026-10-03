# MapAnNai Plus（マップ案内）

English | [中文](README.zh.md) · [iOS client](https://github.com/RicterZ/mapannai-ios)

Put the places you want to visit on a map, then turn them into a day-by-day travel plan.

MapAnNai Plus is a self-hosted place collection and travel itinerary editor. Save restaurants, hotels, sights, and transit stops, add notes and photos, arrange visits by trip and day, or ask an AI assistant to help plan. The web app, iOS client, and MCP share the places and trips stored on your server.

## Features

- **Save places and travel notes**: Add places by clicking the map or searching. Use ten icon categories for food, accommodation, shopping, sights, and more. Rich text notes support lists, links, and images.
- **Plan each day**: Create a trip with automatically generated days, shift its dates, add or remove days, and reuse saved places across your itinerary. When deleting a trip or day, optionally remove places belonging to only one trip and one day; places shared across trips or days are kept.
- **Arrange visits your way**: Save places to a trip before choosing a date, then drag them onto a day when ready. Create multiple routes within a day and drag places to change their visit order. A place can belong to several routes.
- **See the whole plan on a map**: Switch between all places, a trip overview, and individual days. Colors distinguish days; selecting a place or route brings up its itinerary.
- **Choose how routes look**: Connect places with curves or enable road-following walking and driving routes. Automatic mode chooses walking or driving for each segment by distance; planned segment distances appear between places. Lines show place relationships and visit order; a place's external navigation action opens directions separately.
- **Search the area you are viewing**: Results appear in both the list and on the map. Save the places you choose to your collection.
- **Plan with an AI assistant**: Configure your AI API in the web app and use multi-turn chat to create trips, find places, and arrange routes, with conversation history saved in the current browser. You can also connect an external assistant through MCP to edit the same itineraries, including changing existing routes and deleting routes while keeping their places. AI tools can also save visit times, planned durations, transport modes, dedicated line/service numbers, and notes; these details appear in daily routes and can be changed in edit mode, with transport information shown separately from place cards.
- **Use it across devices**: The web app works on desktop and mobile and can be installed as a PWA. A [native iOS client](https://github.com/RicterZ/mapannai-ios) is also available; see its repository for installation and setup.
- **Keep your data on your server**: Places, trips, and route caches are stored locally on the server. Access can be protected with a token; image uploads optionally use Tencent Cloud COS.

<img width="1481" height="918" alt="Map and trip overview" src="https://github.com/user-attachments/assets/8cc1543e-1e5c-4f9b-93b8-66b72e73fce9" />

<img width="1481" height="918" alt="Daily places and route editing" src="https://github.com/user-attachments/assets/5e806e0e-86ff-4758-a85e-dae49e4afc8a" />

## Plan your first trip

1. Search or click the map to save places, with icons, notes, and photos.
2. Create a trip, choose its dates, and add saved places to each day.
3. Build one or more routes for a day and drag places into visit order.
4. Review the trip on the map and open it on your phone while traveling.

To get help from AI, open **AI 规划** in the top-right corner of the web app and configure your API, or connect the MCP service below, then describe your destination, dates, and preferences. For example: “Plan three days in Tokyo with food and parks, prioritizing places I have already saved.”

## Deploy your own server

### 1. Get the project and choose map services

```bash
git clone https://github.com/RicterZ/mapannai-public.git
cd mapannai-public
cp env.example .env
```

Edit `.env`. The basemap, search, place details, and directions services can be chosen independently. See [env.example](env.example) for all settings.

| Use case | Basemap | Search / details / directions | Required configuration |
| --- | --- | --- | --- |
| AMap services in China | `MAP_RENDERER=amap` | Set all three providers to `amap` | AMap Web JS key, matching security code, and a separate Web Service key |
| Google services for overseas places | `MAP_RENDERER=osm` | Set all three providers to `google` | Google API key with the relevant Places, Geocoding, and Directions APIs enabled; configure OSM tile access |

Example using AMap for all services:

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

Use a matching AMap JS key and security code, and configure the deployment domain in the provider console. Obtain the backend Web Service key separately. For Google services, fill in `GOOGLE_API_KEY`. The OSM basemap and manually added places work without a map service key; search, details, and road routes require the relevant service credentials.

When `API_TOKEN` is set, the web app asks for it on first access, and iOS and MCP use the same token. If left empty, anyone who can reach the service can modify its data. For image uploads, configure `TENCENT_COS_*`, the bucket's upload CORS rules, and `NEXT_PUBLIC_IMAGE_DOMAINS`.

### 2. Start with Docker Compose

With Docker and Compose installed, run from the project directory:

```bash
docker compose up -d --build mapannai
docker compose logs -f mapannai
```

After configuring AMap, open `http://localhost:3000`. For remote deployments, use the server address or configure an HTTPS domain through a reverse proxy. To update:

```bash
git pull
docker compose up -d --build mapannai
```

Compose stores `/app/data` in the `mapannai_data` named volume, including places, trips, and route caches. Keep and back up this volume when updating; `docker compose down -v` deletes it. If you customize `SQLITE_PATH`, point it to a persistent mounted directory.

### 3. Configure the OSM basemap

By default, OSM tiles load from the same-origin path `/osm-tiles/{z}/{x}/{y}.png`, which requires a reverse proxy in front of the app. Add this rule to an existing Nginx `server` block alongside the rule forwarding application requests to port 3000:

```nginx
location /osm-tiles/ {
    proxy_pass https://tile.openstreetmap.org/;
    proxy_set_header Host tile.openstreetmap.org;
    proxy_set_header User-Agent "MapAnNai/1.0 (your-contact-email)";
}
```

Replace the contact email with your own. Accessing the application's port 3000 directly bypasses this proxy rule.

For local development or a direct Node build, set `NEXT_PUBLIC_OSM_TILE_PROXY=false` in `.env` to load OSM tiles directly in the browser. `NEXT_PUBLIC_*` settings take effect at build time. The current Docker build forwards only `NEXT_PUBLIC_IMAGE_DOMAINS`; disabling the tile proxy in Docker also requires adding the corresponding build argument to both the Dockerfile and Compose, then rebuilding.

Restart the service after changing server settings; rebuild after changing `NEXT_PUBLIC_*` settings.

## Plan with AI in the web app

Open **AI 规划** in the top-right corner and enter your API URL, API key, and model name in settings. The integration supports OpenAI-compatible **Chat Completions** APIs with function tools. Enter either an API base URL such as `https://your-api.example/v1` or the full `/chat/completions` endpoint. Services offering only Responses, Anthropic Messages, or other protocols need a compatible gateway.

The assistant goes by **M酱**, and chats like an upbeat travel companion, without emoji and with occasional kaomoji.

Discuss your preferences first, then ask the assistant to create or edit your itinerary. It reuses this server's MCP tools to search and save places, create trips, and arrange routes; changes refresh on the map. Create, switch, or delete conversations. Deleting a conversation keeps saved trips and places.

Each conversation keeps its own context. Requests include the current trip list and IDs so the assistant can use them without repeatedly listing trips. AI replies render Markdown with compact headings. Newly created places automatically come into view on the map. You can keep the chat panel open while interacting with the map.

Conversations, API URL, and model settings stay in the current browser and do not sync across devices. The key stays in the current page by default; selecting the remember-key option stores it as plain text locally. Each request sends the current conversation, relevant itinerary tool results, and key through this server to your configured AI service. This server does not store keys or conversations in its database.

Only public HTTPS endpoints are allowed by default. To use a private network or HTTP endpoint for a self-hosted model, the deployment owner can set `AI_ALLOW_PRIVATE_ENDPOINTS=true` in `.env` and restart. The endpoint must be reachable from the application server; inside Docker, `localhost` refers to the container itself.

Stopping a reply does not undo saved itinerary changes, and an executing tool may still complete. Check the map before continuing after stopping or losing the connection.

## Connect an external AI assistant

Add `https://your-domain/api/mcp` to an MCP client supporting **Streamable HTTP**, or use `http://localhost:3000/api/mcp` locally. With authentication enabled, set the request header `Authorization: Bearer YOUR_TOKEN`.

For clients using the `mcpServers` configuration format:

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

Remove `headers` if `API_TOKEN` is unset. Follow your client's settings for its exact configuration format.

Once connected, your assistant can search and save places, create trips, organize daily visits, and build routes from existing places. Clients supporting prompts can read `workflow` for the operating guide. Include a city in place names and specify the country for overseas searches; ask the assistant to confirm search results before saving the itinerary.

## Local development

Use Node.js 20 and npm. From the project directory:

```bash
cp env.example .env
npm ci
```

Edit `.env` to configure map services. If you use the default OSM basemap without a tile reverse proxy, set `NEXT_PUBLIC_OSM_TILE_PROXY=false`, then start:

```bash
npm run dev
```

Open `http://localhost:3000`. For another port, run `npm run dev -- --port 3101`. The database is created automatically at `./data/mapannai.db` on first use.

Common checks and production commands:

```bash
npm run type-check
npm run build
npm start
git diff --check
```

Stop the development server in the same directory before building to avoid conflicts in `.next`. `npm start` serves a completed build; this is also an option for running without Docker, with the `data` directory persisted. If changing Node versions causes a SQLite native dependency ABI error, run `npm rebuild better-sqlite3`.

The project uses Next.js, React, TypeScript, and SQLite. See [AGENTS.md](AGENTS.md) for development conventions, source responsibilities, and validation requirements. Environment settings are maintained in [env.example](env.example).
