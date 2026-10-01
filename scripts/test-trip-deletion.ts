import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

async function main() {
    const directory = mkdtempSync(path.join(tmpdir(), 'mapannai-delete-'))
    process.env.SQLITE_PATH = path.join(directory, 'test.db')
    try {
        const service = await import('../src/lib/db/trip-service')
        const { upsertMarker, getMarkerById } = await import('../src/lib/db/marker-service')
        const now = new Date().toISOString()
        const trip = (id: string) => service.upsertTrip({ id, name: id, startDate: '2026-10-01', endDate: '2026-10-03', createdAt: now, updatedAt: now })
        const day = (id: string, tripId: string, markerIds: string[], chains: string[][] = []) => service.upsertTripDay({ id, tripId, date: `2026-10-0${id.endsWith('2') ? 2 : id.endsWith('3') ? 3 : 1}`, markerIds, chains })
        const marker = (id: string) => upsertMarker(id, 121, 31, { title: id })
        trip('a'); trip('b')
        for (const id of ['single', 'multiDay', 'multiTrip', 'chainOnly', 'unrelated']) marker(id)
        day('a1', 'a', ['single', 'multiDay', 'multiTrip'], [['single', 'single', 'chainOnly']])
        day('a2', 'a', ['multiDay'])
        day('a3', 'a', [])
        day('b1', 'b', ['multiTrip'])
        const deleted = service.removeTripDayAndCloseGap('a', 'a1', true)
        assert.deepEqual(new Set(deleted.deletedMarkerIds), new Set(['single', 'chainOnly']))
        assert.equal(getMarkerById('single'), null); assert.equal(getMarkerById('chainOnly'), null)
        for (const id of ['multiDay', 'multiTrip', 'unrelated']) assert(getMarkerById(id))
        assert.deepEqual(deleted.days.map(d => d.date), ['2026-10-01', '2026-10-02'])
        assert.equal(deleted.trip.endDate, '2026-10-02')
        assert.throws(() => service.removeTripDayAndCloseGap('b', 'b1', true), /至少保留/)
        assert(getMarkerById('multiTrip'), 'failed deletion must preserve markers')
        trip('c'); marker('cSingle'); marker('cShared'); marker('cOther')
        day('c1', 'c', ['cSingle', 'cShared', 'cOther'])
        day('c2', 'c', ['cShared'])
        day('b2', 'b', ['cOther'])
        const tripResult = service.deleteTrip('c', true)
        assert.deepEqual(tripResult.deletedMarkerIds, ['cSingle'])
        assert.equal(getMarkerById('cSingle'), null)
        assert(getMarkerById('cShared'), 'a marker used on two deleted days must still be kept')
        assert(getMarkerById('cOther'), 'other trip reference must be kept')
        assert.equal(service.getTripById('c'), null); assert.equal(service.getTripDays('c').length, 0)
        trip('d'); marker('defaultKept'); day('d1', 'd', ['defaultKept']); service.deleteTrip('d')
        assert(getMarkerById('defaultKept'), 'old calls preserve all markers by default')
        trip('e'); marker('dayDefaultKept'); day('e1', 'e', ['dayDefaultKept']); day('e2', 'e', [])
        service.removeTripDayAndCloseGap('e', 'e1')
        assert(getMarkerById('dayDefaultKept'))
        console.log('Trip deletion checks passed: day/trip exclusivity, multiple days within deleted trip, other trips, repeated chains, chain-only references, date shifting, failure preservation, and opt-in defaults.')
    } finally { rmSync(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
