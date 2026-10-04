import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import Database from 'better-sqlite3'
import { NextRequest, NextResponse } from 'next/server'

// All storage is temporary. No dotenv and no external requests are permitted.
const temp = mkdtempSync(path.join(tmpdir(), 'mapannai-poi-'))
process.env.SQLITE_PATH = path.join(temp, 'test.db')
process.env.GOOGLE_API_KEY = 'test-only'
process.env.AMAP_API_KEY = 'test-only'
process.env.API_TOKEN = 'test-only'
process.env.GOOGLE_API_BASE_URL = 'https://maps.googleapis.com'
process.env.AMAP_API_BASE_URL = 'https://restapi.amap.com'
process.env.MAP_SEARCH_PROVIDER = 'google'
process.env.MAP_DETAILS_PROVIDER = 'google'
const legacy = new Database(process.env.SQLITE_PATH)
legacy.exec(`CREATE TABLE markers (id TEXT PRIMARY KEY, longitude REAL NOT NULL, latitude REAL NOT NULL, title TEXT, address TEXT, header_image TEXT, icon_type TEXT NOT NULL DEFAULT 'location', markdown_content TEXT NOT NULL DEFAULT '', description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
INSERT INTO markers VALUES ('legacy',1,1,'Old',NULL,NULL,'location','',NULL,'now','now');`)
legacy.close()

