import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import type { MapProvider, MapRoute } from '../src/types/map-provider'
import { isInChina } from '../src/lib/coord-transform'

const temp = mkdtempSync(path.join(tmpdir(), 'mapannai-regional-'))
process.env.SQLITE_PATH = path.join(temp, 'test.db')
async function main() {
    const { mapProviderFactory, searchServiceProvider } = await import('../src/lib/map/providers/map-provider-factory')
    const { getSavedDirection } = await import('../src/lib/map/direction-service')
    const { getDb } = await import('../src/lib/db')
    const { POST } = await import('../src/app/api/directions/route')
    const { POST: places } = await import('../src/app/api/places/route')
    const { routeCacheKey, getPlannedRoute, isRangeFallback } = await import('../src/lib/map/route-cache')
    const { routeDistance } = await import('../src/lib/map/route-mode')
    const previous = mapProviderFactory.createProvider
    const previousFetch = globalThis.fetch
    const calls: string[] = []
    let amap: 'ok' | 'empty' | 'error' = 'ok', google: 'ok' | 'empty' | 'error' = 'ok'
    const china = { lat: 39.9, lng: 116.4 }, china2 = { lat: 39.91, lng: 116.41 }
    const foreign = { lat: 35.6, lng: 139.7 }, foreign2 = { lat: 35.7, lng: 139.8 }
    mapProviderFactory.createProvider = provider => ({
        async getDirections(origin, destination) {
            calls.push(`${provider}:route`)
            const state = provider === 'amap' ? amap : google
            if (state === 'error') throw new Error('mock temporary error')
            if (state === 'empty') throw new Error('NO_ROUTE: mock empty')
            return { path: [origin, destination], distance: provider === 'amap' ? 1200 : 1500, duration: 300 }
        },
        async getPlaceDetails(coords) {
            calls.push(`${provider}:details`)
            const state = provider === 'amap' ? amap : google
            if (state === 'error') throw new Error('mock temporary error')
            return { coordinates: coords, name: state === 'empty' ? '未知地点' : provider, address: '' }
        },
        async searchPlacesPage(_query, _config, _country, options) {
            calls.push(`${provider}:search`)
            const state = provider === 'amap' ? amap : google
            if (state === 'error') throw new Error('mock temporary error')
            const page = options?.page ?? 1
            return { results: state === 'empty' ? [] : [{ name: provider, coordinates: { latitude: 0, longitude: 0 } }], page, pageSize: 20, hasMore: page === 1, nextPage: page === 1 ? 2 : null, ...(provider === 'google' ? { nextPageToken: 'mock-google-cursor' } : {}) }
        },
    } as MapProvider)
    const fresh = () => { getDb().prepare('DELETE FROM direction_cache').run(); calls.length = 0 }
    try {
        assert(isInChina(china.lng, china.lat)); assert(!isInChina(foreign.lng, foreign.lat))
        assert.equal((await getSavedDirection(china, china2)).distance, 1200)
        assert.deepEqual(calls, ['amap:route'])
        await getSavedDirection(china, china2); assert.equal(calls.length, 1)
        fresh()
        await Promise.all([getSavedDirection(foreign, foreign2), getSavedDirection(foreign, foreign2)])
        assert.deepEqual(calls, ['google:route'])
        for (const state of ['empty', 'error'] as const) {
            fresh(); amap = state; google = 'ok'
            assert.equal((await getSavedDirection(china, china2)).distance, 1500)
            assert.deepEqual(calls, ['amap:route', 'google:route'])
            await getSavedDirection(china, china2); assert.equal(calls.length, 2, 'fallback cached across both services')
        }
        fresh(); amap = 'empty'; google = 'empty'
        assert.equal((await getSavedDirection(china, china2)).fallback, 'NO_ROUTE')
        await getSavedDirection(china, china2); assert.equal(calls.length, 2)
        fresh(); amap = 'error'; google = 'empty'
        assert.equal((await getSavedDirection(china, china2)).fallback, 'PLANNING_FAILED')
        amap = 'ok'
        assert.equal((await getSavedDirection(china, china2)).distance, 1200, 'temporary primary failure remains retryable')
        fresh(); amap = 'empty'; google = 'error'
        const failed = await POST(new NextRequest('http://localhost/api/directions', { method: 'POST', body: JSON.stringify({ origin: china, destination: china2 }) }))
        assert.equal(failed.status, 500)
        google = 'ok'; assert.equal((await getSavedDirection(china, china2)).distance, 1500)
        fresh()
        for (const [origin, destination] of [[china, foreign], [foreign, china]]) {
            const route: MapRoute = await getSavedDirection(origin, destination, 'transit', 'google')
            assert.equal(route.fallback, 'UNSUPPORTED_REGION'); assert.equal(route.duration, null)
            assert.equal(route.distance, routeDistance(origin, destination)); assert.deepEqual(route.path, [origin, destination])
        }
        assert.equal(calls.length, 0, 'cross-border never contacts either service, including MCP override')
        const segment = { fromId: 'a', toId: 'b', origin: china, destination: foreign }
        assert.notEqual(routeCacheKey('regional-v1', segment), routeCacheKey('amap', segment), 'old local routes cannot hide new policy')
        globalThis.fetch = async (_input, init) => POST(new NextRequest('http://localhost/api/directions', { ...init, signal: init?.signal ?? undefined }))
        assert(isRangeFallback(await getPlannedRoute('regional-v1', segment)), 'existing client marks cross-border as dashed')
        assert.equal(calls.length, 0)
        amap = 'ok'
        const details = mapProviderFactory.createServiceProvider('details')
        assert.equal((await details.getPlaceDetails({ latitude: china.lat, longitude: china.lng })).name, 'amap')
        amap = 'empty'
        assert.equal((await details.getPlaceDetails({ latitude: china.lat, longitude: china.lng })).name, 'google')
        amap = 'error'
        assert.equal((await details.getPlaceDetails({ latitude: china.lat, longitude: china.lng })).name, 'google')
        calls.length = 0
        const response = await places(new NextRequest('http://localhost/api/places', { method: 'POST', body: JSON.stringify({ latitude: foreign.lat, longitude: foreign.lng }) }))
        assert.equal((await response.json()).data.name, 'google'); assert.deepEqual(calls, ['google:details'])
        const search = mapProviderFactory.createServiceProvider('search')
        amap = 'ok'; calls.length = 0
        await search.searchPlaces('北京', undefined, 'CN'); assert.deepEqual(calls, ['amap:search'])
        calls.length = 0
        await search.searchPlaces('Tokyo', undefined, 'JP'); assert.deepEqual(calls, ['google:search'])
        amap = 'empty'; calls.length = 0
        const first = await search.searchPlacesPage('北京', undefined, 'CN')
        assert.deepEqual(calls, ['amap:search', 'google:search'])
        amap = 'ok'; calls.length = 0
        await search.searchPlacesPage('北京', undefined, 'CN', { page: 2, pageToken: first.nextPageToken })
        assert.deepEqual(calls, ['google:search'], 'Google cursor survives recovery of AMap')
        amap = 'empty'; calls.length = 0
        await search.searchPlacesPage('北京', undefined, 'CN', { page: 2 })
        assert.deepEqual(calls, ['amap:search'], 'do not splice Google page 1 into AMap page 2')
        assert.equal(searchServiceProvider('CN', { bounds: { west: 139, east: 140, south: 35, north: 36 } }), 'google')
        const signal = AbortSignal.abort()
        amap = 'error'; calls.length = 0
        await assert.rejects(search.searchPlacesPage('北京', undefined, 'CN', { signal }))
        assert.deepEqual(calls, ['amap:search'], 'cancelled search never starts fallback')
        console.log('Regional services passed: domestic/foreign selection, empty/error fallback, shared cache/in-flight, retry, cross-border/client dashed fallback, details API, search pagination and cancellation. Provider mocks only.')
    } finally {
        mapProviderFactory.createProvider = previous
        globalThis.fetch = previousFetch
        getDb().close(); rmSync(temp, { recursive: true, force: true })
    }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
