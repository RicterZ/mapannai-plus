import { useEffect, useMemo, useState } from 'react'
import { getPlannedRoute, readCachedRoute, routeCacheKey, RoutePath, RouteSegment } from './route-cache'
import { useRouteSettings } from './route-settings'

export interface RouteViewport { west: number; east: number; south: number; north: number; centerLat: number; centerLng: number }

function priority(segment: RouteSegment, viewport: RouteViewport): [number, number] {
    const { origin, destination } = segment
    const visible = Math.max(origin.lng, destination.lng) >= viewport.west &&
        Math.min(origin.lng, destination.lng) <= viewport.east &&
        Math.max(origin.lat, destination.lat) >= viewport.south &&
        Math.min(origin.lat, destination.lat) <= viewport.north
    const scale = Math.cos(viewport.centerLat * Math.PI / 180)
    const x1 = (origin.lng - viewport.centerLng) * scale, y1 = origin.lat - viewport.centerLat
    const dx = (destination.lng - origin.lng) * scale, dy = destination.lat - origin.lat
    const fraction = Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / (dx * dx + dy * dy || 1)))
    return [visible ? 0 : 1, (x1 + fraction * dx) ** 2 + (y1 + fraction * dy) ** 2]
}

export function usePlannedRoutes(segments: RouteSegment[], provider: string, viewport: RouteViewport | null): { enabled: boolean; routes: Record<string, RoutePath> } {
    const { enabled, mode } = useRouteSettings()
    const signature = segments.map(segment => routeCacheKey(provider, mode, segment)).join('|')
    const [routes, setRoutes] = useState<Record<string, RoutePath>>({})
    const requested = useMemo(() => new Map(segments.map(segment => [routeCacheKey(provider, mode, segment), segment])), [signature])
    useEffect(() => {
        if (!enabled) { setRoutes({}); return }
        let cancelled = false
        const cached: Record<string, RoutePath> = {}
        for (const key of Array.from(requested.keys())) {
            const path = readCachedRoute(key)
            if (path) cached[key] = path
        }
        setRoutes(cached)
        if (!viewport) return
        const ordered = Array.from(requested.entries()).filter(([key]) => !cached[key])
        ordered.sort(([, a], [, b]) => {
            const pa = priority(a, viewport), pb = priority(b, viewport)
            return pa[0] - pb[0] || pa[1] - pb[1]
        })
        // Schedule one segment at a time so a changed viewport can reprioritize the rest.
        void (async () => {
            for (const [key, segment] of ordered) {
                if (cancelled) break
                try {
                    const path = await getPlannedRoute(provider, mode, segment)
                    if (!cancelled) setRoutes(current => ({ ...current, [key]: path }))
                } catch (error) {
                    if (!cancelled) console.warn('路线规划失败:', error)
                }
            }
        })()
        return () => { cancelled = true }
    }, [enabled, mode, provider, requested, viewport?.west, viewport?.east, viewport?.south, viewport?.north, viewport?.centerLat, viewport?.centerLng])
    return { enabled, routes }
}
