import assert from 'node:assert/strict'
import { layoutItineraryCards, itineraryCardSize } from '../src/lib/map/itinerary-card-layout'
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
console.log('Itinerary map card layout checks passed')
