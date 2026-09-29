import { useEffect, useMemo, useState } from 'react'
import { getPlannedRoute, readCachedRoute, routeCacheKey, RoutePath, RouteSegment } from './route-cache'
import { useRouteSettings } from './route-settings'

export function usePlannedRoutes(segments: RouteSegment[], provider: string): { enabled: boolean; routes: Record<string, RoutePath> } {
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
        for (const [key, segment] of Array.from(requested.entries())) {
            if (cached[key]) continue
            getPlannedRoute(provider, mode, segment)
                .then(path => { if (!cancelled) setRoutes(current => ({ ...current, [key]: path })) })
                .catch(error => { if (!cancelled) console.warn('路线规划失败:', error) })
        }
        return () => { cancelled = true }
    }, [enabled, mode, provider, requested])
    return { enabled, routes }
}
