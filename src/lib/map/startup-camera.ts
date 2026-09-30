import type { Marker } from '@/types/marker'
import type { Trip, TripDay } from '@/types/trip'

/** Local calendar date: UTC can select yesterday/tomorrow near midnight. */
export function localCalendarDate(now = new Date()): string {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** First valid stop on the first day of the nearest upcoming trip. */
export function upcomingTripFirstMarker(trips: Trip[], days: TripDay[], markers: Marker[], today = localCalendarDate()): Marker | null {
    const candidates = trips.filter(trip => trip.startDate >= today)
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))
    const byId = new Map(markers.map(marker => [marker.id, marker]))
    for (const trip of candidates) {
        const firstDay = days.filter(day => day.tripId === trip.id).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))[0]
        if (!firstDay) continue
        const ids = [...firstDay.chains.flat(), ...firstDay.markerIds]
        for (const id of ids) {
            const marker = byId.get(id)
            if (marker && Number.isFinite(marker.coordinates.latitude) && Math.abs(marker.coordinates.latitude) <= 90 &&
                Number.isFinite(marker.coordinates.longitude) && Math.abs(marker.coordinates.longitude) <= 180) return marker
        }
    }
    return null
}
