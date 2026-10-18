import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const temp = mkdtempSync(path.join(tmpdir(), 'mapannai-bus-'))
process.env.SQLITE_PATH = path.join(temp, 'test.db')
async function main() {
    const { mapProviderFactory } = await import('../src/lib/map/providers/map-provider-factory')
    const { getSavedDirection } = await import('../src/lib/map/direction-service')
    const { getDb } = await import('../src/lib/db')
    const original = mapProviderFactory.createProvider
    const calls: string[] = []
    let success = 'driving', temporary = false
    mapProviderFactory.createProvider = provider => ({
        async getDirections(origin, destination, mode) {
            calls.push(`${provider}:${mode}`)
            if (temporary && mode === 'transit') throw new Error('temporary failure')
            if (mode !== success) throw new Error('NO_ROUTE')
            return { path: [origin, destination], distance: 1234, duration: 100 }
        },
    } as ReturnType<typeof original>)
    try {
        const origin = { lat: 35.6, lng: 139.7 }
        for (const [i, mode] of Array.from(['transit', 'driving', 'walking', 'none'].entries())) {
            success = mode; calls.length = 0
            const destination = { lat: 35.7, lng: 139.8 + i / 100 }
            const route = await getSavedDirection(origin, destination, undefined, undefined, 'bus')
            assert.deepEqual(calls, ['transit', 'driving', 'walking'].slice(0, mode === 'transit' ? 1 : mode === 'driving' ? 2 : 3).map(m => `google:${m}`))
            assert.equal(route.fallback, mode === 'none' ? 'NO_ROUTE' : undefined)
            const count = calls.length
            await getSavedDirection(origin, destination, undefined, undefined, 'bus')
            assert.equal(calls.length, count, 'final results cached')
        }
        temporary = true; success = 'none'
        const destination = { lat: 35.8, lng: 140 }
        assert.equal((await getSavedDirection(origin, destination, undefined, undefined, 'bus')).fallback, 'PLANNING_FAILED')
        temporary = false; success = 'transit'
        assert.equal((await getSavedDirection(origin, destination, undefined, undefined, 'bus')).fallback, undefined)
        success = 'walking'; calls.length = 0
        await getSavedDirection({ lat: 39.9, lng: 116.4 }, { lat: 39.95, lng: 116.45 }, undefined, undefined, 'bus')
        assert.deepEqual(calls, ['amap:transit','google:transit','amap:driving','google:driving','amap:walking'])
        console.log('Bus fallback order, regional providers, cache and retry passed')
    } finally { mapProviderFactory.createProvider = original; getDb().close(); rmSync(temp, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
