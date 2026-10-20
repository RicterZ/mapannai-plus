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
assert.match(preview({ chains: [['0', '1', '2', '3', '4']] }), /京都站/)
assert.match(preview({ chains: [['0'], ['1'], ['2']] }), /路线 3/)
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

const loop: RouteChain = {
    id: 'loop', stops: [{ id: 'a1', markerId: '0', startTime: '08:00', note: 'first visit' }, { id: 'b1', markerId: '1' }, { id: 'a2', markerId: '0', startTime: '17:00', note: 'return visit' }, { id: 'b2', markerId: '1' }],
    legs: [{ fromStopId: 'a1', toStopId: 'b1', mode: 'bus', serviceNumber: 'BUS1' }, { fromStopId: 'a2', toStopId: 'b2', mode: 'train', serviceNumber: 'TRAIN2' }],
}
const returnVisit = renderToStaticMarkup(<StopSchedule day={day} route={loop} markerId="0" stopIndex={2} editable />)
assert.match(returnVisit, /17:00/)
assert.doesNotMatch(returnVisit, /08:00/)
const returnNote = renderToStaticMarkup(<StopSchedule day={day} route={loop} markerId="0" stopIndex={2} editable noteOnly />)
assert.match(returnNote, /return visit/)
assert.doesNotMatch(returnNote, /first visit/)
const returnLeg = renderToStaticMarkup(<RouteLeg day={day} route={loop} fromId="0" toId="1" stopIndex={2} distance={42} editable />)
assert.match(returnLeg, /TRAIN2/)
assert.doesNotMatch(returnLeg, /BUS1/)
console.log('Repeated visit presentation passed: independent time, note and traffic for the second visit.')
