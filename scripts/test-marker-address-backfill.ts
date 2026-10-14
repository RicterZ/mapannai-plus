import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { wgs84ToGcj02 } from '../src/lib/coord-transform'

async function main() {
    const directory = mkdtempSync(path.join(tmpdir(), 'mapannai-address-'))
    process.env.SQLITE_PATH = path.join(directory, 'test.db')
    process.env.AMAP_API_KEY = 'mock-amap'
    process.env.GOOGLE_API_KEY = 'mock-google'
    const originalFetch = globalThis.fetch
    const { getDb } = await import('../src/lib/db')
    const { backfillMarkerAddresses } = await import('../src/lib/db/marker-address-backfill')
    const db = getDb()
    try {
        const insert = db.prepare(`INSERT INTO markers (id, longitude, latitude, address, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'before', 'before')`)
        insert.run('china', 116.4, 39.9, null)
        insert.run('fallback', 116.5, 39.9, '')
        insert.run('foreign', 139.7, 35.6, ' \n\t')
        insert.run('edited', 139.8, 35.6, null)
        insert.run('moved', 139.9, 35.6, null)
        insert.run('failed', 140, 35.6, null)
        insert.run('existing', 140.1, 35.6, 'keep')
        insert.run('invalid', 200, 35.6, null)
        const calls: URL[] = []
        const china = wgs84ToGcj02(116.4, 39.9)
        const fallback = wgs84ToGcj02(116.5, 39.9)
        globalThis.fetch = async input => {
            const url = new URL(String(input))
            calls.push(url)
            if (url.pathname.endsWith('/regeo')) {
                const location = url.searchParams.get('location')
                assert([`${china.longitude},${china.latitude}`, `${fallback.longitude},${fallback.latitude}`].includes(location!))
                return Response.json({ status: '1', regeocode: { formatted_address: location === `${china.longitude},${china.latitude}` ? '中国地址' : '' } })
            }
            assert(url.pathname.endsWith('/geocode/json'))
            const latlng = url.searchParams.get('latlng')
            assert([`${fallback.latitude},${fallback.longitude}`, '35.6,139.7', '35.6,139.8', '35.6,139.9', '35.6,140'].includes(latlng!))
            if (latlng === '35.6,139.8') db.prepare("UPDATE markers SET address = 'manual' WHERE id = 'edited'").run()
            if (latlng === '35.6,139.9') db.prepare("UPDATE markers SET longitude = 141 WHERE id = 'moved'").run()
            return Response.json({ status: 'OK', results: latlng === '35.6,140' ? [] : [{ formatted_address: 'Google address' }] })
        }
        await backfillMarkerAddresses()
        const row = (id: string) => db.prepare('SELECT * FROM markers WHERE id = ?').get(id) as any
        assert.equal(row('china').address, '中国地址')
        assert.equal(row('fallback').address, 'Google address')
        assert.equal(row('foreign').address, 'Google address')
        assert.equal(row('edited').address, 'manual')
        assert.equal(row('moved').address, null)
        assert.equal(row('failed').address, null)
        assert.equal(row('existing').address, 'keep')
        assert.equal(row('invalid').address, null)
        assert.equal(row('china').longitude, 116.4)
        assert.equal(row('china').place_references, null)
        assert.equal(calls.length, 7)
        console.log('Marker address backfill checks passed')
    } finally {
        globalThis.fetch = originalFetch
        db.close()
        rmSync(directory, { recursive: true, force: true })
    }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
