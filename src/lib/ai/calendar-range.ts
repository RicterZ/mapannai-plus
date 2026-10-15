export type CalendarRange = { start: string; end: string; choosingEnd: boolean }
/** Same two-tap, reversible range selection as the iOS TripDateRange. */
export function selectCalendarDate(range: CalendarRange, date: string): CalendarRange {
    if (!range.choosingEnd || !range.start) return { start: date, end: date, choosingEnd: true }
    return { start: date < range.start ? date : range.start, end: date > range.start ? date : range.start, choosingEnd: false }
}
export function calendarDayCount(start: string, end: string): number {
    return start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1 : 0
}
