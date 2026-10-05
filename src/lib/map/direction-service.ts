import { resolveRouteMode, routeDistance } from './route-mode'
import type { TransportMode } from '@/types/trip'
import { cacheDirection, directionCacheKey, getCachedDirection } from '@/lib/db/direction-cache'
import { defaultServiceProvider, mapProviderFactory } from './providers/map-provider-factory'
import type { MapRoute, RoutePoint, TravelMode } from '@/types/map-provider'

function withRouteDistance(route: MapRoute, origin: RoutePoint, destination: RoutePoint): MapRoute {
    const { distanceKind: _legacyKind, ...result } = route as MapRoute & { distanceKind?: string }
    const validDistance = typeof route.distance === 'number' && Number.isFinite(route.distance) && route.distance >= 0
    const validPath = Array.isArray(route.path) && route.path.length >= 2 && route.path.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    const fallback = route.fallback || (!validDistance || !validPath ? 'NO_ROUTE' : undefined)
    return { ...result, ...(fallback ? { fallback, path: [origin, destination] } : {}), distance: routeDistance(origin, destination, fallback ? null : route.distance), duration: fallback ? null : route.duration }
}

const inFlight = new Map<string, Promise<MapRoute>>()

/** Persist real routes and terminal coverage failures, shared by Web and MCP. */
export async function getSavedDirection(origin: RoutePoint, destination: RoutePoint, requestedMode?: TravelMode, override?: string, transportMode?: TransportMode) {
    const mode = resolveRouteMode(origin, destination, transportMode, requestedMode)
    if (mode === null) return { path: [origin, destination], distance: routeDistance(origin, destination), duration: null, fallback: 'UNSUPPORTED_MODE' } as MapRoute
    const provider = override || defaultServiceProvider('directions')
    const key = directionCacheKey(provider, mode, origin, destination)
    const cached = getCachedDirection(key)
    if (cached) return withRouteDistance(cached, origin, destination)
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
            if (!fallback) return withRouteDistance({ path: [origin, destination], distance: null, duration: null, fallback: 'PLANNING_FAILED', error: error.message }, origin, destination)
            // No invented travel metrics: this is an association, not a navigable route.
            route = { path: [origin, destination], distance: null, duration: null, fallback }
        }
        route = withRouteDistance(route, origin, destination)
        cacheDirection(key, route)
        return route
    })().finally(() => inFlight.delete(key))
    inFlight.set(key, pending)
    return pending
}
