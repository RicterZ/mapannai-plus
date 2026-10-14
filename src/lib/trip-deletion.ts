import type { Trip, TripDay } from '@/types/trip'

/** Only delete candidates with no membership outside the requested deletion scope. */
export function exclusiveMarkerIds(targetDays: TripDay[], allDays: TripDay[], trips: Trip[] = [], targetTripId?: string): string[] {
    const ids = (day: TripDay) => Array.from(new Set([...day.markerIds, ...day.chains.flat()]))
    const candidates = new Set(targetDays.flatMap(ids))
    if (targetTripId) trips.find(trip => trip.id === targetTripId)?.markerIds?.forEach(id => candidates.add(id))
    const targetDayIds = new Set(targetDays.map(day => day.id))
    const retained = new Set<string>()
    for (const day of allDays) {
        if (targetTripId ? day.tripId === targetTripId : targetDayIds.has(day.id)) continue
        for (const id of ids(day)) retained.add(id)
    }
    for (const trip of trips) {
        if (trip.id === targetTripId) continue
        for (const id of trip.markerIds ?? []) retained.add(id)
    }
    return Array.from(candidates).filter(id => !retained.has(id))
}
