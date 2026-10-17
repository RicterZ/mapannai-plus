import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import { DayRoutePreview } from '../src/components/trips/day-route-preview'
import type { TripDay } from '../src/types/trip'
import type { Marker } from '../src/types/marker'

const markers = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, content: { title: `地点${i}` } })) as Marker[]
const day: TripDay = {
    id: 'day', tripId: 'trip', date: '2027-01-01', markerIds: markers.map(m => m.id),
    chains: [['missing'], markers.map(m => m.id)],
    routeChains: [
        { id: 'empty', stops: [{ id: 'missing', markerId: 'missing' }], legs: [] },
        { id: 'route', stops: markers.map((m, i) => ({ id: `s${i}`, markerId: m.id, ...(i === 0 ? { startTime: '08:10', note: '山顶看雪' } : {}) })),
            legs: [{ fromStopId: 's0', toStopId: 's1', mode: 'train', serviceNumber: 'NH571', startTime: '09:30' }] },
    ],
}
const html = renderToStaticMarkup(<DayRoutePreview day={day} markers={markers} />)
for (const text of ['地点4', '08:10', '09:30', 'NH571', '山顶看雪']) assert.ok(html.includes(text), text)
assert.ok(!html.includes('还有'))
const stale = renderToStaticMarkup(<DayRoutePreview day={{ ...day, chains: [['m1', 'm0']] }} markers={markers} />)
assert.ok(!stale.includes('NH571'), 'Do not display schedules from a mismatched route')
const empty = renderToStaticMarkup(<DayRoutePreview day={{ ...day, chains: [] }} markers={[]} />)
assert.ok(empty.includes('还没有安排地点'))
console.log('Day route preview checks passed')
