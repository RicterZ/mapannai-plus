import { z } from 'zod'
import type { Trip, TripDestination } from '@/types/trip'
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

export const tripDestinationsSchema = z.array(tripDestinationSchema).max(20).superRefine((values, ctx) => {
    const seen = new Set<string>()
    for (const value of values) {
        const key = `${value.latitude.toFixed(6)}:${value.longitude.toFixed(6)}`
        if (seen.has(key)) ctx.addIssue({ code: 'custom', message: '目的地不能重复' })
        seen.add(key)
    }
})

export function tripDestinations(trip?: Pick<Trip, 'destinations' | 'destination'> | null): TripDestination[] {
    return trip?.destinations ?? (trip?.destination ? [trip.destination] : [])
}

/** Normalize new lists and old single-destination writes at the API boundary. */
export function parseTripDestinations(body: { destinations?: unknown; destination?: unknown }): TripDestination[] | undefined {
    if (body.destinations !== undefined) return tripDestinationsSchema.parse(body.destinations)
    if (body.destination !== undefined) return body.destination === null ? [] : [tripDestinationSchema.parse(body.destination)]
    return undefined
}
