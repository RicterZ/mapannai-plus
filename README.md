# MapAnNai Plus（マップ案内）

English | [中文](README.zh.md) · [iOS client](https://github.com/RicterZ/mapannai-ios)

**Pin the places you want to go. Shape them into a trip, one day at a time.**

A café someone mentioned, an alley from a travel blog, a viewpoint you saw in a photo — drop them on the map first. Once the dates are set, sort them into days, put them in order, and note when to leave and which train to catch. On the road, your phone opens the same itinerary.

MapAnNai Plus is self-hosted, so your data stays on your own server. The web app, the iPhone / iPad client and AI assistants all work on the same trips.

<img width="1481" height="918" alt="Map and trip overview" src="https://github.com/user-attachments/assets/8cc1543e-1e5c-4f9b-93b8-66b72e73fce9" />

## What you can do

### Collect first, plan later

Search, or tap anywhere on the map, to save restaurants, hotels, sights and stations. Give each place a cover photo, a category icon and rich notes — opening hours, the dish to order, what your friend actually said.

### Arrange it day by day

A trip can span several destinations. Places you haven't scheduled wait in the trip until you drag them onto a day. Each day can hold several routes you reorder by dragging, and one place can show up on different days and routes.

The trip sidebar shows every route stop in order, with saved visit times, transport services and departure times. Open a day to read the full arrangements beside the map.

Add an arrival time and how long you'll stay at each stop. Between stops, note the subway or taxi, the line number or the flight. Move the start date and the whole trip shifts with it.

### See the day on the map

Every day gets its own color. Tap a place or a route and the sidebar jumps to that part of the plan. Turn on route planning to see roughly how far each leg is.

The lines show *this first, then that* — not turn-by-turn directions. They help you see the shape of a day; when you head out, use whichever navigation app you like.

<img width="1481" height="918" alt="Daily places and route editing" src="https://github.com/user-attachments/assets/5e806e0e-86ff-4758-a85e-dae49e4afc8a" />

### Plan it with M-chan

Rather not start from a blank page? Open AI planning and tell M-chan where you're going, which days, what you like and what's already booked. She asks one thing at a time, lets you pick dates and preferences on cards, then drafts the trip day by day. Nothing is saved to your map until you approve; later, just tell her which day to change.

Send her screenshots and photos — long travel guides, menus, tickets (with a vision-capable model) — or let her search the web. Cards wait for your answer instead of deciding on a countdown, and if you refresh or lose connection, you can pick up where you left off.

### Take it with you

Works in desktop and mobile browsers and can be added to your home screen. The native [iPhone / iPad client](https://github.com/RicterZ/mapannai-ios) reads the same data, and MCP-capable assistants such as Claude or Cursor can read and edit your trips too.

Train connections can follow OpenStreetMap railway geometry; this does not provide timetable or transfer planning.

## Up and running in three steps

**1. Configure.** Create a `.env` on your server:

```dotenv
MAP_RENDERER=amap                       # AMap inside China, Google elsewhere
AMAP_API_KEY=your-amap-web-service-key
AMAP_JS_KEY=your-amap-js-key
AMAP_JS_SECURITY_CODE=your-matching-js-security-code
GOOGLE_API_KEY=your-google-server-key
GOOGLE_JS_KEY=your-google-browser-key
API_TOKEN=replace-with-a-long-random-token
```

See [Map keys](#map-keys) for where to get each key. `API_TOKEN` is a passphrase you make up, shared by web, iOS and MCP; always set it on a public server.

**2. Start.**

```bash
docker run -d --name mapannai --restart unless-stopped \
  -p 3000:3000 --env-file .env \
  -v mapannai_data:/app/data \
  ghcr.io/ricterz/mapannai-plus:latest
```

**3. Open `http://localhost:3000`.** Put it behind HTTPS for remote access. The web app and the AI service ship in the same image; no extra ports needed.

For AI planning, enter your model service's URL, key and model name in the web app's AI settings. Any OpenAI-compatible Chat Completions service with tool calling works.

> Places, trips and AI records live in the `mapannai_data` volume. Back it up before updating, and **never run `docker compose down -v`** — it deletes the volume.

## Map keys

`MAP_RENDERER=amap` is recommended: AMap is used while the map is centered in China, switching to Google abroad. Search and routing pick a provider by region too, falling back to Google when AMap has no result. In practice you'll want keys from both.

| You want | Set | Get it from |
| --- | --- | --- |
| Place search and routes in China | `AMAP_API_KEY` | AMap console, **Web Service** platform |
| Basemap in China | `AMAP_JS_KEY` + `AMAP_JS_SECURITY_CODE` | AMap console, **Web (JS API)** platform; the pair must match |
| Place search and routes abroad | `GOOGLE_API_KEY` | Google Cloud: Places, Geocoding, Directions |
| Basemap abroad | `GOOGLE_JS_KEY` | Google Cloud: Maps JavaScript API |

<details>
<summary>Google Maps Platform in detail</summary>

Create a project in [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/overview), attach billing, and set API restrictions per key. **Use separate server, browser and iOS keys** — their application restrictions aren't interchangeable.

| Purpose | Configuration | APIs to enable | Key restrictions |
| --- | --- | --- | --- |
| Server place search and details, destinations, address lookup, route planning (shared by web and iOS) | `.env`: `GOOGLE_API_KEY` | **Places API (Legacy)**, **Geocoding API**, **Directions API (Legacy)** | Optionally restrict to server egress IPs; no website or iOS restriction |
| Web basemap abroad | `.env`: `GOOGLE_JS_KEY` | **Maps JavaScript API** | HTTP referrers for your domain; allow localhost separately for development |
| Native Google basemap on iOS | iOS repo `Config/Local.xcconfig`: `GOOGLE_MAPS_IOS_KEY` | **Maps SDK for iOS** | iOS app restriction matching the final Bundle ID |

**The server uses the legacy Places and Directions endpoints; enabling only Places API (New) or Routes API is not enough.** Google limits legacy API activation for new projects — if the console won't enable them, check the project's eligibility; a new key won't help.

If `GOOGLE_JS_KEY` is empty, the browser reuses `GOOGLE_API_KEY`, which is then exposed client-side and must also allow Maps JavaScript API. Don't reuse a key restricted to server IPs.

</details>

<details>
<summary>AMap in detail</summary>

Create an application in the [AMap console](https://console.amap.com/) and request a key per platform. AMap isn't a list of API checkboxes: what matters is **the right platform type, with the needed service permissions and quota**. Keys from different platforms can't substitute for each other.

| Purpose | Configuration | Platform and capabilities | Notes |
| --- | --- | --- | --- |
| Server place search and details, destinations, address lookup, route planning in China (shared by web and iOS) | `.env`: `AMAP_API_KEY` | **Web Service**: POI search (text, polygon, details), geocoding / reverse geocoding, walking / driving / cycling / transit directions | Use server egress IPs if you set an allowlist |
| Web basemap in China | `.env`: `AMAP_JS_KEY` and `AMAP_JS_SECURITY_CODE` | **Web (JS API)**, JS API 2.0 | Allowlist your domain; the security code must match the JS key, and both reach the browser |
| Native AMap basemap on iOS | iOS repo `Config/Local.xcconfig`: `AMAP_IOS_KEY` | **iOS** platform | Bind to the final signed Bundle ID; re-signing (e.g. AltStore) may change it |

iOS search and routing go through the server, so an iOS SDK key alone isn't enough.

</details>

<details>
<summary>What the iOS client needs</summary>

- With a prebuilt client, just enter your server URL and `API_TOKEN` in the app's settings — no map keys.
- When building the app yourself, native map keys go in the iOS repo's `Config/Local.xcconfig`, not this server's `.env`. See the [iOS client](https://github.com/RicterZ/mapannai-ios).
- Apple Maps needs no Google / AMap basemap key; search and routing still rely on the map services configured on your server.

</details>

## Optional features

| For | Configure |
| --- | --- |
| Place photos and image input for AI | Tencent Cloud COS: `TENCENT_COS_SECRET_ID`, `TENCENT_COS_SECRET_KEY`, `TENCENT_COS_REGION`, `TENCENT_COS_BUCKET`. Prefer a subaccount scoped to the bucket; configure bucket CORS to allow PUT uploads from your site, and keep images readable by browsers and models |
| AI web search | `BRAVE_API_KEY` (Brave Search API) |
| AI page reading | `FIRECRAWL_API_KEY` (Firecrawl) |

Every variable is documented in [env.example](env.example). Maps, AI, storage and web services may each bill separately. Browser keys ship with the web app, so restrict them by platform; keep server keys and secrets out of the repository.

<details>
<summary>Other ways to deploy</summary>

**Docker Compose (GHCR image)**

```bash
docker compose -f docker-compose.ghcr.yml up -d
# Update
docker compose -f docker-compose.ghcr.yml pull && docker compose -f docker-compose.ghcr.yml up -d
```

Defaults to `latest`; set `MAPANNAI_IMAGE=ghcr.io/ricterz/mapannai-plus:<version>` in `.env` to pin a published version.

**Build from source**

```bash
git clone https://github.com/RicterZ/mapannai-plus.git && cd mapannai-plus
cp env.example .env
docker compose up -d --build mapannai
```

**Publish your own image**

Run **Actions → Publish container image → Run workflow**, or publish a Release. Images go to `ghcr.io/<owner>/<repository>` for `linux/amd64` and `linux/arm64`, using the built-in `GITHUB_TOKEN`. Stable releases get a version tag and `latest`; prereleases don't replace `latest`; manual builds on the default branch get `edge` and a commit SHA tag. Check package visibility in GitHub Packages after the first publish.

`NEXT_PUBLIC_IMAGE_DOMAINS` is a build-time setting: to customize image domains, set it as an Actions repository variable and build your own image, or build from source.

**OSM basemap**

`MAP_RENDERER=osm` uses OpenStreetMap tiles with no map key, though search and routing still need the server keys above. (OSM is also the default when unset, so write `amap` explicitly for AMap / Google.) Tiles load through same-origin `/osm-tiles/`, which needs a reverse-proxy rule:

```nginx
location /osm-tiles/ {
    proxy_pass https://tile.openstreetmap.org/;
    proxy_set_header Host tile.openstreetmap.org;
    proxy_set_header User-Agent "MapAnNai/1.0 (your-contact-email)";
}
```

Use your own contact email and follow the tile usage policy. For local Node runs, set `NEXT_PUBLIC_OSM_TILE_PROXY=false` before building to load tiles directly.

</details>

## Connect another AI assistant

Add this to an MCP client that supports **Streamable HTTP**:

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

Drop `headers` if `API_TOKEN` is unset. The assistant can then search and save places, create trips, and arrange each day's routes and transport — changes show up on web and iOS.

## Privacy

- Conversations and model settings stay in your browser and don't sync across devices. "Remember key" stores the key in plain text in the browser.
- When you chat, the conversation, relevant itinerary details and image links go to the model service you configured.
- The server keeps AI results and tool records so runs can resume after a disconnect; diagnostic logging, when enabled, also records conversation content. Treat the database and backups as private data.

## Local development

Requires Node.js 22 and npm; see [env.example](env.example) for configuration.

```bash
npm ci
npm run dev           # web app, http://localhost:3000 by default
npm run agent:start   # in another terminal; needed for web AI
```

Before committing:

```bash
npm run type-check
npm run build
git diff --check
```

Don't run the dev server and a build in the same directory at once. If SQLite errors after switching Node versions, run `npm rebuild better-sqlite3`. See [Agent service](docs/agent-service.md) for the AI service and web tools, and [AGENTS.md](AGENTS.md) for development conventions.

Desktop trip and day maps show floating itinerary cards linked to their locations. Fit the itinerary or hide the cards from the map controls; zoom in to reveal cards omitted to prevent overlap.

Trip and day maps keep itinerary lines visible when zoomed out. Compact map annotations use available space, while full-width daily timelines leave more room for place names and transport notes.
