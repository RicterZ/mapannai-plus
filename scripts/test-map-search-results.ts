import assert from 'node:assert/strict'
import { mergeSearchResults } from '../src/lib/map/search-results'
import type { Marker } from '../src/types/marker'

const marker = (id: string, title: string, longitude: number, latitude: number): Marker => ({
    id, coordinates: { longitude, latitude }, content: { id, title, markdownContent: '', createdAt: new Date(), updatedAt: new Date() },
})
const saved = [marker('one', '东京 Tokyo Station', 139.767125, 35.681236), marker('two', '大阪车站', 135.5, 34.7)]
assert.deepEqual(mergeSearchResults(' ToKYo ', saved, []).map(item => item.markerId), ['one'])
assert.deepEqual(mergeSearchResults('站', saved, []).map(item => item.markerId), ['two'])
assert.deepEqual(mergeSearchResults('', saved, []), [])
const official = { id: 'official', name: '東京駅', coordinates: { longitude: 139.7671251, latitude: 35.6812361 }, placeReferences: { google: { placeId: 'official-id' } } }
const result = mergeSearchResults('東京', saved, [official, official])
assert.equal(result.length, 1)
assert.equal(result[0].markerId, 'one', 'coordinate matches select saved marker even when its title did not match')
assert.equal(result[0].placeReferences, undefined, 'search identity must not be inferred or merged into saved marker')
const nearby = { ...official, id: 'nearby', coordinates: { longitude: 139.767127, latitude: 35.681236 } }
const separate = mergeSearchResults('Tokyo', saved, [official, nearby])
assert.equal(separate.length, 2, 'nearby coordinates are not equal')
assert.equal(separate[0].markerId, 'one')
assert.equal(separate[1].markerId, undefined)
assert.equal(separate[1].placeReferences?.google?.placeId, 'official-id')
assert.equal(mergeSearchResults('Tokyo', saved, [{ ...official, coordinates: { longitude: NaN, latitude: 0 } }]).length, 1)
assert.equal(saved[0].placeReferences, undefined)
console.log('Map search merge passed: title matching, local results without provider, coordinate precision, saved preference, deduplication, invalid coordinates and POI reference isolation.')
