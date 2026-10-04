import { getDb } from './index'
import type { MapRoute, RoutePoint, TravelMode } from '@/types/map-provider'

export function directionCacheKey(provider: string, mode: TravelMode, origin: RoutePoint, destination: RoutePoint): string {
    const point = (value: RoutePoint) => `${value.lat.toFixed(6)},${value.lng.toFixed(6)}`
    return `v1:${provider}:${mode}:${point(origin)}:${point(destination)}`
}

export function getCachedDirection(key: string): MapRoute | null {
    const row = getDb().prepare('SELECT route_json, created_at FROM direction_cache WHERE cache_key = ?').get(key) as { route_json: string; created_at: string } | undefined
    if (!row) return null
    try {
        const route = JSON.parse(row.route_json) as MapRoute
        if (key.includes(':transit:') && (!route.fallback || route.fallback === 'NO_ROUTE') && Date.now() - Date.parse(row.created_at) >= 3600000) return null
        return Array.isArray(route.path) && route.path.length >= 2 &&
            route.path.every(point => Number.isFinite(point.lat) && Number.isFinite(point.lng)) ? route : null
    } catch {
        return null
    }
}

export function cacheDirection(key: string, route: MapRoute): void {
    getDb().prepare(`INSERT INTO direction_cache (cache_key, route_json, created_at)
        VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET route_json = excluded.route_json, created_at = excluded.created_at`)
        .run(key, JSON.stringify(route), new Date().toISOString())
}
