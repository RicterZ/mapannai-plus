import React from 'react'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { DayRoutePreview } from '../src/components/trips/day-route-preview'
import { RouteLeg, StopSchedule } from '../src/components/trips/route-schedule'
import type { Marker } from '../src/types/marker'
import type { TripDay, RouteChain } from '../src/types/trip'

const markers: Marker[] = ['<清水寺>', '二年坂', '八坂神社', '花见小路', '京都站'].map((title, index) => ({
    id: String(index), coordinates: { latitude: 35, longitude: 135 },
    content: { id: String(index), title, markdownContent: '', createdAt: new Date(), updatedAt: new Date() },
}))
const route: RouteChain = { id: 'route', stops: [{ id: 'a', markerId: '0', startTime: '09:00', durationMinutes: 0 }, { id: 'b', markerId: '1' }], legs: [{ fromStopId: 'a', toStopId: 'b', mode: 'bus', serviceNumber: '<206>', startTime: '10:00', durationMinutes: 15, note: '祇园下车' }] }
const day: TripDay = { id: 'day', tripId: 'trip', date: '2026-10-19', markerIds: markers.map(marker => marker.id), chains: [['0', '1'], ['2', '0']], routeChains: [route] }
const preview = (patch: Partial<TripDay> = {}, places = markers) => renderToStaticMarkup(<DayRoutePreview day={{ ...day, ...patch }} markers={places} />)
const html = preview()
assert.match(html, /路线 1/)
assert.match(html, /路线 2/)
assert.match(html, /5 个地点 · 2 条路线/)
assert.match(html, /未加入路线 · 2 个地点/)
assert.match(html, /&lt;清水寺&gt;/)
assert.equal((html.match(/&lt;清水寺&gt;/g) || []).length, 2, 'Shared places appear in each route, without changing member counts')
assert.ok(html.indexOf('二年坂') > html.indexOf('&lt;清水寺&gt;'))
assert.match(preview({ chains: [['0', '1', '2', '3', '4']] }), /还有 2 站/)
assert.match(preview({ chains: [['0'], ['1'], ['2']] }), /还有 1 条路线/)
assert.match(preview({ chains: [['missing'], []] }), /5 个地点 · 0 条路线/)
assert.match(preview({ chains: [] }), /花见小路/)
assert.match(preview({ chains: [] }, []), /还没有安排地点/)
const leg = (distance: number | null, editable = false, reverse = false, chain = route) => renderToStaticMarkup(<RouteLeg day={day} route={chain} fromId={reverse ? '1' : '0'} toId={reverse ? '0' : '1'} distance={distance} editable={editable} />)
assert.match(leg(850), /850 m/)
assert.match(leg(1200), /1.2 km/)
assert.match(leg(null), /&lt;206&gt;/)
assert.match(leg(null), /祇园下车/)
assert.match(leg(null), /15分钟/)
assert.doesNotMatch(leg(null, false, true), /206|祇园下车/)
assert.doesNotMatch(leg(null, false, false, { ...route, legs: [] }), /公交|添加交通安排|850 m/)
assert.match(leg(null, true, false, { ...route, legs: [] }), /添加交通安排/)
assert.match(renderToStaticMarkup(<StopSchedule day={day} route={route} markerId="0" editable />), /0分钟/)
console.log('Sidebar presentation passed: ordered previews, independent routes, unplanned members, empty/missing places, escaping, directed traffic, distances and zero-duration schedules.')
