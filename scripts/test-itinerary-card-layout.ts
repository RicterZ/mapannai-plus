import assert from 'node:assert/strict'
import { layoutItineraryCards, itineraryCardSize, sameItineraryPlacements } from '../src/lib/map/itinerary-card-layout'
const bounds = { left: 420, top: 100, right: 1400, bottom: 850 }
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
