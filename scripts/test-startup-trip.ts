import assert from 'node:assert/strict'
import { defaultStartupTrip } from '../src/lib/map/startup-camera'
import type { Trip } from '../src/types/trip'
const trip = (id: string, startDate: string): Trip => ({ id, name: id, startDate, endDate: startDate, createdAt: '', updatedAt: '' })
const past = trip('past', '2026-10-18'), next = trip('next', '2026-12-01'), later = trip('later', '2027-01-01')
assert.equal(defaultStartupTrip([past, later, next], '2026-10-19')?.id, 'next')
assert.equal(defaultStartupTrip([past, trip('old', '2020-01-01')], '2026-10-19')?.id, 'past')
assert.equal(defaultStartupTrip([next, trip('today', '2026-10-19')], '2026-10-19')?.id, 'today')
assert.equal(defaultStartupTrip([], '2026-10-19'), null)
assert.equal(defaultStartupTrip([trip('bad', '')], '2026-10-19'), null)
console.log('Startup trip selection checks passed')
