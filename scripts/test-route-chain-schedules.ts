import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

const temp = mkdtempSync(path.join(tmpdir(), 'mapannai-chain-schedules-'))
process.env.SQLITE_PATH = path.join(temp, 'test.db')
const legacy = new Database(process.env.SQLITE_PATH)
legacy.exec(`CREATE TABLE trips(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT,start_date TEXT NOT NULL,end_date TEXT NOT NULL,cover_image TEXT,emoji TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE trip_days(id TEXT PRIMARY KEY,trip_id TEXT NOT NULL,date TEXT NOT NULL,title TEXT,marker_ids TEXT NOT NULL,chains TEXT NOT NULL);
INSERT INTO trips VALUES('trip','Trip',NULL,'2026-10-04','2026-10-05',NULL,NULL,'now','now');
INSERT INTO trip_days VALUES('day','trip','2026-10-04',NULL,'["a","b","c","d"]','[["a","b","c"],["a","b"]]');
INSERT INTO trip_days VALUES('day2','trip','2026-10-05',NULL,'[]','[]');`)
legacy.close()
async function main() {
    const { getDb } = await import('../src/lib/db')
    const { getDayById, upsertTripDay, moveTripStartDate, getTripById, editDayChain } = await import('../src/lib/db/trip-service')
    const { createRouteChain, updateRouteChain, deleteRouteChain } = await import('../src/lib/db/route-chain-service')
    const { upsertMarker, deleteMarker } = await import('../src/lib/db/marker-service')
    const { PATCH, GET, DELETE } = await import('../src/app/api/trips/[id]/days/[dayId]/chains/[chainId]/route')
    const { POST: create } = await import('../src/app/api/trips/[id]/days/[dayId]/chains/route')
    const { PUT: legacyPut } = await import('../src/app/api/trips/[id]/days/[dayId]/route')
    const { DELETE: removeDayMarker } = await import('../src/app/api/trips/[id]/days/[dayId]/markers/route')
    const { reconcileLegacyChains } = await import('../src/lib/trips/route-chain')
    const { connectPlanningTools } = await import('../src/lib/ai/mcp-tools')
    const req = (method: string, body: unknown = {}) => new NextRequest('http://localhost/api', { method, body: method === 'GET' ? undefined : JSON.stringify(body) })
    try {
        for (const id of ['a', 'b', 'c', 'd', 'e']) upsertMarker(id, 139, 35, { metadata: { id, title: id } })
        getDb().prepare('INSERT INTO direction_cache(cache_key,route_json,created_at) VALUES(?,?,?)').run('sentinel', '{"distance":123,"duration":456}', 'now')
        const markerBefore = getDb().prepare('SELECT * FROM markers WHERE id=?').get('a')
        const initial = getDayById('day')!
        assert.deepEqual(initial.chains, [['a', 'b', 'c'], ['a', 'b']])
        assert.equal(initial.routeChains!.length, 2)
        const [route, other] = initial.routeChains!
        assert.notEqual(route.id, other.id)
        assert.notEqual(route.stops[0].id, other.stops[0].id, 'same marker has independent visit IDs')
        assert.deepEqual(getDayById('day')!.routeChains, initial.routeChains, 'migration IDs must persist')
        assert.deepEqual(getDayById('day2')!.routeChains, [])
        const [a, b, c] = route.stops
        const target = { params: { id: 'trip', dayId: 'day', chainId: route.id } }
        let response: Response = await PATCH(req('PATCH', {
            stops: [{ stopId: a.id, startTime: '09:30', durationMinutes: 60, note: '南门取票' }],
            legs: [{ fromStopId: a.id, toStopId: b.id, mode: 'subway', serviceNumber: '银座线', startTime: '10:40', durationMinutes: 15, note: '1号入口，往涩谷方向' }],
        }), target)
        assert.equal(response.status, 200)
        let saved = getDayById('day')!.routeChains![0]
        assert.equal(saved.stops[0].startTime, '09:30')
        assert.equal(saved.stops[0].durationMinutes, 60)
        assert.equal(saved.legs[0].serviceNumber, '银座线')
        assert.equal(saved.legs[0].note, '1号入口，往涩谷方向')
        assert.deepEqual(getDayById('day')!.routeChains![1], other, 'another chain untouched')
        for (const [mode, serviceNumber] of [['bus','101'],['train','G123'],['flight','NH920'],['ferry','船班A']] as const) {
            updateRouteChain('trip', 'day', route.id, { legs: [{ fromStopId: a.id, toStopId: b.id, mode, serviceNumber }] })
            assert.equal(getDayById('day')!.routeChains![0].legs[0].serviceNumber, serviceNumber)
        }
        saved = getDayById('day')!.routeChains![0]
        assert.equal(saved.legs[0].durationMinutes, 15, 'omitted fields preserved')
        updateRouteChain('trip', 'day', route.id, { stops: [{ stopId: a.id, startTime: null, durationMinutes: 0 }], legs: [{ fromStopId: a.id, toStopId: b.id, serviceNumber: null, note: '  ' }] })
        saved = getDayById('day')!.routeChains![0]
        assert.equal(saved.stops[0].startTime, undefined)
        assert.equal(saved.stops[0].durationMinutes, 0)
        assert.equal(saved.legs[0].serviceNumber, undefined)
        assert.equal(saved.legs[0].note, undefined)
        const beforeInvalid = getDayById('day')!
        const invalid = [
            { stops: [{ stopId: a.id, startTime: '24:00' }] },
            { stops: [{ stopId: a.id, durationMinutes: -1 }] },
            { stops: [{ stopId: a.id, durationMinutes: 1.5 }] },
            { stops: [{ stopId: other.stops[0].id, note: 'wrong route' }] },
            { stops: [{ stopId: a.id, note: 'one' }, { stopId: a.id, note: 'two' }] },
            { legs: [{ fromStopId: b.id, toStopId: a.id, mode: 'taxi' }] },
            { legs: [{ fromStopId: a.id, toStopId: c.id, mode: 'train' }] },
            { legs: [{ fromStopId: b.id, toStopId: c.id, serviceNumber: 'G123' }] },
            { legs: [{ fromStopId: a.id, toStopId: b.id, mode: 'teleport' }] },
            { legs: [{ fromStopId: a.id, toStopId: b.id, remove: true, note: 'bad' }] },
            { markerIds: ['a', 'a'] }, { markerIds: ['a', 'missing'] },
            { stops: [{ stopId: a.id, note: 'must roll back' }], legs: [{ fromStopId: c.id, toStopId: a.id, mode: 'bus' }] },
            { legs: [{ fromStopId: a.id, toStopId: b.id, serviceNumber: 123 }] },
            { stops: [{ stopId: a.id, duration: 12 }] },
        ]
        for (const patch of invalid) {
            const result = await PATCH(req('PATCH', patch), target)
            assert.equal(result.status, 400, JSON.stringify(patch))
            assert.deepEqual(getDayById('day'), beforeInvalid, 'invalid edits must be atomic')
        }
        assert.equal((await PATCH(req('PATCH', { stops: [{ stopId: a.id, note: 'x' }] }), { params: { ...target.params, id: 'wrong' } })).status, 400)
        assert.equal((await GET(req('GET'), { params: { ...target.params, chainId: 'missing' } })).status, 404)
        // Title/date/membership legacy writes cannot overwrite metadata with stale projections.
        response = await legacyPut(req('PUT', { title: 'Updated' }), { params: { id: 'trip', dayId: 'day' } })
        assert.equal(response.status, 200)
        assert.deepEqual((await response.json()).routeChains, beforeInvalid.routeChains)
        response = await legacyPut(req('PUT', { chains: [initial.chains[1], initial.chains[0]] }), { params: { id: 'trip', dayId: 'day' } })
        assert.equal(response.status, 200)
        assert.equal(getDayById('day')!.routeChains![1].id, route.id, 'route metadata follows reordered route')
        updateRouteChain('trip', 'day', route.id, { markerIds: ['c', 'a', 'b', 'd'] })
        saved = getDayById('day')!.routeChains!.find(item => item.id === route.id)!
        assert.equal(saved.stops[1].id, a.id)
        assert.equal(saved.stops[1].durationMinutes, 0)
        assert.equal(saved.legs.length, 1, 'unchanged A->B retained')
        updateRouteChain('trip', 'day', route.id, { markerIds: ['c', 'b', 'a', 'd'] })
        saved = getDayById('day')!.routeChains!.find(item => item.id === route.id)!
        assert.equal(saved.legs.length, 0, 'reverse direction is not inherited')
        // Return to original order; removed settings are not resurrected.
        updateRouteChain('trip', 'day', route.id, { markerIds: ['a', 'b', 'c'] })
        assert.equal(getDayById('day')!.routeChains!.find(item => item.id === route.id)!.legs.length, 0)
        updateRouteChain('trip', 'day', route.id, { legs: [{ fromStopId: a.id, toStopId: b.id, mode: 'bus', serviceNumber: '101' }] })
        updateRouteChain('trip', 'day', route.id, { legs: [{ fromStopId: a.id, toStopId: b.id, remove: true }] })
        assert.equal(getDayById('day')!.routeChains!.find(item => item.id === route.id)!.legs.length, 0)
        moveTripStartDate(getTripById('trip')!, '2026-11-01')
        assert.equal(getDayById('day')!.date, '2026-11-01')
        assert.equal(getDayById('day')!.routeChains!.find(item => item.id === route.id)!.stops[0].durationMinutes, 0)
        // Legacy route writes still preserve visit metadata, and route index tool targets one known route.
        let day = getDayById('day')!
        const index = day.routeChains!.findIndex(item => item.id === route.id)
        editDayChain('trip', 'day', index, ['a', 'b', 'd'])
        saved = getDayById('day')!.routeChains![index]
        assert.equal(saved.id, route.id)
        assert.equal(saved.stops[0].durationMinutes, 0)
        const created = await create(req('POST', { markerIds: ['d', 'e'] }), { params: { id: 'trip', dayId: 'day' } })
        assert.equal(created.status, 201)
        const newRoute = await created.json()
        assert(newRoute.id && newRoute.stops.every((stop: { id: string }) => stop.id))
        assert(getDayById('day')!.markerIds.includes('e'))
        // Real MCP schemas must preserve nullable fields and expose independent serviceNumber.
        const bridge = await connectPlanningTools()
        try {
            const update = bridge.tools.find(tool => tool.function.name === 'update_day_chain')!
            assert(JSON.stringify(update.function.parameters).includes('serviceNumber'))
            const result = await bridge.call('update_day_chain', { tripId: 'trip', dayId: 'day', chainId: route.id, stops: [{ stopId: a.id, durationMinutes: 45 }], legs: [{ fromStopId: a.id, toStopId: b.id, mode: 'train', serviceNumber: 'G123', note: '3号站台' }] }, new AbortController().signal)
            assert(!result.isError)
            saved = getDayById('day')!.routeChains!.find(item => item.id === route.id)!
            assert.equal(saved.legs[0].serviceNumber, 'G123')
            assert.equal(saved.stops[0].durationMinutes, 45)
            const cleared = await bridge.call('update_day_chain', { tripId: 'trip', dayId: 'day', chainId: route.id, legs: [{ fromStopId: a.id, toStopId: b.id, serviceNumber: null }] }, new AbortController().signal)
            assert(!cleared.isError)
            assert.equal(getDayById('day')!.routeChains!.find(item => item.id === route.id)!.legs[0].serviceNumber, undefined)
            const deleted = await bridge.call('delete_day_chain', { tripId: 'trip', dayId: 'day', chainId: newRoute.id }, new AbortController().signal)
            assert(!deleted.isError)
        } finally { await bridge.close() }
        // Removing a day member and deleting a global marker clean visits/legs, not unrelated settings.
        await removeDayMarker(req('DELETE', { markerId: 'b' }), { params: { id: 'trip', dayId: 'day' } })
        day = getDayById('day')!
        saved = day.routeChains!.find(item => item.id === route.id)!
        assert.deepEqual(saved.stops.map(stop => stop.markerId), ['a','d'])
        assert.equal(saved.legs.length, 0)
        assert.equal(saved.stops[0].durationMinutes, 45)
        deleteMarker('d')
        saved = getDayById('day')!.routeChains!.find(item => item.id === route.id)!
        assert.deepEqual(saved.stops.map(stop => stop.markerId), ['a'])
        assert.equal(saved.stops[0].durationMinutes, 45)
        const raw = getDb().prepare('SELECT chains, route_chains FROM trip_days WHERE id=?').get('day') as { chains: string; route_chains: string }
        assert.deepEqual(JSON.parse(raw.chains), JSON.parse(raw.route_chains).map((item: {stops: {markerId: string}[]}) => item.stops.map(stop=>stop.markerId)))
        assert.equal((await DELETE(req('DELETE'), target)).status, 200)
        assert(getDayById('day')!.markerIds.includes('a'), 'deleting route preserves day membership')
        assert.equal((await DELETE(req('DELETE'), target)).status, 400)
        // Ambiguous old writers may not silently swap schedules across routes.
        const r1 = createRouteChain('trip','day',['a','c']).route
        const r2 = createRouteChain('trip','day',['a','e']).route
        updateRouteChain('trip','day',r1.id,{stops:[{stopId:r1.stops[0].id,note:'one'}]})
        updateRouteChain('trip','day',r2.id,{stops:[{stopId:r2.stops[0].id,note:'two'}]})
        assert.throws(()=>reconcileLegacyChains(getDayById('day')!.routeChains!.filter(r=>[r1.id,r2.id].includes(r.id)),[['a','b']]), /chainId/)
        // New IDs persist even after closing/reopening the DB (no random ID generation on read).
        assert.deepEqual(getDb().prepare('SELECT * FROM markers WHERE id=?').get('a'), markerBefore, 'visit schedule must not modify global marker')
        assert.equal((getDb().prepare('SELECT route_json FROM direction_cache WHERE cache_key=?').get('sentinel') as {route_json:string}).route_json, '{"distance":123,"duration":456}', 'planned duration must not overwrite provider cache')
        const stored = getDayById('day')!.routeChains
        const second = new Database(process.env.SQLITE_PATH!)
        assert.deepEqual(JSON.parse((second.prepare('SELECT route_chains FROM trip_days WHERE id=?').get('day') as {route_chains:string}).route_chains), stored)
        second.close()
        console.log('Route chain schedules passed: migration, stable IDs, Web/MCP patches, dedicated service number, validation/rollback, legacy writes, reordered routes, adjacent leg cleanup, marker deletion, persistence.')
    } finally { getDb().close(); rmSync(temp, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
