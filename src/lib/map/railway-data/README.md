# China and Japan railway snapshots

`china-railway.json.gz` and `japan-railway.json.gz` are offline OpenStreetMap extracts, bundled with the
server. It is not loaded by browsers. OSM geometry never uses a network service at runtime. When no offline path is
available, routing falls back to the existing Google/AMap providers and finally
to a schematic curve. The graph is loaded lazily and reused within each server process.

## Source and license

© OpenStreetMap contributors. Database licensed under the Open Database License
(ODbL) 1.0: https://opendatacommons.org/licenses/odbl/1-0/

Attribution and source: https://www.openstreetmap.org/copyright

See the corresponding `*-railway-source.json` for the source timestamp and counts. This extract
contains the country's `railway=rail` ways without a `service` tag and their WGS-84
nodes. It excludes yards/sidings, subway-only and tram-only tracks. It contains
physical geometry, not timetables, service availability or guaranteed JR routes.
The snapshot itself remains available under ODbL, independently of app licensing.

## Refresh

Export a **complete** Overpass result (this is a maintenance operation only):

```overpass
[out:json][timeout:300][maxsize:1073741824];
area["ISO3166-1"="JP"][admin_level=2]->.jp;
way[railway=rail][!service](area.jp);
out geom;
```

```sh
node scripts/import-railway-snapshot.mjs /tmp/japan-railway-export.json japan
# For China, use ISO3166-1=CN in the query and pass china:
node scripts/import-railway-snapshot.mjs /tmp/china-railway-export.json china
npx tsx scripts/test-railway-route.ts
```

Commit the gzip and source metadata together. Change the `osm-rail-offline-v3`
cache version in both `direction-service.ts` and `route-cache.ts` when replacing
the snapshot. Docker explicitly copies the data; Next standalone tracing also
includes this directory. Neither deployment nor startup downloads the data.

Europe is not bundled. Routes outside the snapshots fall back to the existing
regional providers. Each country graph is loaded only when first needed.
