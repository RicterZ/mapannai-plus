import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { execFileSync } from 'node:child_process'

async function main() {
    const directory = mkdtempSync(path.join(tmpdir(), 'mapannai-trip-notes-'))
    process.env.SQLITE_PATH = path.join(directory, 'legacy.db')
    // Begin with a legacy schema and real rich content; runtime migration must preserve it.
    const legacy = new Database(process.env.SQLITE_PATH)
    legacy.exec(`CREATE TABLE markers (id TEXT PRIMARY KEY, longitude REAL, latitude REAL, title TEXT, address TEXT, header_image TEXT, icon_type TEXT, markdown_content TEXT, description TEXT, created_at TEXT, updated_at TEXT);
        INSERT INTO markers VALUES ('venue',140,35,'幕张展览馆',NULL,NULL,'activity','<p>FF14</p><img src="https://images.example/ticket.jpg">',NULL,'2026-01-01','2026-01-01');`)
    legacy.exec(`CREATE TABLE trip_marker_notes (trip_id TEXT REFERENCES trips(id) ON DELETE CASCADE, marker_id TEXT REFERENCES markers(id) ON DELETE CASCADE, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY(trip_id, marker_id))`)
    legacy.close()
    try {
        const trips = await import('../src/lib/db/trip-service')
        const markers = await import('../src/lib/db/marker-service')
        const notes = await import('../src/lib/db/trip-marker-note-service')
        const { getDb } = await import('../src/lib/db')
        const now = new Date().toISOString()
        const trip = (id: string) => trips.upsertTrip({ id, name: id, startDate: '2026-10-01', endDate: '2026-10-02', createdAt: now, updatedAt: now })
        const day = (id: string, tripId: string, ids: string[]) => trips.upsertTripDay({ id, tripId, date: '2026-10-01', markerIds: ids, chains: [] })
        trip('ff14'); trip('ba')
        const backup = path.join(directory, 'before.db')
        const checker = path.resolve('scripts/check-trip-marker-notes-migration.cjs')
        assert.match(execFileSync(process.execPath, [checker, '--backup', backup], { encoding: 'utf8' }), /\"integrity\":\"ok\"/)
        assert.throws(() => execFileSync(process.execPath, [checker, '--backup', backup], { stdio: 'pipe' }), /Command failed/)
        assert.match(execFileSync(process.execPath, [checker], { encoding: 'utf8' }), /\"tripNoteTable\":true/)
        assert((getDb().prepare('PRAGMA table_info(trip_marker_notes)').all() as { name: string }[]).some(column => column.name === 'header_image'), 'existing note table adds cover without destructive migration')
        const original = markers.getMarkerById('venue')!
        assert(original.properties.markdownContent.includes('<img'))
        trips.setTripMarker('ff14', 'venue', true)
        notes.copyPlaceNoteToTrip('ff14', 'venue', null)
        const ff14 = notes.getTripMarkerNote('ff14', 'venue')!
        assert.equal(ff14.content, original.properties.markdownContent)
        assert.equal(markers.getMarkerById('venue')!.properties.markdownContent, original.properties.markdownContent)
        const ba = notes.updateTripMarkerNote('ba', 'venue', { title: 'BA粉丝节', content: '<p>BA</p>', expectedUpdatedAt: null })!
        assert.equal(notes.getTripMarkerNote('ff14', 'venue')!.content, ff14.content)
        assert.throws(() => notes.updateTripMarkerNote('ba', 'venue', { title: 'stale', expectedUpdatedAt: null }), /已被修改/)
        assert.throws(() => notes.copyPlaceNoteToTrip('ba', 'venue', ba.updatedAt), /已有笔记/)
        assert.throws(() => notes.updateTripMarkerNote('missing', 'venue', { content: 'x' }), /旅行不存在/)
        assert.throws(() => notes.updateTripMarkerNote('ba', 'missing', { content: 'x' }), /地点不存在/)
        for (const input of [{ unknown: 1 }, { title: 42 }, { content: 'x'.repeat(500001) }]) assert.throws(() => notes.updateTripMarkerNote('ba', 'venue', input), /字段无效/)
        notes.updateTripMarkerNote('ba', 'venue', { headerImage: 'https://images.example/ba-cover.jpg' })
        notes.updateTripMarkerNote('ba', 'venue', { title: null })
        assert.equal(notes.getTripMarkerNote('ba', 'venue')!.headerImage, 'https://images.example/ba-cover.jpg', 'old updates preserve trip cover')
        assert.throws(() => notes.updateTripMarkerNote('ba', 'venue', { headerImage: 'javascript:alert(1)' }), /字段无效/)
        notes.updateTripMarkerNote('ba', 'venue', { headerImage: null })
        assert.equal(notes.getTripMarkerNote('ba', 'venue')!.content, ba.content)
        day('ff1', 'ff14', ['venue']); day('ff2', 'ff14', [])
        assert.equal(trips.getTripById('ff14')!.markerIds!.length, 0)
        assert.equal(trips.getTripById('ff14')!.markerNotes!.length, 1)
        const { createRouteChain } = await import('../src/lib/db/route-chain-service')
        markers.upsertMarker('other', 140.1, 35.1, { title: 'other' })
        const { route } = createRouteChain('ff14', 'ff1', ['venue', 'other', 'venue'])
        assert.notEqual(route.stops[0].id, route.stops[2].id)
        trips.removeTripDayAndCloseGap('ff14', 'ff1', true)
        assert(markers.getMarkerById('venue'), 'retained note protects marker when deleting last day membership')
        assert(notes.getTripMarkerNote('ff14', 'venue'))
        trips.upsertTrip({ ...trips.getTripById('ff14')!, name: 'legacy update', markerNotes: undefined })
        assert.equal(trips.getTripById('ff14')!.markerNotes!.length, 1, 'legacy writes preserve notes')
        const { PATCH, POST, GET } = await import('../src/app/api/trips/[id]/markers/[markerId]/note/route')
        const { NextRequest } = await import('next/server')
        const context = { params: { id: 'ba', markerId: 'venue' } }
        const request = (body: unknown) => new NextRequest('http://localhost/api/trips/ba/markers/venue/note', { method: 'PATCH', body: JSON.stringify(body) })
        assert.equal((await PATCH(request({ expectedUpdatedAt: null, content: 'stale' }), context)).status, 409)
        assert.equal((await PATCH(request({ bad: true }), context)).status, 400)
        assert.equal((await POST(request({ expectedUpdatedAt: null }), context)).status, 409)
        assert.equal((await GET(request({}), context)).status, 200)
        const { createMcpServer } = await import('../src/lib/mcp/server')
        const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
        const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
        const server = createMcpServer(); const client = new Client({ name: 'notes-test', version: '1' })
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
        const result = await client.callTool({ name: 'update_trip_marker_note', arguments: { tripId: 'ba', markerId: 'venue', title: 'BA', content: '<p>updated</p>' } })
        assert(!result.isError)
        const read = await client.callTool({ name: 'get_trip_marker_note', arguments: { tripId: 'ba', markerId: 'venue' } })
        assert(JSON.stringify(read).includes('updated'))
        day('ba1', 'ba', [])
        const { mapProviderFactory } = await import('../src/lib/map/providers')
        const originalProvider = mapProviderFactory.createServiceProvider
        mapProviderFactory.createServiceProvider = () => ({ searchPlaces: async (name: string) => [{
            name, coordinates: name === 'invalid-new-place' ? { longitude: 141, latitude: 36 } : { longitude: 140, latitude: 35 },
        }], searchPlacesPage: async () => { throw new Error('Unexpected pagination') },
            getPlaceDetails: async () => { throw new Error('Unexpected details') },
            getDirections: async () => { throw new Error('Unexpected directions') },
        })
        try {
            const planned = await client.callTool({ name: 'plan_trip_day', arguments: { tripId: 'ba', dayId: 'ba1', country: 'JP',
                places: [{ name: 'venue', iconType: 'activity', content: '<p>conflicting</p>' }] } })
            assert(!planned.isError)
            const payload = JSON.parse((planned.content as Array<{ text: string }>)[0].text)
            assert.equal(payload.results[0].id, 'venue')
            assert.equal(payload.results[0].status, 'existing')
            assert.match(payload.results[0].noteWarning, /已加入/)
            assert(trips.getDayById('ba1')!.markerIds.includes('venue'))
            assert.equal(notes.getTripMarkerNote('ba', 'venue')!.content, '<p>updated</p>')
            const beforeCount = markers.getAllMarkers().features.length
            const failed = await client.callTool({ name: 'plan_trip_day', arguments: { tripId: 'ba', dayId: 'ba1', country: 'JP',
                places: [{ name: 'invalid-new-place', iconType: 'activity', content: 'x'.repeat(500001) }] } })
            const failedPayload = JSON.parse((failed.content as Array<{ text: string }>)[0].text)
            assert.equal(failedPayload.results[0].id, null)
            assert.equal(markers.getAllMarkers().features.length, beforeCount, 'failed content write rolls back a new marker')
            assert.deepEqual(trips.getDayById('ba1')!.markerIds, ['venue'], 'failed content write rolls back membership')
        } finally { mapProviderFactory.createServiceProvider = originalProvider }
        await client.close(); await server.close()
        const { deletedMarkerIds } = trips.deleteTrip('ff14', true)
        assert(!deletedMarkerIds.includes('venue'), 'another trip note protects marker with no day or pending membership')
        assert(markers.getMarkerById('venue')); assert(notes.getTripMarkerNote('ba', 'venue'))
        assert.equal(notes.getTripMarkerNote('ff14', 'venue'), null)
        notes.updateTripMarkerNote('ba', 'venue', { title: null, content: '<p></p>' })
        assert.equal(notes.getTripMarkerNote('ba', 'venue'), null)
        notes.updateTripMarkerNote('ba', 'venue', { content: 'retained' })
        markers.deleteMarker('venue')
        assert.equal(notes.getTripMarkerNote('ba', 'venue'), null, 'global deletion cascades')
        assert.equal(getDb().prepare('PRAGMA foreign_key_check').all().length, 0)
        console.log('Trip note checks passed: legacy migration, rich text copy, isolation, CAS, validation, retained references, repeat visits, Web/MCP, deletion and foreign keys.')
        getDb().close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
