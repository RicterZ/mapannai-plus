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
    const segment = { fromId: 'a', toId: 'b', origin: a, destination: b }
    assert.notEqual(routeCacheKey('regional-v1', { ...segment, transportMode: 'train' }), routeCacheKey('regional-v1', { ...segment, transportMode: 'bus' }))
    const original = globalThis.fetch
    let calls = 0, fail = false
    globalThis.fetch = async () => {
        calls++
        if (fail) return new Response('', { status: 429 })
        return Response.json({ elements })
    }
    const { getSavedDirection } = await import('../src/lib/map/direction-service')
    const { getDb } = await import('../src/lib/db')
    const { POST } = await import('../src/app/api/directions/route')
    try {
        const results = await Promise.all([getSavedDirection(a, b, undefined, undefined, 'train'), getSavedDirection(a, b, undefined, undefined, 'train')])
        assert.equal(results[0].fallback, undefined)
        assert.equal(calls, 1)
        await getSavedDirection(a, b, undefined, undefined, 'train')
        assert.equal(calls, 1)
        fail = true
        assert.equal((await getSavedDirection(b, a, undefined, undefined, 'train')).fallback, 'PLANNING_FAILED')
        fail = false
        assert.equal((await getSavedDirection(b, a, undefined, undefined, 'train')).fallback, undefined)
        assert.equal(calls, 3)
        const response = await POST(new NextRequest('http://localhost/api/directions', { method: 'POST', body: JSON.stringify({ origin: a, destination: b, transportMode: 'train' }) }))
        assert.equal(response.status, 200)
        assert.equal((await response.json()).duration, null)
        assert.equal(calls, 3, 'Web API shares railway cache')
        const crossBorder = await getSavedDirection({ lat: 39.9, lng: 116.4 }, b, undefined, undefined, 'train')
        assert.equal(crossBorder.fallback, 'UNSUPPORTED_REGION')
        assert.equal(calls, 3, 'cross-border route never queries OSM')
        globalThis.fetch = async () => { calls++; return Response.json({ elements: [] }) }
        const missing = { lat: 35.1, lng: 139 }
        assert.equal((await getSavedDirection(missing, b, undefined, undefined, 'train')).fallback, 'NO_ROUTE')
        assert.equal((await getSavedDirection(missing, b, undefined, undefined, 'train')).fallback, 'NO_ROUTE')
        assert.equal(calls, 4, 'coverage failure is cached')
        console.log('Railway geometry, cache isolation, shared requests and retry checks passed')
    } finally { globalThis.fetch = original; getDb().close() }
}
main().finally(() => rmSync(temp, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1 })
