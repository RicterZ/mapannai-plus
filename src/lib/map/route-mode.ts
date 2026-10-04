import { calculateDistance } from '@/utils/distance'
import type { RoutePoint, TravelMode } from '@/types/map-provider'
import type { RouteChain, TransportMode } from '@/types/trip'

export function resolveRouteMode(origin: RoutePoint, destination: RoutePoint, transportMode?: TransportMode, mode?: TravelMode): TravelMode | null {
    if (transportMode) {
        switch (transportMode) {
            case 'walking': return 'walking'
            case 'cycling': return 'bicycling'
            case 'driving': case 'taxi': return 'driving'
            case 'bus': case 'subway': case 'train': return 'transit'
            default: return null
        }
    }
    if (mode) return mode
    return Math.round(calculateDistance(origin.lat, origin.lng, destination.lat, destination.lng) * 1e6) < 2000 * 1e6 ? 'walking' : 'driving'
}

/** Match an active directed edge only; never inherit an inactive/reversed leg. */
export function routeTransportMode(route: RouteChain | undefined, fromId: string, toId: string): TransportMode | undefined {
    const index = route?.stops.findIndex(stop => stop.markerId === fromId) ?? -1
    const from = route?.stops[index], to = route?.stops[index + 1]
    if (!from || to?.markerId !== toId) return undefined
    return route?.legs.find(leg => leg.fromStopId === from.id && leg.toStopId === to.id)?.mode
}
