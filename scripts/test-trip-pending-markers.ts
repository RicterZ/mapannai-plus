import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { NextRequest } from 'next/server'

const temp = mkdtempSync(path.join(tmpdir(), 'mapannai-pending-'))
process.env.SQLITE_PATH = path.join(temp, 'test.db')
// A pre-migration database, with a trip that must survive adding the column.
const legacy = new Database(process.env.SQLITE_PATH)
legacy.exec(`CREATE TABLE trips (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, start_date TEXT NOT NULL, end_date TEXT NOT NULL, cover_image TEXT, emoji TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
INSERT INTO trips VALUES ('legacy','Legacy',NULL,'2026-10-03','2026-10-03',NULL,NULL,'now','now');`)
legacy.close()
async function main() {
    const service = await import('../src/lib/db/trip-service')
    const { upsertMarker, deleteMarker, getMarkerById } = await import('../src/lib/db/marker-service')
    const { getDb } = await import('../src/lib/db')
    const { POST } = await import('../src/app/api/trips/[id]/markers/route')
    const { POST: assignDay } = await import('../src/app/api/trips/[id]/days/[dayId]/markers/route')
    const { connectPlanningTools } = await import('../src/lib/ai/mcp-tools')
    try {
        assert.deepEqual(service.getTripById('legacy')?.markerIds, [])
        const trip = { ...service.getTripById('legacy')!, id: 'trip-a', name: 'Pending' }
        service.upsertTrip(trip)
        service.upsertTrip({ ...trip, id: 'trip-b' })
        service.upsertTripDay({ id: 'day-a', tripId: trip.id, date: trip.startDate, markerIds: [], chains: [] })
        for (const id of ['a', 'b', 'c', 'd']) upsertMarker(id, 139, 35, { metadata: { id, title: id } })
        const bridge = await connectPlanningTools()
        try {
            const result = await bridge.call('assign_marker_to_trip', { tripId: trip.id, markerId: 'a' }, new AbortController().signal)
            assert(!result.isError)
            assert.deepEqual(service.getTripById(trip.id)?.markerIds, ['a'])
        } finally { await bridge.close() }
        service.setTripMarker('trip-b', 'a', true)
        service.setTripMarker(trip.id, 'a', true)
        assert.deepEqual(service.getTripById(trip.id)?.markerIds, ['a'], 'membership is idempotent')
        assert.throws(() => service.setTripMarker(trip.id, 'missing', true))
        assert.throws(() => service.setTripMarker('missing', 'a', true))
        const request = (markerId: string) => new NextRequest('http://localhost/api/trips/trip-a/markers', { method: 'POST', body: JSON.stringify({ markerId }) })
        assert.equal((await POST(request('b'), { params: { id: trip.id } })).status, 200)
        assert.equal((await assignDay(request('a'), { params: { id: trip.id, dayId: 'day-a' } })).status, 200)
        assert.deepEqual(service.getTripById(trip.id)?.markerIds, ['b'])
        assert.deepEqual(service.getDayById('day-a')?.markerIds, ['a'])
        assert.deepEqual(service.getDayById('day-a')?.chains, [], 'assignment does not create a chain')
        assert.deepEqual(service.getTripById('trip-b')?.markerIds, ['a'], 'other trip unaffected')
        assert.throws(() => service.setTripMarker(trip.id, 'a', true), /分配/)
        assert.equal((await assignDay(request('b'), { params: { id: 'trip-b', dayId: 'day-a' } })).status, 404)
        assert.deepEqual(service.getTripById(trip.id)?.markerIds, ['b'])
        // Daily chains and day saves use the same pool-pruning rule, with rollback.
        assert.throws(() => service.upsertTripDay({ ...service.getDayById('day-a')!, markerIds: ['b'], date: null as unknown as string }))
        assert.deepEqual(service.getTripById(trip.id)?.markerIds, ['b'])
        service.upsertTripDay({ ...service.getDayById('day-a')!, markerIds: ['a', 'b'], chains: [['a', 'b']] })
        assert.deepEqual(service.getTripById(trip.id)?.markerIds, [])
        service.setTripMarker(trip.id, 'c', true)
        deleteMarker('c')
        assert.deepEqual(service.getTripById(trip.id)?.markerIds, [], 'delete cleans trip references')
        service.setTripMarker(trip.id, 'd', true)
        service.setTripMarker(trip.id, 'd', false)
        assert(getMarkerById('d'), 'removing membership preserves marker')
        service.setTripMarker(trip.id, 'd', true)
        // Legacy clients updating the trip without the new field retain the pool.
        service.upsertTrip({ ...trip, markerIds: undefined, name: 'Renamed' })
        assert.deepEqual(service.getTripById(trip.id)?.markerIds, ['d'])
        const deleted = service.deleteTrip(trip.id, true)
        assert.deepEqual(deleted.deletedMarkerIds.sort(), ['b', 'd'])
        assert(getMarkerById('a'), 'shared with another trip: do not delete')
        assert(!getMarkerById('b') && !getMarkerById('d'))
        console.log('Trip pending markers passed: migration, Web/MCP assignment, no chain, rollback, shared membership, deletion, legacy writes.')
    } finally { getDb().close(); rmSync(temp, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
