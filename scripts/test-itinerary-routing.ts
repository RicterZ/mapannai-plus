import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveRouteMode, routeTransportMode } from '../src/lib/map/route-mode'
import { newRouteChain, reorderRouteStops } from '../src/lib/trips/route-chain'
import { calculateDistance } from '../src/utils/distance'
import type { TransportMode } from '../src/types/trip'

const temp = mkdtempSync(path.join(tmpdir(), 'mapannai-routing-'))
process.env.SQLITE_PATH = path.join(temp, 'test.db')
process.env.GOOGLE_API_KEY = 'mock-only'
process.env.AMAP_API_KEY = 'mock-only'
process.env.GOOGLE_API_BASE_URL = 'https://maps.googleapis.com'
process.env.AMAP_API_BASE_URL = 'https://restapi.amap.com'
process.env.MAP_DIRECTIONS_PROVIDER = 'amap'
const origin = { lat: 39.9, lng: 116.4 }, destination = { lat: 39.901, lng: 116.401 }
const far = { lat: 40, lng: 117 }
async function main() {
    const { POST } = await import('../src/app/api/directions/route')
    const { getSavedDirection } = await import('../src/lib/map/direction-service')
    const { directionCacheKey, cacheDirection, getCachedDirection } = await import('../src/lib/db/direction-cache')
    const { getDb } = await import('../src/lib/db')
    const { connectPlanningTools } = await import('../src/lib/ai/mcp-tools')
    const { routeCacheKey, getPlannedRoute, isRangeFallback, readRouteMetrics } = await import('../src/lib/map/route-cache')
    Object.assign(globalThis, { React }) // tsx uses classic JSX for this repo's preserve setting.
    const { RouteLeg } = await import('../src/components/trips/route-schedule')
    const { useMapStore } = await import('../src/store/map-store')
    const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    const local = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => local.set(key, value) } })
    const previousFetch = globalThis.fetch
    const requests: URL[] = []
    let responseMode: 'normal' | 'empty' | 'qps' | 'range' = 'normal'
    globalThis.fetch = async (input, init) => {
        if (String(input) === '/api/directions') return POST(new NextRequest('http://localhost/api/directions', { ...init, signal: init?.signal ?? undefined }))
        const url = new URL(String(input)); requests.push(url)
        if (responseMode === 'qps') return Response.json({ status: '0', info: 'CUQPS_HAS_EXCEEDED_THE_LIMIT' })
        if (responseMode === 'range') return Response.json({ status: '0', info: 'OVER_DIRECTION_RANGE' })
        if (url.hostname === 'maps.googleapis.com') {
            if (responseMode === 'empty') return Response.json({ status: 'ZERO_RESULTS' })
            return Response.json({ status: 'OK', routes: [{ legs: [{ distance: { value: 2500 }, duration: { value: 600 }, start_location: { lat: 39.9, lng: 116.4 }, end_location: { lat: 39.901, lng: 116.401 }, steps: [] }] }] })
        }
        assert.equal(url.hostname, 'restapi.amap.com', 'no real third-party request')
        if (url.pathname.includes('/geocode/regeo')) return Response.json({ status: '1', regeocode: { addressComponent: { citycode: url.searchParams.get('location')?.startsWith('117') ? '022' : '010' } } })
        if (url.pathname.includes('/transit/')) return Response.json({ status: '1', route: { transits: responseMode === 'empty' ? [] : [{ distance: '2200', duration: '900', segments: [{ walking: { steps: [{ polyline: '116.4,39.9;116.401,39.901' }] }, bus: { buslines: [{ polyline: '116.401,39.901;116.402,39.902' }] } }, { railway: { departure_stop: { location: '116.402,39.902' }, via_stops: [{ location: '116.403,39.903' }], arrival_stop: { location: '116.404,39.904' } } }] }] } })
        const route = { paths: responseMode === 'empty' ? [] : [{ distance: '200', duration: '120', steps: [{ polyline: '116.4,39.9;116.401,39.901' }] }] }
        return Response.json(url.pathname.includes('/v4/') ? { errcode: 0, data: route } : { status: '1', route })
    }
    const api = async (body: unknown) => {
        const response = await POST(new NextRequest('http://localhost/api/directions', { method: 'POST', body: JSON.stringify(body) }))
        return { status: response.status, data: await response.json() }
    }
    try {
        assert.equal(resolveRouteMode(origin, destination), 'walking')
        assert.equal(resolveRouteMode(origin, far), 'driving')
        const boundary = { lat: 2000 / 6371000 * 180 / Math.PI, lng: 0 }
        assert.equal(resolveRouteMode({ lat: 0, lng: 0 }, boundary), 'driving')
        const mapping: Record<TransportMode, string | null> = { walking: 'walking', cycling: 'bicycling', driving: 'driving', taxi: 'driving', bus: 'transit', subway: 'transit', train: 'transit', flight: null, ferry: null, other: null }
        for (const [transport, mode] of Object.entries(mapping)) assert.equal(resolveRouteMode(origin, far, transport as TransportMode), mode)
        assert.equal(resolveRouteMode(origin, destination, 'bus', 'driving'), 'transit', 'arranged transport wins')
        let route = newRouteChain(['a', 'b', 'c'])
        const [a, b] = route.stops
        route.legs = [{ fromStopId: a.id, toStopId: b.id, mode: 'train' }]
        assert.equal(routeTransportMode(route, 'a', 'b'), 'train')
        assert.equal(routeTransportMode(route, 'b', 'a'), undefined)
        const reordered = reorderRouteStops(route, ['b', 'a', 'c'])
        assert.equal(routeTransportMode(reordered, 'b', 'a'), undefined)
        assert.equal(routeTransportMode(reorderRouteStops(reordered, ['a', 'b', 'c']), 'a', 'b'), 'train')
        const segment = { fromId: 'a', toId: 'b', origin, destination }
        assert.notEqual(routeCacheKey('amap', segment), routeCacheKey('amap', { ...segment, transportMode: 'cycling' }))
        assert.notEqual(routeCacheKey('amap', segment), routeCacheKey('amap', { ...segment, fromId: 'b', toId: 'a', origin: destination, destination: origin }))
        assert.equal(routeCacheKey('amap', { ...segment, transportMode: 'taxi' }), routeCacheKey('amap', { ...segment, transportMode: 'driving' }))
        assert.equal((await api({ origin, destination })).status, 200)
        assert(requests.at(-1)!.pathname.endsWith('/walking'))
        assert.equal((await api({ origin, destination: far })).status, 200)
        assert(requests.at(-1)!.pathname.endsWith('/driving'))
        let r = await api({ origin, destination, transportMode: 'cycling' })
        assert.equal(r.status, 200); assert.equal(r.data.distance, 200)
        assert(requests.at(-1)!.pathname === '/v4/direction/bicycling')
        r = await api({ origin, destination, transportMode: 'train' })
        assert.equal(r.status, 200); assert.equal(r.data.distance, 2200)
        assert.equal(r.data.path.length, 7, 'walking + bus + railway shape')
        assert(requests.at(-1)!.pathname.endsWith('/transit/integrated'))
        assert.equal(requests.at(-1)!.searchParams.get('city'), '010')
        assert.equal(requests.at(-1)!.searchParams.get('cityd'), '010')
        const count = requests.length
        await api({ origin, destination, transportMode: 'subway' })
        assert.equal(requests.length, count, 'same resolved mode reuses route and city lookup')
        for (const transportMode of ['flight', 'ferry', 'other']) {
            r = await api({ origin, destination: far, transportMode })
            assert.equal(r.status, 200); assert.equal(r.data.fallback, 'UNSUPPORTED_MODE')
            assert.equal(r.data.distanceKind, 'straight'); assert.equal(r.data.duration, null)
            assert.equal(r.data.distance, calculateDistance(origin.lat, origin.lng, far.lat, far.lng))
            assert.equal(requests.length, count, 'unsupported mode never contacts provider')
        }
        assert.equal((await api({ origin, destination, transportMode: 'spaceship' })).status, 400)
        assert.equal((await api({ origin, destination, mode: 'auto' })).status, 400)
        assert.equal((await api({ origin: { lat: 91, lng: 0 }, destination })).status, 400)
        const schematic = await getPlannedRoute('amap', { ...segment, transportMode: 'flight' })
        assert(isRangeFallback(schematic)); assert.equal(requests.length, count)
        responseMode = 'empty'
        r = await api({ origin: { ...origin, lng: 116.5 }, destination, mode: 'transit' })
        assert.equal(r.status, 200); assert.equal(r.data.fallback, 'NO_ROUTE'); assert.equal(r.data.distanceKind, 'straight')
        responseMode = 'qps'
        const temporaryOrigin = { ...origin, lng: 116.6 }
        assert.equal((await api({ origin: temporaryOrigin, destination, mode: 'walking' })).status, 500)
        assert.equal(getCachedDirection(directionCacheKey('amap', 'walking', temporaryOrigin, destination)), null, 'temporary failures not persisted')
        responseMode = 'range'
        r = await api({ origin: temporaryOrigin, destination, mode: 'driving' })
        assert.equal(r.data.fallback, 'OVER_DIRECTION_RANGE'); assert.equal(r.data.distanceKind, 'straight'); assert.equal(r.data.duration, null)
        const afterRange = requests.length
        await api({ origin: temporaryOrigin, destination, mode: 'driving' }); assert.equal(requests.length, afterRange)
        responseMode = 'normal'
        for (const mode of ['walking', 'driving', 'bicycling', 'transit'] as const) {
            const google = await getSavedDirection(origin, destination, mode, 'google')
            assert.equal(google.distance, 2500)
            assert.equal(requests.at(-1)!.searchParams.get('mode'), mode)
        }
        responseMode = 'empty'
        assert.equal((await getSavedDirection(far, destination, 'transit', 'google')).fallback, 'NO_ROUTE')
        responseMode = 'normal'
        // Older permanent fallback rows now expose a clearly labelled direct distance.
        cacheDirection(directionCacheKey('amap', 'driving', far, destination), { path: [far, destination], distance: null, duration: null, fallback: 'UNSUPPORTED_REGION' })
        assert.equal((await getSavedDirection(far, destination, 'driving', 'amap')).distanceKind, 'straight')
        const transitKey = directionCacheKey('amap', 'transit', origin, destination)
        getDb().prepare("UPDATE direction_cache SET created_at = '2000-01-01T00:00:00.000Z' WHERE cache_key = ?").run(transitKey)
        assert.equal(getCachedDirection(transitKey), null, 'public transit cache expires')
        const bridge = await connectPlanningTools()
        try {
            assert(bridge.tools.some(tool => tool.function.name === 'get_directions'))
            assert(!bridge.tools.some(tool => tool.function.name === 'get_walking_directions'), 'web AI only exposes the unified tool')
            const result = await bridge.call('get_directions', { origin, destination, transportMode: 'ferry' }, new AbortController().signal)
            assert(!result.isError)
            const json = JSON.parse((result.content as Array<{ text: string }>)[0].text)
            assert.equal(json.fallback, 'UNSUPPORTED_MODE'); assert.equal(json.distanceKind, 'straight')
            const old = await bridge.call('get_walking_directions', { origin, destination }, new AbortController().signal)
            assert(!old.isError, 'old public MCP entry remains callable')
        } finally { await bridge.close() }
        const day = { id: 'test-day', tripId: 'test-trip', date: '2026-10-05', markerIds: ['a', 'b', 'c'], chains: [['a', 'b', 'c']], routeChains: [route] }
        useMapStore.setState({ tripDays: [day] })
        route = { ...route, legs: [{ fromStopId: a.id, toStopId: b.id, mode: 'flight' }] }
        const html = renderToStaticMarkup(React.createElement(RouteLeg, { day, route, fromId: 'a', toId: 'b', distance: 2500, editable: false }))
        assert(html.includes('2.5 km')); assert(!html.includes('直线')); assert(html.includes('飞机'))
        const roadHtml = renderToStaticMarkup(React.createElement(RouteLeg, { day, route: { ...route, legs: [{ fromStopId: a.id, toStopId: b.id, mode: 'taxi' }] }, fromId: 'a', toId: 'b', distance: 2500, editable: false }))
        assert(!roadHtml.includes('直线')); assert(roadHtml.includes('2.5 km'))
        process.env.MAP_DIRECTIONS_PROVIDER = 'google'
        const planned = await getPlannedRoute('google', { ...segment, transportMode: 'cycling' })
        assert(!isRangeFallback(planned)); assert.equal(readRouteMetrics(routeCacheKey('google', { ...segment, transportMode: 'cycling' }))?.distance, 2500)
        console.log('Itinerary routing passed: mapping/2km default, directed reorder, API modes, AMap walking/driving/cycling/transit mock shapes/cities, Google four modes, fallback/direct distances, cache reuse/expiry, temporary errors, MCP compatibility, client cache and route card rendering.')
    } finally {
        globalThis.fetch = previousFetch
        if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
        else Reflect.deleteProperty(globalThis, 'localStorage')
        getDb().close()
        rmSync(temp, { recursive: true, force: true })
    }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
