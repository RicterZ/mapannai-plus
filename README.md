# MapAnNai Plus（マップ案内）

English | [中文](README.zh.md) · [iOS client](https://github.com/RicterZ/mapannai-ios)

Put the places you want to visit on a map, then turn them into a day-by-day travel plan.

MapAnNai Plus is a self-hosted place collection and travel planning tool. The web app and iOS client share your trips, from planning at home to checking the next stop on the road.

## Features

- **Collect places and notes**: Search or select a point on the map to save restaurants, hotels, sights and stations, with category icons, cover photos and rich text notes.
- **Organize trips by day**: Choose multiple destinations, keep places in a trip until you decide which day to visit, shift dates, add or remove days, and reuse places across trips.
- **Arrange visits freely**: Create multiple routes per day and drag visits into order. Places can remain outside routes or appear in more than one route. When deleting a trip or day, optionally delete places no longer used by other itineraries.
- **Read each day clearly**: Browse trips by year and preview routes in daily chapters. Daily details follow visit order, with notes and transport between stops, and planned times and durations alongside each visit.
- **Explore your plan on the map**: Distinct daily colors and linked place and route selections keep the map and itinerary together. Enable route planning to see segment distances. Lines express connections and visit order, not turn-by-turn navigation.
- **Keep visit and transport arrangements**: Record visit times, durations and notes, plus transport modes, line or service numbers, departure times and planned travel durations.
- **Plan with AI**: Describe your destination, dates and preferences. Answer follow-up questions, review a draft and confirm before saving, or ask for changes to an existing trip. Choose dates and options in chat and review the saved itinerary by day.
- **Bring images into the conversation**: Upload or paste photos and screenshots for a vision-capable model. Optional web search and page reading help gather travel information.
- **Keep planning through interruptions**: Use the map while AI works, and retrieve results after refreshing or a brief disconnection. Questions wait for your response rather than deciding for you on a countdown.
- **Use your trips across devices**: Desktop and mobile web, home-screen installation, and a native [iPhone / iPad client](https://github.com/RicterZ/mapannai-ios). External AI assistants can also work with the same trips.

<img width="1481" height="918" alt="Map and trip overview" src="https://github.com/user-attachments/assets/8cc1543e-1e5c-4f9b-93b8-66b72e73fce9" />

<img width="1481" height="918" alt="Daily places and route editing" src="https://github.com/user-attachments/assets/5e806e0e-86ff-4758-a85e-dae49e4afc8a" />

## Plan your first trip

1. Create a trip and choose its destinations and dates.
2. Choose **Add place** in the sidebar to save places to the trip or a particular day.
3. Build routes, reorder visits, and add visit and transport arrangements as needed.
4. Alternatively, open **AI 规划**, describe your preferences, and approve a draft before saving.
5. Open the same itinerary on the web or iOS while traveling.

## Deploy your own server

### 1. Prepare configuration

```bash
git clone https://github.com/RicterZ/mapannai-plus.git
cd mapannai-plus
cp env.example .env
```

For the recommended AMap / Google setup, explicitly set `MAP_RENDERER=amap` in `.env`: AMap is used within the supported China region and Google elsewhere. Place and route services also select providers by region, with Google fallback when AMap is unavailable. Keys are listed by purpose below; see [env.example](env.example) for the full configuration reference.

### 2. Map keys and required services

#### Google Maps Platform

Create a project in [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/overview), attach an active billing account, and set API restrictions for each key. **Use separate server, browser and iOS keys: their application restrictions are not interchangeable.**

| Purpose | Configuration | APIs to enable | Key restrictions |
| --- | --- | --- | --- |
| Server place search and details, destinations, address lookup and route planning; shared by web and iOS | Server `.env`: `GOOGLE_API_KEY` | **Places API (Legacy)**, **Geocoding API**, **Directions API (Legacy)** | Optionally restrict to server egress IPs; do not apply website or iOS application restrictions |
| Overseas web basemap | Server `.env`: `GOOGLE_JS_KEY` | **Maps JavaScript API** | Website HTTP referrers for your deployment; allow localhost separately for local use |
| Native Google basemap on iOS | iOS `Config/Local.xcconfig`: `GOOGLE_MAPS_IOS_KEY` | **Maps SDK for iOS** | iOS application restriction matching the final Bundle ID |

**The current server uses legacy Places and Directions endpoints. Enabling only Places API (New) or Routes API does not replace them.** Google limits activation of legacy APIs for new projects. If activation is unavailable, check the project's eligibility first; changing the key alone does not resolve this. Check service availability, quotas and pricing before deployment.

If `GOOGLE_JS_KEY` is empty, the browser uses `GOOGLE_API_KEY`, which is then exposed to the browser and must also allow Maps JavaScript API. Avoid sharing a server-IP-restricted key. The iOS client does not require Places SDK for iOS: its place search and route planning use the server services above. Opening navigation in the external Google Maps app does not require a native map key.

#### AMap

Create an application in the [AMap console](https://console.amap.com/) and request keys for each platform below. Check account verification, service permissions and quotas; do not substitute a key from another platform.

| Purpose | Configuration | Platform and required capabilities | Notes |
| --- | --- | --- | --- |
| Server place search and details, destinations, address lookup and route planning in China; shared by web and iOS | Server `.env`: `AMAP_API_KEY` | **Web Service**; POI search (text, polygon, details), geocoding / reverse geocoding, walking / driving / cycling / public-transit directions | Verify account permissions and quotas for these services; use server egress IPs if configuring an IP allowlist |
| Web basemap in China | `.env`: `AMAP_JS_KEY` and matching `AMAP_JS_SECURITY_CODE` | **Web (JS API)** for JS API 2.0 | Configure the deployment domain allowlist. The security code must match the JS key; both are currently provided to the browser |
| Native AMap basemap on iOS | iOS `Config/Local.xcconfig`: `AMAP_IOS_KEY` | **iOS** platform key for the AMap SDK | Bind to the final signed Bundle ID; re-signing with AltStore or similar tools may change it |

Unlike Google, AMap setup is not a matching set of API checkboxes: the key must have the **correct platform type, with the required Web Service permissions and quotas available**. An iOS SDK key alone does not provide server search or directions.

#### iOS users and app builders

- Users installing a prebuilt client only enter the server URL and `API_TOKEN` in app settings, not server map keys.
- When building the app, put native map keys in the iOS repository's `Config/Local.xcconfig`, not this server's `.env`. See the [iOS repository](https://github.com/RicterZ/mapannai-ios).
- Apple Maps does not need a Google / AMap basemap key or an Apple Maps Server API key. Place search, destination lookup and route planning still depend on the map services configured on your server.

### 3. Other keys and optional features

| Setting | Purpose and requirements |
| --- | --- |
| `API_TOKEN` | A server access token you generate. Web, iOS and MCP use the same value. Recommended for public deployments; without it, anyone who can reach the service can modify data |
| AI API key | Enter the API URL, key and model in web AI settings, not in a map-key field. Use an OpenAI-compatible Chat Completions service with tool calling; images also require vision support. iOS has its own AI settings |
| `BRAVE_API_KEY` | Optional Brave Search API access for AI web search |
| `FIRECRAWL_API_KEY` | Optional Firecrawl access for AI page reading |
| `TENCENT_COS_SECRET_ID`, `TENCENT_COS_SECRET_KEY` | Optional Tencent Cloud credentials for place photos and AI image uploads. Prefer a subaccount restricted to the required operations on the target bucket |
| `TENCENT_COS_REGION`, `TENCENT_COS_BUCKET` | Region and bucket for uploads. Configure bucket CORS to allow PUT uploads and required headers from your site; images must be readable by browsers and vision models |
| `NEXT_PUBLIC_IMAGE_DOMAINS` | Comma-separated image hostnames without protocols, set before building when deploying image features |
| `AGENT_TOKEN` | Optional generated internal credential shared by Web and the AI service, not a model key and never sent to the browser. Required for non-loopback listening; normally unchanged in the default Docker setup |

Maps, AI, storage and web retrieval may each incur charges. Browser and native SDK keys ship with clients: apply platform-appropriate restrictions. Never put server map keys, COS secrets or internal credentials in frontend code or commit them to the repository.

Recommended map configuration:

```dotenv
MAP_RENDERER=amap
AMAP_API_KEY=your-amap-web-service-key
AMAP_JS_KEY=your-amap-js-key
AMAP_JS_SECURITY_CODE=your-matching-js-security-code
GOOGLE_API_KEY=your-google-server-key
GOOGLE_JS_KEY=your-google-browser-key
API_TOKEN=your-access-token
```

### 4. Run the GHCR image (recommended)

No local build is needed. Create `.env` on the server. This is the minimum recommended configuration for AMap / Google maps, search and routes. `API_TOKEN` is technically optional but should not be omitted for public deployments. A separate `GOOGLE_JS_KEY` is recommended; leaving it blank reuses the server key. No other keys are needed without AI or image uploads.

```dotenv
MAP_RENDERER=amap
AMAP_API_KEY=your-amap-web-service-key
AMAP_JS_KEY=your-amap-js-key
AMAP_JS_SECURITY_CODE=your-matching-js-security-code
GOOGLE_API_KEY=your-google-server-key
GOOGLE_JS_KEY=your-google-browser-key
API_TOKEN=replace-with-a-long-random-token
```

Run:

```bash
docker run -d --name mapannai --restart unless-stopped \
  -p 3000:3000 --env-file .env \
  -v mapannai_data:/app/data \
  ghcr.io/ricterz/mapannai-plus:latest
```

Open `http://localhost:3000`, preferably behind HTTPS for remote access. Both Web and AI services are included; do not expose an extra AI port. The image cannot be pulled until first published. For anonymous pulls, make the GHCR package Public; otherwise log in with credentials granting `read:packages`.

Alternatively, use the included Compose file:

```bash
docker compose -f docker-compose.ghcr.yml up -d
# Update
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

The default is `latest`. Set `MAPANNAI_IMAGE=ghcr.io/ricterz/mapannai-plus:v1.2.0` in `.env` to pin an actually published version (the version shown is an example).

#### Full configuration example

Keep only the optional features you need. Remove or leave unused keys blank; **do not keep placeholder values unchanged**. Configure the model URL, model and AI key in app settings. Native iOS map keys belong in the app build, not the container.

```dotenv
# Map services / 地图服务
MAP_RENDERER=amap
AMAP_API_KEY=your-amap-web-service-key
AMAP_JS_KEY=your-amap-js-key
AMAP_JS_SECURITY_CODE=your-matching-js-security-code
AMAP_API_BASE_URL=https://restapi.amap.com
GOOGLE_API_KEY=your-google-server-key
GOOGLE_JS_KEY=your-google-browser-key
GOOGLE_API_BASE_URL=https://maps.googleapis.com

# Access and persistent data / 认证与持久化
API_TOKEN=replace-with-a-long-random-token
SQLITE_PATH=/app/data/mapannai.db
AGENT_SQLITE_PATH=/app/data/agent.db

# Optional image uploads / 可选图片上传
TENCENT_COS_SECRET_ID=your-cos-secret-id
TENCENT_COS_SECRET_KEY=your-cos-secret-key
TENCENT_COS_REGION=ap-chongqing
TENCENT_COS_BUCKET=your-bucket-appid

# Optional AI web access / 可选 AI 联网
BRAVE_API_KEY=your-brave-api-key
FIRECRAWL_API_KEY=your-firecrawl-api-key

# Internal AI service / 内部 AI 服务
AGENT_HOST=127.0.0.1
AGENT_PORT=3100
AGENT_URL=http://127.0.0.1:3100
AGENT_MCP_URL=http://127.0.0.1:3000/api/mcp
AGENT_TOKEN=replace-with-another-long-random-token
AI_ALLOW_PRIVATE_ENDPOINTS=false
AGENT_TRACE_ENABLED=false
```

`NEXT_PUBLIC_IMAGE_DOMAINS` is a build setting, not a runtime parameter for a prebuilt image. Current image displays use direct image URLs. To customize Next.js image domains, set the `NEXT_PUBLIC_IMAGE_DOMAINS` Actions repository variable before building your own image, or build from source. COS uploads still require bucket permissions, CORS and readable image URLs.

#### Publish your own image

Choose **Actions → Publish container image → Run workflow**, or publish a GitHub Release to trigger a build. Images go to `ghcr.io/<owner>/<repository>` for `linux/amd64` and `linux/arm64`. The workflow uses the built-in `GITHUB_TOKEN`; no personal publishing token or map keys are needed.

- Stable releases publish the version tag and `latest`. Prereleases publish the version tag without replacing `latest`.
- Manual builds on the default branch publish `edge` and a commit SHA tag, without replacing stable `latest`. Other branches publish only a SHA tag.
- Check package visibility in GitHub Packages after the first publish. Test a manual build with `MAPANNAI_IMAGE=ghcr.io/<owner>/<repository>:edge`. Adding the workflow does not build historical releases automatically.

#### Build from source (optional)

```bash
docker compose up -d --build mapannai
docker compose logs -f mapannai
```

Back up the `mapannai_data` volume before updating; it contains places, trips, route caches and AI records. **Do not run `docker compose down -v`: it deletes the volume.** Custom database paths must be inside persistent mounts. Rebuilding or replacing a container does not undo saved itinerary changes.

<details>
<summary>Optional: OSM basemap</summary>

Only relevant if you choose `MAP_RENDERER=osm`. AMap / Google deployments need neither an OSM key nor a tile proxy. The current application still defaults to OSM when unspecified, so explicitly set `MAP_RENDERER=amap` for the recommended deployment.

OSM needs no map key but does not replace place-search or route-service keys. By default, tiles use the same-origin `/osm-tiles/` path, requiring a reverse-proxy rule:

```nginx
location /osm-tiles/ {
    proxy_pass https://tile.openstreetmap.org/;
    proxy_set_header Host tile.openstreetmap.org;
    proxy_set_header User-Agent "MapAnNai/1.0 (your-contact-email)";
}
```

Replace the contact email and follow the tile service's usage policy. For local Node deployments, set `NEXT_PUBLIC_OSM_TILE_PROXY=false` before building to load tiles directly. The current Docker build does not forward this variable; add a build argument yourself if needed.

</details>

## Use AI in the web app

Open **AI 规划** and enter your API URL, key and model in settings. Discuss preferences, answer follow-up questions and choose dates, then review the full draft before confirming the save. Review the actual saved days afterward; changes to existing trips follow the corresponding confirmation flow.

Upload or paste JPG, PNG or WebP images, up to four per message and 10 MB per image. Preview or remove them before sending. Image storage and a vision-capable model are required; avoid sensitive documents and private information.

Create, switch or delete conversations without deleting saved trips. Interaction cards wait for your response. After a refresh or disconnection, retrieve recorded background results. Stopping does not undo completed saves, and service restarts can interrupt active tasks.

The conversation list and model settings remain in the current browser, without guaranteed cross-device synchronization. Remembering a key stores it as plain text in the browser. Your selected model service receives conversations and relevant itinerary information, including image links for vision requests. The server saves AI results and tool records for recovery; diagnostic logging can also retain conversation material. Treat databases and backups as private data.

## Connect an external AI assistant

Add `https://your-domain/api/mcp` to an MCP client supporting **Streamable HTTP**. With authentication enabled, use `Authorization: Bearer YOUR_TOKEN`:

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

Remove `headers` if `API_TOKEN` is unset. Follow your client's configuration format. Connected assistants can search and save places, create trips, arrange days, and edit routes, visits and transport arrangements shared with web and iOS.

## Local development

Use Node.js 22 and npm. Configure settings using [env.example](env.example), then run:

```bash
npm ci
npm run dev
```

For web AI, run in another terminal:

```bash
npm run agent:start
```

Open `http://localhost:3000`. Checks and production commands:

```bash
npm run type-check
npm run build
npm start
git diff --check
```

Do not run the development server and build in the same directory at once. After changing Node versions, use `npm rebuild better-sqlite3` if the native SQLite dependency reports an ABI error. Non-Docker deployments also need the AI service for web AI. See [Agent service](docs/agent-service.md) for optional web-tool installation and detailed setup, and [AGENTS.md](AGENTS.md) for development conventions.
