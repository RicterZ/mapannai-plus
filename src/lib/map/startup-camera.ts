import type { Marker } from '@/types/marker'
import type { Trip, TripDay } from '@/types/trip'

/** Local calendar date: UTC can select yesterday/tomorrow near midnight. */
export function localCalendarDate(now = new Date()): string {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Find the nearest not-yet-started trip with locations, without selecting it. */
export function upcomingTripMarkers(trips: Trip[], days: TripDay[], markers: Marker[], today = localCalendarDate()): Marker[] {
    const candidates = trips.filter(trip => trip.startDate >= today)
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))
    for (const trip of candidates) {
        const ids = new Set(days.filter(day => day.tripId === trip.id).flatMap(day => day.markerIds))
        const places = markers.filter(marker => ids.has(marker.id) &&
            Number.isFinite(marker.coordinates.latitude) && Math.abs(marker.coordinates.latitude) <= 90 &&
            Number.isFinite(marker.coordinates.longitude) && Math.abs(marker.coordinates.longitude) <= 180)
        if (places.length) return places
    }
    return []
}
