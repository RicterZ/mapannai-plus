import { resolveRouteMode } from './route-mode'
import { calculateDistance } from '@/utils/distance'
import type { TransportMode } from '@/types/trip'
import { cacheDirection, directionCacheKey, getCachedDirection } from '@/lib/db/direction-cache'
import { defaultServiceProvider, mapProviderFactory } from './providers/map-provider-factory'
import type { MapRoute, RoutePoint, TravelMode } from '@/types/map-provider'

function withStraightDistance(route: MapRoute, origin: RoutePoint, destination: RoutePoint): MapRoute {
    return route.fallback ? { ...route, distance: calculateDistance(origin.lat, origin.lng, destination.lat, destination.lng), duration: null, distanceKind: 'straight' } : route
}

const inFlight = new Map<string, Promise<MapRoute>>()

/** Persist real routes and terminal coverage failures, shared by Web and MCP. */
export async function getSavedDirection(origin: RoutePoint, destination: RoutePoint, requestedMode?: TravelMode, override?: string, transportMode?: TransportMode) {
    const mode = resolveRouteMode(origin, destination, transportMode, requestedMode)
    if (mode === null) return { path: [origin, destination], distance: calculateDistance(origin.lat, origin.lng, destination.lat, destination.lng), duration: null, distanceKind: 'straight', fallback: 'UNSUPPORTED_MODE' } as MapRoute
    const provider = override || defaultServiceProvider('directions')
    const key = directionCacheKey(provider, mode, origin, destination)
    const cached = getCachedDirection(key)
    if (cached) return withStraightDistance(cached, origin, destination)
    const existing = inFlight.get(key)
    if (existing) return existing
    const pending = (async () => {
        let route: MapRoute
        try {
            route = await mapProviderFactory.createServiceProvider('directions', provider).getDirections(origin, destination, mode)
        } catch (error) {
            if (!(error instanceof Error)) throw error
            const fallback = /\bNO_ROUTE\b/.test(error.message) ? 'NO_ROUTE'
                : provider === 'amap' && /\bOVER_DIRECTION_RANGE\b/.test(error.message) ? 'OVER_DIRECTION_RANGE'
                : provider === 'amap' && error.message === '高德路线规划仅支持中国，请选择 Google 路线后端' ? 'UNSUPPORTED_REGION' : null
            if (!fallback) throw error
            // No invented travel metrics: this is an association, not a navigable route.
            route = { path: [origin, destination], distance: null, duration: null, fallback }
        }
        if (route.path.length < 2 || !route.path.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))) throw new Error('路线数据无效')
        route = withStraightDistance(route, origin, destination)
        cacheDirection(key, route)
        return route
    })().finally(() => inFlight.delete(key))
    inFlight.set(key, pending)
    return pending
}
