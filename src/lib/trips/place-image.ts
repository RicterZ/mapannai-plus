import type { Marker } from '@/types/marker'
import type { Trip, TripMarkerNote } from '@/types/trip'

function firstContentImage(content: string): string | undefined {
    const source = content.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, '&')
    return source && /^https?:\/\//i.test(source) ? source : undefined
}
export function noteImage(note?: TripMarkerNote): string | undefined {
    return note?.headerImage || (note?.content ? firstContentImage(note.content) : undefined)
}

/** A trip never borrows another trip's photo. Overview uses the most recent trip with a photo. */
export function placeImage(marker: Marker, trips: Trip[], tripId?: string | null): string | undefined {
    if (tripId) return noteImage(trips.find(trip => trip.id === tripId)?.markerNotes?.find(note => note.markerId === marker.id))
    const latest = [...trips].sort((a, b) => b.startDate.localeCompare(a.startDate) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
        .map(trip => noteImage(trip.markerNotes?.find(note => note.markerId === marker.id))).find(Boolean)
    return latest || marker.content.headerImage || firstContentImage(marker.content.markdownContent)
}
