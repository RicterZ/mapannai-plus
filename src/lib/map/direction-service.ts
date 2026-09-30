import { cacheDirection, directionCacheKey, getCachedDirection } from '@/lib/db/direction-cache'
import { defaultServiceProvider, mapProviderFactory } from './providers/map-provider-factory'
import type { MapRoute, RoutePoint, TravelMode } from '@/types/map-provider'

const inFlight = new Map<string, Promise<MapRoute>>()

/** Persist both real routes and terminal range failures, shared by Web and MCP. */
export async function getSavedDirection(origin: RoutePoint, destination: RoutePoint, mode: TravelMode, override?: string) {
    const provider = override || defaultServiceProvider('directions')
    const key = directionCacheKey(provider, mode, origin, destination)
    const cached = getCachedDirection(key)
    if (cached) return cached
    const existing = inFlight.get(key)
    if (existing) return existing
    const pending = (async () => {
        let route: MapRoute
        try {
            route = await mapProviderFactory.createServiceProvider('directions', provider).getDirections(origin, destination, mode)
        } catch (error) {
            if (provider !== 'amap' || !(error instanceof Error) || !/\bOVER_DIRECTION_RANGE\b/.test(error.message)) throw error
            // No invented travel metrics: this is an association, not a navigable route.
            route = { path: [origin, destination], distance: null, duration: null, fallback: 'OVER_DIRECTION_RANGE' }
        }
        if (route.path.length < 2 || !route.path.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))) throw new Error('路线数据无效')
        cacheDirection(key, route)
        return route
    })().finally(() => inFlight.delete(key))
    inFlight.set(key, pending)
    return pending
}
