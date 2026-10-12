import { z } from 'zod'
import type { TripDestination } from '@/types/trip'
import type { MapSearchBounds } from '@/types/map-provider'

export const tripDestinationSchema = z.object({
    name: z.string().trim().min(1).max(200),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
}).strict()

/** A center is a search preference, not an administrative boundary. */
export function destinationSearchBounds(center: TripDestination): MapSearchBounds {
    const latitudeRadius = 30 / 111
    const longitudeRadius = Math.min(180, latitudeRadius / Math.max(0.01, Math.cos(center.latitude * Math.PI / 180)))
    return {
        west: Math.max(-180, center.longitude - longitudeRadius),
        east: Math.min(180, center.longitude + longitudeRadius),
        south: Math.max(-90, center.latitude - latitudeRadius),
        north: Math.min(90, center.latitude + latitudeRadius),
    }
}
