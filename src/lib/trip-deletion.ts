import type { Trip, TripDay } from '@/types/trip'

/** Count day memberships and trip-only memberships once each, including legacy chain references. */
export function exclusiveMarkerIds(targetDays: TripDay[], allDays: TripDay[], trips: Trip[] = [], targetTripId?: string): string[] {
    const ids = (day: TripDay) => Array.from(new Set([...day.markerIds, ...day.chains.flat()]))
    const candidates = new Set(targetDays.flatMap(ids))
    if (targetTripId) trips.find(trip => trip.id === targetTripId)?.markerIds?.forEach(id => candidates.add(id))
    const references = new Map<string, number>()
    for (const day of allDays) for (const id of ids(day)) {
        if (candidates.has(id)) references.set(id, (references.get(id) || 0) + 1)
    }
    for (const trip of trips) for (const id of Array.from(new Set(trip.markerIds ?? []))) {
        if (candidates.has(id)) references.set(id, (references.get(id) || 0) + 1)
    }
    return Array.from(candidates).filter(id => references.get(id) === 1)
}
