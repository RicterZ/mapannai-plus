import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { NextRequest } from 'next/server'
import { destinationSearchBounds, tripDestinationSchema } from '../src/lib/trips/destination'

const temp = mkdtempSync(path.join(tmpdir(), 'mapannai-destinations-'))
process.env.SQLITE_PATH = path.join(temp, 'test.db')
process.env.GOOGLE_API_KEY = 'mock-only'
process.env.AMAP_API_KEY = 'mock-only'
process.env.GOOGLE_API_BASE_URL = 'https://maps.googleapis.com'
process.env.AMAP_API_BASE_URL = 'https://restapi.amap.com'
const legacy = new Database(process.env.SQLITE_PATH)
legacy.exec(`CREATE TABLE trips (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, start_date TEXT NOT NULL, end_date TEXT NOT NULL, cover_image TEXT, emoji TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
INSERT INTO trips VALUES ('old','Old','retained','2026-10-12','2026-10-12',NULL,NULL,'now','now');`)
legacy.close()
async function main() {
    const { GET: search } = await import('../src/app/api/destinations/route')
    const { POST, GET } = await import('../src/app/api/trips/route')
    const { PUT } = await import('../src/app/api/trips/[id]/route')
    const { getDb } = await import('../src/lib/db')
    const { getTripById, upsertTrip } = await import('../src/lib/db/trip-service')
    const { connectPlanningTools } = await import('../src/lib/ai/mcp-tools')
    const { searchDestinations } = await import('../src/lib/map/destination-service')
    const { GoogleServerProvider } = await import('../src/lib/map/providers/google-server-provider')
    const originalFetch = globalThis.fetch
    const requests: URL[] = []
    let amapFailure = false
    const cities: Record<string, [number, number, boolean]> = {
        东京: [139.6917, 35.6895, false], 巴黎: [2.3522, 48.8566, false],
        重庆: [106.5516, 29.563, true], 济南: [117.1201, 36.6512, true], 天津: [117.2, 39.12, true], 大理: [100.2676, 25.6065, true],
    }
    globalThis.fetch = async input => {
        const url = new URL(String(input)); requests.push(url)
        const query = url.searchParams.get('address') ?? ''
        const city = cities[query]
        if (url.hostname === 'restapi.amap.com') {
            if (amapFailure) throw new Error('mock AMap outage')
            return Response.json({ status: '1', geocodes: city?.[2] ? [{ formatted_address: query, level: '市', location: `${city[0]},${city[1]}` }] : [] })
        }
        assert.equal(url.hostname, 'maps.googleapis.com', 'no real service requests')
        if (url.pathname.includes('textsearch')) return Response.json({ status: 'OK', results: [{ name: 'Tokyo', geometry: { location: { lng: 139.6917, lat: 35.6895 } } }] })
        assert.equal(url.searchParams.has('region'), false, 'destination lookup has no country restriction')
        return Response.json({ status: city ? 'OK' : 'ZERO_RESULTS', results: city ? [{ formatted_address: query, types: ['locality'], geometry: { location: { lng: city[0], lat: city[1] } } }] : [] })
    }
    const create = async (destination?: unknown) => POST(new NextRequest('http://localhost/api/trips', { method: 'POST', body: JSON.stringify({ name: 'Trip', startDate: '2026-10-12', endDate: '2026-10-14', ...(destination === undefined ? {} : { destination }) }) }))
    try {
        assert.equal(getTripById('old')?.destination, null, 'old database migrates non-destructively')
        let tokyo
        for (const [name, coords] of Object.entries(cities)) {
            requests.length = 0
            const response = await search(new NextRequest(`http://localhost/api/destinations?q=${encodeURIComponent(name)}`))
            assert.equal(response.status, 200)
            const { data } = await response.json()
            assert.equal(data[0].name, name)
            assert(Math.abs(data[0].longitude - coords[0]) < 0.01)
            assert.equal(requests.length, coords[2] ? 1 : 2)
            if (name === '东京') tokyo = data[0]
        }
        assert.deepEqual(await searchDestinations('unknown'), [])
        amapFailure = true
        assert.equal((await searchDestinations('重庆'))[0].name, '重庆', 'AMap errors fall back to Google')
        const aborted = AbortSignal.abort()
        await assert.rejects(searchDestinations('东京', aborted))
        assert.equal((await search(new NextRequest('http://localhost/api/destinations'))).status, 400)
        const result = await create(tokyo); assert.equal(result.status, 200)
        const trip = await result.json()
        assert.deepEqual(getTripById(trip.id)?.destination, tokyo)
        assert.equal(trip.days.length, 3)
        const listed = await (await GET()).json()
        assert.deepEqual(listed.find((item: { id: string }) => item.id === trip.id).destination, tokyo)
        const updated = await PUT(new NextRequest('http://localhost', { method: 'PUT', body: JSON.stringify({ name: 'Renamed', startDate: '2026-11-01' }) }), { params: { id: trip.id } })
        assert.equal(updated.status, 200); assert.deepEqual(getTripById(trip.id)?.destination, tokyo)
        const saved = getTripById(trip.id)!
        delete saved.destination
        upsertTrip(saved); assert.deepEqual(getTripById(trip.id)?.destination, tokyo, 'legacy service writes preserve destination')
        for (const invalid of [{ name: '', latitude: 35, longitude: 139 }, { name: 'Tokyo', latitude: 91, longitude: 139 }, { name: 'Tokyo', latitude: 35, longitude: '139' }, { ...tokyo, placeId: 'unwanted' }]) {
            assert.equal((await create(invalid)).status, 400)
            assert.equal((await PUT(new NextRequest('http://localhost', { method: 'PUT', body: JSON.stringify({ destination: invalid }) }), { params: { id: trip.id } })).status, 400)
        }
        assert.deepEqual(getTripById(trip.id)?.destination, tokyo)
        assert.equal((await create()).status, 200, 'old clients can create trips without destinations')
        assert.equal((getDb().prepare('SELECT COUNT(*) AS count FROM markers').get() as { count: number }).count, 0, 'destination does not create a marker')
        const cleared = await PUT(new NextRequest('http://localhost', { method: 'PUT', body: JSON.stringify({ destination: null }) }), { params: { id: trip.id } })
        assert.equal(cleared.status, 200); assert.equal(getTripById(trip.id)?.destination, null)
        const bounds = destinationSearchBounds(tokyo)
        assert(bounds.west < tokyo.longitude && bounds.east > tokyo.longitude && bounds.south < tokyo.latitude && bounds.north > tokyo.latitude)
        for (const latitude of [-90, 0, 90]) for (const longitude of [-180, 180]) {
            const b = destinationSearchBounds({ name: 'edge', latitude, longitude })
            assert(Object.values(b).every(Number.isFinite)); assert(b.west >= -180 && b.east <= 180 && b.south >= -90 && b.north <= 90)
        }
        const googleResult = await new GoogleServerProvider().searchPlaces('Tokyo', undefined, 'CN', { bounds })
        assert.equal(googleResult[0].coordinates.longitude, tokyo.longitude, 'overseas coordinates never shifted despite legacy CN country hint')
        const bridge = await connectPlanningTools()
        try {
            const destinations = await bridge.call('search_destinations', { query: '东京' }, new AbortController().signal)
            assert(!destinations.isError)
            const created = await bridge.call('create_trip', { name: 'MCP Tokyo', startDate: '2026-10-12', endDate: '2026-10-12', destination: tokyo }, new AbortController().signal)
            assert(!created.isError)
            const data = JSON.parse((created.content as Array<{ text: string }>)[0].text)
            assert.deepEqual(data.destination, tokyo)
        } finally { await bridge.close() }
        assert(tripDestinationSchema.safeParse(tokyo).success)
        console.log('Trip destinations passed: six city lookups with HTTP mocks, fallback/cancellation, old DB migration, API/MCP persistence/validation, legacy preservation, date shifts, search center and overseas coordinates.')
    } finally {
        globalThis.fetch = originalFetch
        getDb().close(); rmSync(temp, { recursive: true, force: true })
    }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
