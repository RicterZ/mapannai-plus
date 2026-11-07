import assert from 'node:assert/strict'
import { placeImage } from '../src/lib/trips/place-image'
import type { Marker } from '../src/types/marker'
import type { Trip } from '../src/types/trip'
const marker: Marker = { id: 'venue', coordinates: { longitude: 140, latitude: 35 }, content: { id: 'venue', title: 'Venue', markdownContent: '', headerImage: 'https://images.example/shared.jpg', createdAt: new Date(), updatedAt: new Date() } }
const trip = (id: string, date: string, cover?: string, content = ''): Trip => ({ id, name: id, startDate: date, endDate: date, createdAt: date, updatedAt: date,
    markerNotes: [{ tripId: id, markerId: 'venue', title: '', content, headerImage: cover, updatedAt: date }] })
const trips = [trip('old', '2026-01-01', 'https://images.example/old.jpg'), trip('latest', '2027-01-01', 'https://images.example/latest.jpg'), trip('empty', '2026-04-01')]
assert.equal(placeImage(marker, trips, null), 'https://images.example/latest.jpg')
assert.equal(placeImage(marker, trips, 'old'), 'https://images.example/old.jpg')
assert.equal(placeImage(marker, trips, 'empty'), undefined, 'no photos from a different trip or the shared cover')
assert.equal(placeImage(marker, [], null), marker.content.headerImage)
assert.equal(placeImage(marker, [trip('inline', '2028-01-01', undefined, '<p><img src="https://images.example/inline.jpg?a=1&amp;b=2"></p>')], 'inline'), 'https://images.example/inline.jpg?a=1&b=2')
assert.equal(placeImage(marker, [trip('unsafe', '2028-01-01', undefined, '<img src="javascript:alert(1)">')], 'unsafe'), undefined)
console.log('Place images passed: latest overview, isolated trip cover, inline compatibility, no cross-trip fallback.')
