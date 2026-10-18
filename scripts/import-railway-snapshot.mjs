// Refresh the bundled snapshot from a complete Overpass `out geom` JSON export.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
const input = process.argv[2]
const region = process.argv[3] || 'japan'
if (!['japan', 'china'].includes(region)) throw new Error('Region must be japan or china')
if (!input) throw new Error('Usage: node scripts/import-railway-snapshot.mjs <overpass-export.json> [japan|china]')
const data = JSON.parse(readFileSync(input, 'utf8'))
if (data.remark || !Array.isArray(data.elements) || !data.elements.length) throw new Error('Incomplete OSM export')
const nodes = new Map(), ways = []
for (const way of data.elements) {
    if (way.type !== 'way' || way.tags?.railway !== 'rail' || way.tags.service) continue
    if (!Array.isArray(way.nodes) || way.nodes.length !== way.geometry?.length) throw new Error('Missing way geometry')
    for (let i = 0; i < way.nodes.length; i++) {
        const { lat, lon } = way.geometry[i]
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Invalid coordinate')
        nodes.set(way.nodes[i], [way.nodes[i], lat, lon])
    }
    ways.push(way.nodes)
}
if (!ways.length) throw new Error('No railway ways')
mkdirSync('src/lib/map/railway-data', { recursive: true })
const snapshot = gzipSync(JSON.stringify({ nodes: [...nodes.values()], ways }), { level: 9 })
writeFileSync(`src/lib/map/railway-data/${region}-railway.json.gz`, snapshot)
writeFileSync(`src/lib/map/railway-data/${region}-railway-source.json`, JSON.stringify({ source: 'OpenStreetMap contributors', license: 'ODbL-1.0', licenseUrl: 'https://www.openstreetmap.org/copyright', timestamp: data.osm3s?.timestamp_osm_base, sha256: createHash('sha256').update(snapshot).digest('hex'), region, query: 'Country admin area, railway=rail, no service tag; out geom', nodes: nodes.size, ways: ways.length }, null, 2) + '\n')
console.log(`${nodes.size} nodes, ${ways.length} ways`)
