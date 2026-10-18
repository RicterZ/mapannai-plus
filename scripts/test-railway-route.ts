import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { railwayPath } from '../src/lib/map/railway-route'
import { NextRequest } from 'next/server'
import { routeCacheKey } from '../src/lib/map/route-cache'

const temp = mkdtempSync(path.join(tmpdir(), 'mapannai-rail-'))
process.env.SQLITE_PATH = path.join(temp, 'test.db')
const a = { lat: 35, lng: 139 }, b = { lat: 35, lng: 139.02 }
const elements = [
    ...[139, 139.01, 139.02].map((lon, i) => ({ type: 'node', id: i + 1, lat: i === 1 ? 35.001 : 35, lon })),
    { type: 'way', nodes: [1, 2, 3], tags: { railway: 'rail' } },
]
async function main() {
    const route = railwayPath(elements, a, b)
    assert.equal(route.fallback, undefined)
    assert.equal(route.path[2].lat, 35.001)
    assert.ok(route.distance! > 1800)
    assert.equal(route.duration, null)
    assert.deepEqual(railwayPath(elements, b, a).path, [...route.path].reverse())
    assert.equal(railwayPath([], a, b).fallback, 'NO_ROUTE')
    assert.equal(railwayPath(elements, { lat: 36, lng: 139 }, b).fallback, 'NO_ROUTE')
    assert.equal(railwayPath([...elements.slice(0, 3), { type: 'way', nodes: [1, 2, 3], tags: { railway: 'rail', service: 'yard' } }], a, b).fallback, 'NO_ROUTE')
    const parallel = [
        ...elements,
        { type: 'node', id: 4, lat: 35, lon: 139.0199 },
        { type: 'node', id: 5, lat: 35, lon: 139.02 },
        { type: 'way', nodes: [4, 5], tags: { railway: 'rail' } },
    ]
    assert.equal(railwayPath(parallel, a, b).fallback, undefined, 'parallel disconnected nearest track must not hide a connected track')
    assert.equal(railwayPath(elements, { lat: 35.06, lng: 139 }, b).fallback, 'NO_ROUTE', 'places beyond 5km must not snap to distant tracks')
    const segment = { fromId: 'a', toId: 'b', origin: a, destination: b }
    assert.notEqual(routeCacheKey('regional-v1', { ...segment, transportMode: 'train' }), routeCacheKey('regional-v1', { ...segment, transportMode: 'bus' }))
    const original = globalThis.fetch
    globalThis.fetch = async () => { throw new Error('Offline routing must not access the network') }
    const { getSavedDirection } = await import('../src/lib/map/direction-service')
    const { getDb } = await import('../src/lib/db')
    const { POST } = await import('../src/app/api/directions/route')
    const { mapProviderFactory } = await import('../src/lib/map/providers/map-provider-factory')
    const createProvider = mapProviderFactory.createProvider
    const providerCalls: string[] = []
    let providerState: 'ok' | 'empty' | 'error' = 'empty'
    mapProviderFactory.createProvider = provider => ({
        ...createProvider.call(mapProviderFactory, provider),
        async getDirections(origin, destination) {
            providerCalls.push(provider)
            if (providerState === 'error') throw new Error('mock temporary failure')
            if (providerState === 'empty') throw new Error('NO_ROUTE')
            return { path: [origin, destination], distance: 12345, duration: 600 }
        },
    }) as ReturnType<typeof createProvider>
    const cases = [
        ['Sapporo-place-Asahikawa', { lat: 43.054690, lng: 141.354884 }, { lat: 43.762762, lng: 142.358510 }],
        ['Sapporo-place-Asahikawa-east', { lat: 43.054690, lng: 141.354884 }, { lat: 43.768971, lng: 142.479131 }],
        ['Beijing-Tianjin', { lat: 39.8652, lng: 116.3785 }, { lat: 39.1342, lng: 117.2093 }],
        ['Tokyo-Shinagawa', { lat: 35.6812, lng: 139.7671 }, { lat: 35.6285, lng: 139.7388 }],
        ['Kyoto-ShinOsaka', { lat: 34.9858, lng: 135.7588 }, { lat: 34.7335, lng: 135.5001 }],
        ['KaihinMakuhari-Akihabara', { lat: 35.6484, lng: 140.0419 }, { lat: 35.6984, lng: 139.7731 }],
    ] as const
    try {
        for (const [name, origin, destination] of cases) {
            const [route, shared] = await Promise.all([getSavedDirection(origin, destination, undefined, undefined, 'train'), getSavedDirection(origin, destination, undefined, undefined, 'train')])
            assert.equal(route.fallback, undefined, name)
            assert.ok(route.path.length > 10, name)
            assert.ok(route.distance! > 0, name)
            assert.deepEqual(route.path[0], origin)
            assert.deepEqual(route.path[route.path.length - 1], destination)
            assert.ok(route.path.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)))
            assert.equal(route.duration, null)
            assert.deepEqual(shared, route)
            assert.deepEqual(await getSavedDirection(origin, destination, undefined, undefined, 'train'), route)
            console.log(name, route.path.length, Math.round(route.distance!))
        }
        assert.equal(providerCalls.length, 0, 'offline paths never call map providers')
        const response = await POST(new NextRequest('http://localhost/api/directions', { method: 'POST', body: JSON.stringify({ origin: cases[0][1], destination: cases[0][2], transportMode: 'train' }) }))
        assert.equal(response.status, 200)
        assert.equal((await response.json()).duration, null)
        const missing = await getSavedDirection(a, b, undefined, undefined, 'train')
        assert.equal(missing.fallback, 'NO_ROUTE')
        assert.deepEqual(providerCalls, ['google'])
        const europe = { lat: 48.8566, lng: 2.3522 }, europe2 = { lat: 48.88, lng: 2.36 }
        providerState = 'ok'
        const online = await getSavedDirection(europe, europe2, undefined, undefined, 'train')
        assert.equal(online.distance, 12345)
        assert.equal(online.fallback, undefined)
        providerState = 'error'
        const failed = { lat: 48.85, lng: 2.35 }
        assert.equal((await getSavedDirection(failed, europe2, undefined, undefined, 'train')).fallback, 'PLANNING_FAILED')
        providerState = 'ok'
        assert.equal((await getSavedDirection(failed, europe2, undefined, undefined, 'train')).fallback, undefined, 'temporary errors remain retryable')
        providerState = 'empty'
        providerCalls.length = 0
        const china = await getSavedDirection({ lat: 28, lng: 101 }, { lat: 28.01, lng: 101.01 }, undefined, undefined, 'train')
        assert.equal(china.fallback, 'NO_ROUTE')
        assert.deepEqual(providerCalls, ['amap', 'google'], 'China falls back through AMap then Google')
        const crossBorder = await getSavedDirection({ lat: 39.9, lng: 116.4 }, b, undefined, undefined, 'train')
        assert.equal(crossBorder.fallback, 'UNSUPPORTED_REGION')
        console.log('Offline railway geometry, parallel tracks, cache, API and no-network checks passed')
    } finally { globalThis.fetch = original; mapProviderFactory.createProvider = createProvider; getDb().close() }
}
main().finally(() => rmSync(temp, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1 })
