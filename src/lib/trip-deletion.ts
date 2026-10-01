import type { TripDay } from '@/types/trip'

/** Count each day once, including chain-only references in older data. */
export function exclusiveMarkerIds(targetDays: TripDay[], allDays: TripDay[]): string[] {
    const ids = (day: TripDay) => Array.from(new Set([...day.markerIds, ...day.chains.flat()]))
    const candidates = new Set(targetDays.flatMap(ids))
    const references = new Map<string, number>()
    for (const day of allDays) for (const id of ids(day)) {
        if (candidates.has(id)) references.set(id, (references.get(id) || 0) + 1)
    }
    return Array.from(candidates).filter(id => references.get(id) === 1)
}
