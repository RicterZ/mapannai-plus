import assert from 'node:assert/strict'
import { keepItineraryPlacements, layoutItineraryCards, itineraryCardSize, itineraryLeaderEnd, sameItineraryPlacements } from '../src/lib/map/itinerary-card-layout'
const bounds = { left: 420, top: 100, right: 2000, bottom: 1300 }
const cards = layoutItineraryCards(Array.from({ length: 20 }, (_, i) => ({ id: String(i), x: 800 + i * 5, y: 400 + i * 4 })), bounds)
assert.ok(cards.length > 0)
const { width, height } = itineraryCardSize
cards.forEach((a, i) => {
    assert.ok(a.left >= bounds.left && a.top >= bounds.top && a.left + width <= bounds.right && a.top + height <= bounds.bottom)
    for (const b of cards.slice(i + 1)) assert.ok(a.left + width <= b.left || b.left + width <= a.left || a.top + height <= b.top || b.top + height <= a.top)
})
assert.equal(layoutItineraryCards([{ id: 'offscreen', x: -100, y: 200 }, { id: 'invalid', x: NaN, y: 300 }], bounds).length, 0)
assert.equal(layoutItineraryCards([{ id: 'small', x: 500, y: 200 }], { ...bounds, right: 550 }).length, 0)
assert.deepEqual(cards, layoutItineraryCards(Array.from({ length: 20 }, (_, i) => ({ id: String(i), x: 800 + i * 5, y: 400 + i * 4 })), bounds))

assert.ok(sameItineraryPlacements(cards, cards.map(card => ({ ...card }))))
assert.ok(!sameItineraryPlacements(cards, []))
assert.ok(!sameItineraryPlacements(cards, cards.map((card, i) => i === 0 ? { ...card, x: card.x + 1 } : card)))
console.log('Itinerary map card layout checks passed')
const clustered = layoutItineraryCards(Array.from({ length: 6 }, (_, i) => ({ id: `day-${i}`, x: 900, y: 450 })), bounds)
assert.equal(clustered.length, 6, 'Shared overnight bases should use free map space rather than lose day cards')
const sharedHotel = layoutItineraryCards([0, 1, 2, 3].map(i => ({ id: `trip-day-${i}`, x: 1150, y: 450 })), bounds)
assert.equal(sharedHotel.length, 4, 'All four days sharing a hotel must have their own compact label')
assert.equal(new Set(sharedHotel.map(card => `${card.left}:${card.top}`)).size, 4)
assert.equal(layoutItineraryCards([{ id: 'airport', x: bounds.right + 25, y: 400 }], bounds).length, 1, 'An anchor beside the control gutter must retain its label inside safe bounds')
const routed = layoutItineraryCards([{ id: 'route-label', x: 900, y: 450 }], bounds, [[{x:420,y:450},{x:1400,y:450}]])
assert.equal(routed.length, 1)
assert.ok(routed[0].top + height < 438 || routed[0].top > 462, 'Card must avoid the actual route corridor')
const diagonal = layoutItineraryCards([{id:'diagonal',x:900,y:450}],bounds)[0]
const end = itineraryLeaderEnd(diagonal)
const leaderAngle = Math.abs(Math.atan2(end.y-diagonal.y, end.x-diagonal.x)) * 180 / Math.PI
assert.ok(leaderAngle > 15 && leaderAngle < 165 && Math.abs(leaderAngle-90) > 15, 'Free-space layout must choose a visibly diagonal leader')
assert.ok(end.x>=diagonal.left && end.x<=diagonal.left+width && end.y>=diagonal.top && end.y<=diagonal.top+height)
assert.equal(height,132,'Multi-line cards reserve space for schedule and notes')

// Measured card heights drive both viewport placement and leader attachment.
const tall = layoutItineraryCards([{ id: 'tall', x: 700, y: 500, height: 260 }], { left: 0, top: 0, right: 1600, bottom: 1100 })
assert.equal(tall.length, 1)
assert.equal(tall[0].height, 260)
assert.ok(tall[0].top + 260 <= 1100)
const edge = itineraryLeaderEnd(tall[0])
assert.ok(edge.y >= tall[0].top && edge.y <= tall[0].top + 260)
assert.equal(sameItineraryPlacements(tall, [{ ...tall[0], height: 100 }]), false)

// Relayout is triggered by the set of on-screen anchors, not by zoom: a zoom that keeps every card clear reuses the layout.
const keepBounds = { left: 0, top: 0, right: 1600, bottom: 1100 }
const pair = layoutItineraryCards([{ id: 'a', x: 600, y: 500 }, { id: 'b', x: 900, y: 500 }], keepBounds)
const zoomed = keepItineraryPlacements(pair, [{ id: 'a', x: 560, y: 500 }, { id: 'b', x: 940, y: 500 }], keepBounds)
assert.ok(zoomed, 'Spreading anchors apart keeps the existing layout')
assert.deepEqual(zoomed!.map(p => p.left - p.x), pair.map(p => p.left - p.x))
assert.equal(keepItineraryPlacements(pair, [{ id: 'a', x: 600, y: 500 }], keepBounds), null, 'An anchor leaving the screen relayouts')
assert.equal(keepItineraryPlacements(pair, [{ id: 'a', x: 600, y: 500 }, { id: 'b', x: 900, y: 500 }, { id: 'c', x: 700, y: 700 }], keepBounds), null, 'An anchor entering the screen relayouts')
const side = [{ id: 'a', x: 600, y: 500, left: 640, top: 400, width: 280, height: 132 }, { id: 'b', x: 1000, y: 500, left: 1040, top: 400, width: 280, height: 132 }]
assert.ok(keepItineraryPlacements(side, side, keepBounds))
assert.equal(keepItineraryPlacements(side, [{ id: 'a', x: 600, y: 500, width: 280, height: 132 }, { id: 'b', x: 700, y: 500, width: 280, height: 132 }], keepBounds), null, 'Colliding cards relayout')