async function main() {
    const markers = await import('../src/app/api/markers/route')
    const marker = await import('../src/app/api/markers/[id]/route')
    const v2 = await import('../src/app/api/markers/v2/route')
    const dataset = await import('../src/app/api/dataset/route')
    const search = await import('../src/app/api/search/route')
    const places = await import('../src/app/api/places/route')
    const trips = await import('../src/app/api/trips/route')
    const { middleware } = await import('../src/middleware')
    const dbService = await import('../src/lib/db/marker-service')
    const tripService = await import('../src/lib/db/trip-service')
    const { getDb } = await import('../src/lib/db')
    const { officialPlaceReferences } = await import('../src/lib/places/place-references')
    const { mapProviderFactory } = await import('../src/lib/map/providers')
    const { AmapServerProvider } = await import('../src/lib/map/providers/amap-server-provider')
    const { GoogleServerProvider } = await import('../src/lib/map/providers/google-server-provider')
    const { connectPlanningTools } = await import('../src/lib/ai/mcp-tools')
    const realFetch = globalThis.fetch
    let searchCoordinate = 35
    let officialId: unknown = 'Google-Opaque_001'
    let externalCalls = 0
    globalThis.fetch = async (input, options) => {
        if (typeof input === 'string' && input.startsWith('/api/')) return realFetch(base + input, options)
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
        if (url.hostname === '127.0.0.1') return realFetch(input, options)
        externalCalls++
        if (url.hostname === 'maps.googleapis.com') {
            if (url.pathname.includes('textsearch')) return Response.json({ status: 'OK', results: [{ name: 'Official POI', place_id: officialId, geometry: { location: { lat: searchCoordinate, lng: 139 } } }] })
            if (url.pathname.includes('geocode')) return Response.json({ status: 'OK', results: [{ place_id: officialId, formatted_address: 'Nearby POI' }] })
            if (url.pathname.includes('details')) return Response.json({ status: 'OK', result: { name: 'Nearby POI', formatted_address: 'Address' } })
        }
        if (url.hostname === 'restapi.amap.com') {
            if (url.pathname.includes('regeo')) return Response.json({ status: '1', regeocode: { formatted_address: 'Nearby', pois: [{ id: 'AMap_001', name: 'Nearby' }] } })
            return Response.json({ status: '1', count: '1', pois: [{ id: 'AMap_001', name: 'Official POI', location: '116.4,39.9' }] })
        }
        throw new Error('Unexpected network request blocked')
    }
    const server = createServer(async (incoming, outgoing) => {
        try {
            const chunks: Buffer[] = []
            for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
            const body = Buffer.concat(chunks).toString()
            const req = new NextRequest(`http://127.0.0.1${incoming.url}`, { method: incoming.method, headers: incoming.headers as Record<string, string>, ...(body ? { body } : {}) })
            let res: Response = middleware(req)
            if (res.status !== 401) {
                const method = req.method
                const pathname = req.nextUrl.pathname
                const id = pathname.match(/^\/api\/markers\/([^/]+)$/)?.[1]
                if (pathname === '/api/markers/v2') res = await v2.POST(req)
                else if (id) res = method === 'GET' ? await marker.GET(req, { params: { id } }) : method === 'DELETE' ? await marker.DELETE(req, { params: { id } }) : await marker.PUT(req, { params: { id } })
                else if (pathname === '/api/markers') res = method === 'GET' ? await markers.GET() : await markers.POST(req)
                else if (pathname === '/api/dataset') res = method === 'GET' ? await dataset.GET(req) : await dataset.POST(req)
                else if (pathname === '/api/trips') res = await trips.GET()
                else if (pathname === '/api/search') res = await search.GET(req)
                else if (pathname === '/api/places') res = await places.POST(req)
                else res = NextResponse.json({ error: 'Not found' }, { status: 404 })
            }
            outgoing.writeHead(res.status, { 'Content-Type': 'application/json' })
            outgoing.end(await res.text())
        } catch { outgoing.writeHead(500); outgoing.end('{}') }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const base = `http://127.0.0.1:${address.port}`
    async function api(url: string, method = 'GET', body?: unknown, authorized = true) {
        const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(authorized ? { 'x-api-token': 'test-only' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
        return { status: response.status, body: await response.json() }
    }
    const apple = { placeId: 'Apple-Case_001' }, google = { placeId: 'Google-Case_001' }, amap = { placeId: 'AMap-Case_001' }
    const coords = { longitude: 139, latitude: 36 }
    try {
        let r = await api('/api/markers/legacy')
        assert.equal(r.body.placeReferences, null, 'legacy migration defaults to null')
        assert.equal((await api('/api/markers/legacy', 'PUT', { title: 'Edited old' })).status, 200)
        let created = await api('/api/markers', 'POST', { coordinates: coords, title: 'Multi', iconType: 'location', placeReferences: { apple, google } })
        assert.equal(created.status, 200)
        const creationReferences = [undefined, null, {}, { apple: null }, { apple }]
        for (let index = 0; index < creationReferences.length; index++) {
            const placeReferences = creationReferences[index]
            const single = await api('/api/markers', 'POST', { coordinates: { longitude: 60 + index, latitude: 10 }, title: 'Single', iconType: 'location', placeReferences })
            assert.equal(single.status, 200)
            assert.deepEqual(single.body.placeReferences, index === 4 ? { apple } : null)
        }
        const id = created.body.id, url = `/api/markers/${id}`
        const getRefs = async () => (await api(url)).body.placeReferences
        assert.deepEqual(await getRefs(), { apple, google })
        for (const patch of [{ title: 'Title' }, { markdownContent: '<p>Note</p>' }, { headerImage: 'https://example.test/image.jpg' }, { address: 'Address', iconType: 'food' }]) {
            assert.equal((await api(url, 'PUT', patch)).status, 200)
            assert.deepEqual(await getRefs(), { apple, google })
        }
        assert.deepEqual((await api(url, 'PUT', { placeReferences: { amap, google: null } })).body.placeReferences, { apple, amap })
        assert.deepEqual((await api(url, 'PUT', { placeReferences: {} })).body.placeReferences, { apple, amap })
        assert.equal((await api(url, 'PUT', { placeReferences: null })).body.placeReferences, null)
        assert.equal((await api(url, 'PUT', { placeReferences: { google: null } })).body.placeReferences, null)
        assert.deepEqual((await api(url, 'PUT', { placeReferences: { apple } })).body.placeReferences, { apple })
        const invalid = [{ other: apple }, { apple: {} }, { apple: { placeId: '' } }, { apple: { placeId: ' '.repeat(3) } }, { apple: { placeId: 'a'.repeat(2049) } }, { apple: { placeId: 'id\n' } }, { apple: { placeId: '\u007f' } }, { apple: { placeId: 123 } }, { apple: [] }, [], 'text', 1, { apple: { placeId: 'id', key: 'not-allowed' } }]
        for (const placeReferences of invalid) {
            const previous = (await api(url)).body
            r = await api(url, 'PUT', { title: 'Must not save', coordinates: { longitude: 150, latitude: 40 }, placeReferences })
            assert.equal(r.status, 400, JSON.stringify(placeReferences))
            assert.deepEqual((await api(url)).body, previous, 'no partial update')
            assert.equal((await api('/api/markers', 'POST', { coordinates: coords, title: 'Invalid', iconType: 'location', placeReferences })).status, 400, 'validation precedes dedup')
            assert.equal((await api('/api/dataset', 'POST', { featureId: id, coordinates: coords, properties: { placeReferences, metadata: { title: 'No partial dataset write' } } })).status, 400)
        }
        assert.deepEqual((await api(url, 'PUT', { placeReferences: { apple: { placeId: '  Opaque_ID-Aa  ' } } })).body.placeReferences, { apple: { placeId: 'Opaque_ID-Aa' } })
        await api(url, 'PUT', { placeReferences: { apple, google } })
        assert.deepEqual((await api(url, 'PUT', { coordinates: { longitude: 139.0000001, latitude: 36 } })).body.placeReferences, { apple, google }, 'same 6dp coordinate retains')
        assert.equal((await api(url, 'PUT', { coordinates: { longitude: 140, latitude: 36 } })).body.placeReferences, null)
        await api(url, 'PUT', { placeReferences: { apple, google } })
        assert.deepEqual((await api(url, 'PUT', { coordinates: { longitude: 141, latitude: 36 }, placeReferences: { amap } })).body.placeReferences, { amap })
        await api(url, 'PUT', { placeReferences: { apple } })
        assert.equal((await api(url, 'PUT', { coordinates: { longitude: 142, latitude: 36 }, placeReferences: {} })).body.placeReferences, null)
        await Promise.all([api(url, 'PUT', { placeReferences: { apple } }), api(url, 'PUT', { placeReferences: { google } }), api(url, 'PUT', { placeReferences: { amap } })])
        assert.deepEqual(await getRefs(), { apple, google, amap })
        // Multiple processes/connections contend on SQLite, each merging only its own provider.
        await api(url, 'PUT', { placeReferences: null })
        await Promise.all(['apple', 'google', 'amap'].map(provider => new Promise<void>((resolve, reject) => {
            const code = `const { updateMarkerFields } = require('./src/lib/db/marker-service'); updateMarkerFields(${JSON.stringify(id)}, { placeReferences: { ${provider}: { placeId: '${provider}-worker' } } });`
            const worker = spawn(process.execPath, ['--import', 'tsx', '--eval', code], { cwd: process.cwd(), env: process.env, stdio: 'pipe' })
            let error = ''
            worker.stderr.on('data', data => { error += String(data) })
            worker.on('error', reject)
            worker.on('exit', status => status === 0 ? resolve() : reject(new Error(error)))
        })))
        assert.deepEqual(await getRefs(), { apple: { placeId: 'apple-worker' }, google: { placeId: 'google-worker' }, amap: { placeId: 'amap-worker' } })
        const references = await getRefs()
        const callsBeforeWrite = externalCalls
        assert.equal((await api(url, 'PUT', { markdownContent: 'No network' })).status, 200)
        assert.equal(externalCalls, callsBeforeWrite, 'reference writes do not call providers')
        assert.equal((await api(url, 'PUT', { placeReferences: null }, false)).status, 401)
        assert.deepEqual(await getRefs(), references)
        const wrongAuth = await realFetch(base + url, { method: 'PUT', headers: { Authorization: 'Bearer invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ placeReferences: null }) })
        assert.equal(wrongAuth.status, 401)
        const list = (await api('/api/markers')).body
        assert.deepEqual(list.find((m: any) => m.id === id).placeReferences, references)
        const exported = (await api('/api/dataset')).body.data.features.find((f: any) => f.id === id)
        assert.deepEqual(exported.properties.placeReferences, references)
        assert.equal((await api('/api/dataset', 'POST', { featureId: 'copied', coordinates: { longitude: 20, latitude: 20 }, properties: exported.properties })).status, 200)
        assert.deepEqual((await api('/api/markers/copied')).body.placeReferences, references, 'explicit dataset copy retains identity; no unique constraint')
        await api('/api/dataset', 'POST', { featureId: id, coordinates: { longitude: 142, latitude: 36 }, properties: { metadata: { title: 'Dataset note' }, markdownContent: 'Dataset' } })
        assert.deepEqual(await getRefs(), references, 'old dataset caller preserves')
        await api('/api/dataset', 'POST', { featureId: id, coordinates: { longitude: 143, latitude: 36 }, properties: { metadata: { title: 'Moved' } } })
        assert.equal(await getRefs(), null, 'dataset coordinate edits clear old identity')
        // Exercise the actual Web store with browser APIs mocked and our HTTP backend.
        const { useMapStore } = await import('../src/store/map-store')
        const oldWindow = globalThis.window
        const oldStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
        Object.defineProperty(globalThis, 'window', { value: {}, configurable: true, writable: true })
        Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => 'test-only' }, configurable: true, writable: true })
        try {
            await useMapStore.getState().loadMarkersFromDataset()
            assert.deepEqual(useMapStore.getState().markers.find(m => m.id === 'copied')!.placeReferences, references)
            const uiId = await new Promise<string>((resolve, reject) => {
                useMapStore.getState().createMarkerFromModal({ coordinates: { longitude: 80, latitude: 25 }, name: 'Web search', iconType: 'location', placeReferences: { apple, google }, onSynced: resolve }).catch(reject)
            })
            assert.deepEqual((await api(`/api/markers/${uiId}`)).body.placeReferences, { apple, google })
            // The ordinary Dataset save never resends old references as an explicit patch.
            const uiMarker = useMapStore.getState().markers.find(m => m.id === uiId)!
            await useMapStore.getState().saveMarkerToDataset({ ...uiMarker, content: { ...uiMarker.content, markdownContent: 'Web note' } })
            assert.deepEqual((await api(`/api/markers/${uiId}`)).body.placeReferences, { apple, google })
            await useMapStore.getState().saveMarkerToDataset({ ...uiMarker, coordinates: { longitude: 81, latitude: 25 } })
            assert.equal((await api(`/api/markers/${uiId}`)).body.placeReferences, null)
            assert.equal(useMapStore.getState().markers.find(m => m.id === uiId)!.placeReferences, null)
            useMapStore.getState().openAddMarkerModal({ longitude: 80, latitude: 25 }, 'Draft', { apple })
            assert.deepEqual(useMapStore.getState().addMarkerModal.placeReferences, { apple })
            useMapStore.getState().closeAddMarkerModal()
            assert.equal(useMapStore.getState().addMarkerModal.placeReferences, undefined)
        } finally {
            if (oldWindow === undefined) Reflect.deleteProperty(globalThis, 'window')
            else Object.defineProperty(globalThis, 'window', { value: oldWindow, configurable: true, writable: true })
            if (oldStorageDescriptor === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
            else Object.defineProperty(globalThis, 'localStorage', oldStorageDescriptor)
        }
        // Search pipeline, using mocked official provider HTTP responses.
        r = await api('/api/search?q=Tokyo&country=JP')
        const result = r.body.data[0]
        assert.equal(result.id, 'Official POI', 'legacy UI identity stays unchanged')
        assert.deepEqual(result.placeReferences, { google: { placeId: officialId } })
        const found = await api('/api/markers', 'POST', { coordinates: result.coordinates, title: result.name, iconType: 'location', placeReferences: result.placeReferences })
        assert.deepEqual((await api(`/api/markers/${found.body.id}`)).body.placeReferences, result.placeReferences)
        // Same coordinate dedup does not attach a different POI's identity.
        const duplicate = await api('/api/markers', 'POST', { coordinates: result.coordinates, title: 'Different official POI', iconType: 'location', placeReferences: { apple } })
        assert.deepEqual(duplicate.body.placeReferences, result.placeReferences)
        officialId = undefined
        searchCoordinate = 34
        r = await api('/api/search?q=NoID&country=JP')
        assert.equal(r.body.data[0].placeReferences, undefined)
        assert.equal(r.body.data[0].placeId, '')
        const noId = await api('/api/markers', 'POST', { coordinates: r.body.data[0].coordinates, title: r.body.data[0].name, iconType: 'location' })
        assert.equal(noId.body.placeReferences, null, 'internal name ID never used')
        assert.equal(officialPlaceReferences('google', 123), undefined)
        officialId = 'Google-Nearby'
        r = await api('/api/places', 'POST', { longitude: 139, latitude: 30 })
        assert.deepEqual(r.body.data.placeReferences, { google: { placeId: officialId } })
        assert.equal(await getRefs(), null, 'details never mutate a manual marker')
        assert.deepEqual((await new AmapServerProvider().searchPlaces('北京', undefined, 'CN'))[0].placeReferences, { amap: { placeId: 'AMap_001' } })
        assert.deepEqual((await new AmapServerProvider().getPlaceDetails({ longitude: 116.4, latitude: 39.9 })).placeReferences, { amap: { placeId: 'AMap_001' } })
        const googleProvider = new GoogleServerProvider()
        assert.deepEqual((await googleProvider.searchPlaces('Tokyo', undefined, 'JP'))[0].placeReferences, { google: { placeId: officialId } })
        searchCoordinate = 33
        const beforeInvalidV2 = externalCalls
        assert.equal((await api('/api/markers/v2', 'POST', { name: 'Invalid', iconType: 'location', placeReferences: { bad: apple } })).status, 400)
        assert.equal(externalCalls, beforeInvalidV2)
        const byName = await api('/api/markers/v2', 'POST', { name: 'Tokyo POI', iconType: 'location', country: 'JP' })
        assert.deepEqual(byName.body.placeReferences, { google: { placeId: officialId } })
        // Trip membership, day assignment and chain order do not modify references.
        await api(url, 'PUT', { placeReferences: { apple } })
        const now = new Date().toISOString()
        tripService.upsertTrip({ id: 'trip-test', name: 'Trip', startDate: '2026-10-04', endDate: '2026-10-04', createdAt: now, updatedAt: now })
        tripService.setTripMarker('trip-test', id, true)
        tripService.setTripMarker('trip-test', id, false)
        tripService.upsertTripDay({ id: 'day-test', tripId: 'trip-test', date: '2026-10-04', markerIds: [id, found.body.id], chains: [[id, found.body.id]] })
        tripService.upsertTripDay({ ...tripService.getDayById('day-test')!, chains: [[found.body.id, id]] })
        tripService.upsertTripDay({ ...tripService.getDayById('day-test')!, markerIds: [], chains: [] })
        assert.deepEqual(await getRefs(), { apple })
        // Actual MCP bridge used by web AI; existing result IDs remain available.
        const bridge = await connectPlanningTools()
        const call = async (name: string, args: Record<string, unknown>) => {
            const result = await bridge.call(name, args, new AbortController().signal)
            assert(!result.isError, `${name} failed`)
            return JSON.parse((result.content as Array<{ text: string }>)[0].text)
        }
        try {
            searchCoordinate = 32
            const ai = await call('create_marker', { places: [{ name: 'Tokyo official', iconType: 'location' }], country: 'JP' })
            assert.equal(ai[0].status, 'created'); assert(ai[0].id)
            assert.deepEqual(ai[0].placeReferences, { google: { placeId: officialId } })
            assert.equal((await call('update_marker', { markerId: ai[0].id, markdownContent: 'AI note' })).success, true)
            assert.deepEqual(dbService.getMarkerById(ai[0].id)!.properties.placeReferences, { google: { placeId: officialId } })
            assert.deepEqual((await call('update_marker', { markerId: ai[0].id, placeReferences: { apple, google: null } })).placeReferences, { apple })
            const badAI = await bridge.call('update_marker', { markerId: ai[0].id, title: 'Invalid AI', placeReferences: { unknown: apple } }, new AbortController().signal)
            assert(badAI.isError)
            searchCoordinate = 31
            const plan = await call('plan_trip_day', { tripId: 'trip-test', dayId: 'day-test', places: [{ name: 'Tokyo plan', iconType: 'location' }], country: 'JP' })
            // plan_trip_day result wrapper is kept intact.
            assert(JSON.stringify(plan).includes('Google-Nearby'))
            const aiList = await call('list_markers', {})
            assert.deepEqual(aiList.find((m: any) => m.id === ai[0].id).placeReferences, { apple })
        } finally { await bridge.close() }
        assert.equal((await api('/api/markers/copied', 'DELETE')).status, 200)
        assert.equal(dbService.getMarkerById('copied'), null)
        assert.equal(getDb().prepare('SELECT place_references FROM markers WHERE id = ?').get('copied'), undefined)
        console.log('Place references checks passed: isolated HTTP backend, legacy migration, CRUD validation/atomicity, coordinate precision, multi-process concurrency, auth, dataset copy, provider mocks, trips, MCP/AI.')
    } finally {
        globalThis.fetch = realFetch
        await new Promise<void>(resolve => server.close(() => resolve()))
        getDb().close()
        rmSync(temp, { recursive: true, force: true })
    }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
