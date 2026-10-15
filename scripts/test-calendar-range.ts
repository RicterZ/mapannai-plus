import assert from 'node:assert/strict'
import { calendarDayCount, selectCalendarDate } from '../src/lib/ai/calendar-range'
let range = { start: '', end: '', choosingEnd: false }
range = selectCalendarDate(range, '2026-12-31')
assert.deepEqual(range, {start:'2026-12-31',end:'2026-12-31',choosingEnd:true})
range = selectCalendarDate(range, '2027-01-03')
assert.equal(calendarDayCount(range.start,range.end),4)
range = selectCalendarDate(range, '2026-10-20')
range = selectCalendarDate(range, '2026-10-16')
assert.deepEqual(range,{start:'2026-10-16',end:'2026-10-20',choosingEnd:false})
range = selectCalendarDate(range,'2026-10-16'); range = selectCalendarDate(range,'2026-10-16')
assert.equal(calendarDayCount(range.start,range.end),1)
assert.equal(calendarDayCount('2024-02-28','2024-03-01'),3)
assert.equal(calendarDayCount('2026-03-07','2026-03-09'),3)
console.log('iOS-style calendar range checks passed: reverse selection, same day, cross-month/year, leap year and DST-safe counts')
