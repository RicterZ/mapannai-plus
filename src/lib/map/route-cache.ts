import { fetchWithAuth } from '@/lib/fetch-with-auth'
import type { RouteMode } from './route-settings'

export interface RouteCoordinate { lat: number; lng: number }
export interface RouteSegment {
    fromId: string
    toId: string
    origin: RouteCoordinate
    destination: RouteCoordinate
}
export type RoutePath = RouteCoordinate[]
const cachePrefix = 'mapannai_route_v1:'
const inFlight = new Map<string, Promise<RoutePath>>()
const memoryCache = new Map<string, RoutePath>()

export function routeCacheKey(provider: string, mode: RouteMode, segment: RouteSegment): string {
    const point = (p: RouteCoordinate) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`
    return `${cachePrefix}${provider}:${mode}:${segment.fromId}:${segment.toId}:${point(segment.origin)}:${point(segment.destination)}`
}
export function readCachedRoute(key: string): RoutePath | null {
    const memory = memoryCache.get(key)
    if (memory) return memory
    try {
        const raw = localStorage.getItem(key)
        if (!raw) return null
        const path = JSON.parse(raw)
        return Array.isArray(path) && path.length >= 2 && path.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)) ? path : null
    } catch { return null }
}
export async function getPlannedRoute(provider: string, mode: RouteMode, segment: RouteSegment): Promise<RoutePath> {
    const key = routeCacheKey(provider, mode, segment)
    const cached = readCachedRoute(key)
    if (cached) return cached
    const existing = inFlight.get(key)
    if (existing) return existing
    const promise = (async () => {
        const response = await fetchWithAuth('/api/directions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ origin: segment.origin, destination: segment.destination, mode }),
        })
        if (!response.ok) throw new Error('路线规划失败')
        const data = await response.json()
        const path = data.path as RoutePath
        if (!Array.isArray(path) || path.length < 2 || !path.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))) throw new Error('路线数据无效')
        memoryCache.set(key, path)
        try { localStorage.setItem(key, JSON.stringify(path)) } catch { /* storage full/private mode */ }
        return path
    })().finally(() => inFlight.delete(key))
    inFlight.set(key, promise)
    return promise
}

export function pointAlongPath(path: RoutePath, progress: number): RouteCoordinate {
    if (path.length < 2) return path[0] || { lat: 0, lng: 0 }
    const lengths = path.slice(1).map((point, index) => {
        const previous = path[index]
        const avgLat = (point.lat + previous.lat) * Math.PI / 360
        return Math.hypot((point.lat - previous.lat) * 111000, (point.lng - previous.lng) * 111000 * Math.cos(avgLat))
    })
    const total = lengths.reduce((sum, length) => sum + length, 0)
    if (!total) return path[0]
    let remaining = (progress % 1) * total
    for (let index = 0; index < lengths.length; index++) {
        if (remaining <= lengths[index] || index === lengths.length - 1) {
            const fraction = lengths[index] ? remaining / lengths[index] : 0
            return { lat: path[index].lat + (path[index + 1].lat - path[index].lat) * fraction, lng: path[index].lng + (path[index + 1].lng - path[index].lng) * fraction }
        }
        remaining -= lengths[index]
    }
    return path[path.length - 1]
}
