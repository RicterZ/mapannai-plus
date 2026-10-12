import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { NextRequest } from 'next/server'
import { destinationSearchBounds, tripDestinationSchema, tripDestinationsSchema, tripDestinations } from '../src/lib/trips/destination'

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
    const { searchDestinationPlaces } = await import('../src/lib/api/search-service')
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
        const paris = { name: '巴黎', latitude: 48.8566, longitude: 2.3522 }
        const destinations = [tokyo, paris]
        const multiResponse = await POST(new NextRequest('http://localhost/api/trips', { method: 'POST', body: JSON.stringify({ name: 'Tokyo + Paris', startDate: '2026-12-01', endDate: '2026-12-03', destinations }) }))
        assert.equal(multiResponse.status, 200)
        const multi = await multiResponse.json()
        assert.deepEqual(multi.destinations, destinations)
        assert.deepEqual(multi.destination, tokyo, 'old clients see first destination')
        assert.deepEqual(getTripById(multi.id)?.destinations, destinations)
        await PUT(new NextRequest('http://localhost', { method: 'PUT', body: JSON.stringify({ name: 'Renamed multi', startDate: '2027-01-01' }) }), { params: { id: multi.id } })
        assert.deepEqual(getTripById(multi.id)?.destinations, destinations, 'date changes preserve entire list')
        const serviceTrip = getTripById(multi.id)!
        delete serviceTrip.destinations; delete serviceTrip.destination
        upsertTrip(serviceTrip)
        assert.deepEqual(getTripById(multi.id)?.destinations, destinations, 'old service omitting fields preserves entire list')
        const remove = await PUT(new NextRequest('http://localhost', { method: 'PUT', body: JSON.stringify({ destinations: [paris] }) }), { params: { id: multi.id } })
        assert.equal(remove.status, 200); assert.deepEqual(getTripById(multi.id)?.destinations, [paris])
        for (const invalid of [[tokyo, tokyo], [tokyo, { name: 'Bad', latitude: 91, longitude: 0 }], null, Array.from({ length: 21 }, (_, i) => ({ name: `city ${i}`, latitude: i, longitude: i }))]) {
            const failed = await PUT(new NextRequest('http://localhost', { method: 'PUT', body: JSON.stringify({ destinations: invalid }) }), { params: { id: multi.id } })
            assert.equal(failed.status, 400); assert.deepEqual(getTripById(multi.id)?.destinations, [paris])
        }
        await PUT(new NextRequest('http://localhost', { method: 'PUT', body: JSON.stringify({ destination: tokyo }) }), { params: { id: multi.id } })
        assert.deepEqual(getTripById(multi.id)?.destinations, [tokyo], 'legacy single writes normalize to a one-item list')
        await PUT(new NextRequest('http://localhost', { method: 'PUT', body: JSON.stringify({ destinations: [] }) }), { params: { id: multi.id } })
        assert.deepEqual(getTripById(multi.id)?.destinations, []); assert.equal(getTripById(multi.id)?.destination, null)
        getDb().prepare('UPDATE trips SET destination = ? WHERE id = ?').run(JSON.stringify(tokyo), 'old')
        assert.deepEqual(getTripById('old')?.destinations, [tokyo], 'existing object JSON loads as one destination')
        assert.deepEqual(tripDestinations({ destination: tokyo }), [tokyo], 'old client state normalizes without reload')
        assert(!tripDestinationsSchema.safeParse([tokyo, tokyo]).success)
        const multiBridge = await connectPlanningTools()
        try {
            const created = await multiBridge.call('create_trip', { name: 'MCP multi', startDate: '2026-12-01', endDate: '2026-12-01', destinations }, new AbortController().signal)
            assert(!created.isError)
            assert.deepEqual(JSON.parse((created.content as Array<{ text: string }>)[0].text).destinations, destinations)
        } finally { await multiBridge.close() }
        const searchCalls: URL[] = []
        globalThis.fetch = async (input, init) => {
            const url = new URL(String(input), 'http://localhost'); searchCalls.push(url)
            const bounds = JSON.parse(url.searchParams.get('bounds')!)
            assert.equal(init?.signal, searchAbort.signal)
            const isTokyo = bounds.west > 100
            return Response.json({ success: true, data: [
                { id: 'shared', name: 'Shared', placeId: 'shared', coordinates: { longitude: 10, latitude: 10 } },
                { id: isTokyo ? 't' : 'p', name: isTokyo ? 'Tokyo cafe' : 'Paris cafe', coordinates: { longitude: isTokyo ? 139.7 : 2.35, latitude: isTokyo ? 35.69 : 48.85 } },
            ] })
        }
        const searchAbort = new AbortController()
        const merged = await searchDestinationPlaces('cafe', destinations, searchAbort.signal)
        assert.equal(searchCalls.length, 2, 'one local scope per destination')
        assert.equal(merged.length, 3, 'overlapping results deduplicated')
        assert(merged.some(item => item.name === 'Tokyo cafe')); assert(merged.some(item => item.name === 'Paris cafe'))
        globalThis.fetch = async () => Response.json({ error: 'mock failure' }, { status: 500 })
        await assert.rejects(searchDestinationPlaces('cafe', destinations), 'partial failures never pretend to cover all destinations')
        globalThis.fetch = async () => Response.json({ success: true, data: [] })
        await assert.rejects(searchDestinationPlaces('cafe', destinations, AbortSignal.abort()))
        assert(tripDestinationSchema.safeParse(tokyo).success)
        console.log('Trip destinations passed: six city lookups with HTTP mocks, fallback/cancellation, old DB migration, API/MCP persistence/validation, legacy preservation, date shifts, search center and overseas coordinates; multi-destination CRUD/MCP, legacy object/list compatibility, merged search scopes/dedup/errors/abort.')
    } finally {
        globalThis.fetch = originalFetch
        getDb().close(); rmSync(temp, { recursive: true, force: true })
    }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
