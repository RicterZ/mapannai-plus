import { fetchWithAuth } from '@/lib/fetch-with-auth'
import { resolveRouteMode } from './route-mode'
import type { TransportMode } from '@/types/trip'

export interface RouteCoordinate { lat: number; lng: number }
export interface RouteSegment {
    transportMode?: TransportMode
    fromId: string
    toId: string
    origin: RouteCoordinate
    destination: RouteCoordinate
}
export type RoutePath = RouteCoordinate[]
export interface RouteMetrics { distance: number; duration: number | null }
const fallbackPaths = new WeakSet<RoutePath>()
export function isRangeFallback(path: RoutePath | null | undefined): boolean { return !!path && fallbackPaths.has(path) }
const metricsCache = new Map<string, RouteMetrics>()
const cachePrefix = 'mapannai_route_v1:'
const inFlight = new Map<string, Promise<RoutePath>>()
const memoryCache = new Map<string, RoutePath>()
const transitExpires = new Map<string, number>()
const requestSpacingMs = 1200
let requestQueue: Promise<void> = Promise.resolve()
let nextRequestAt = 0

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

// All map views share this queue, so overview and day views cannot burst requests.
function enqueueRequest<T>(request: () => Promise<T>): Promise<T> {
    const queued = requestQueue.catch(() => {}).then(async () => {
        const delay = Math.max(0, nextRequestAt - Date.now())
        if (delay) await wait(delay)
        nextRequestAt = Date.now() + requestSpacingMs
        return request()
    })
    requestQueue = queued.then(() => {}, () => {})
    return queued
}

export function routeCacheKey(provider: string, segment: RouteSegment): string {
    const mode = resolveRouteMode(segment.origin, segment.destination, segment.transportMode) ?? 'schematic'
    const point = (p: RouteCoordinate) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`
    return `${mode === 'transit' ? 'mapannai_route_v2:' : cachePrefix}${provider}:${mode}:${segment.fromId}:${segment.toId}:${point(segment.origin)}:${point(segment.destination)}`
}
export function readCachedRoute(key: string): RoutePath | null {
    const memory = memoryCache.get(key)
    if (memory && (!key.includes(':transit:') || Date.now() < (transitExpires.get(key) ?? 0))) return memory
    try {
        const raw = localStorage.getItem(key)
        if (!raw) return null
        const stored = JSON.parse(raw)
        if (key.includes(':transit:') && (!stored.fallback || stored.fallback === 'NO_ROUTE') && (!Number.isFinite(stored.createdAt) || Date.now() - stored.createdAt >= 3600000)) return null
        const path = Array.isArray(stored) ? stored : stored.path
        if (stored.fallback && Array.isArray(path)) fallbackPaths.add(path)
        return Array.isArray(path) && path.length >= 2 && path.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)) ? path : null
    } catch { return null }
}
export function readRouteMetrics(key: string): RouteMetrics | null {
    const memory = metricsCache.get(key)
    if (memory) return memory
    try {
        const raw = localStorage.getItem(`${key}:metrics`)
        if (!raw) return null
        const metrics = JSON.parse(raw)
        return Number.isFinite(metrics.distance) && metrics.distance >= 0 && (metrics.duration === null || (Number.isFinite(metrics.duration) && metrics.duration >= 0)) ? metrics : null
    } catch { return null }
}
export async function getPlannedRoute(provider: string, segment: RouteSegment): Promise<RoutePath> {
    const mode = resolveRouteMode(segment.origin, segment.destination, segment.transportMode)
    const key = routeCacheKey(provider, segment)
    const cached = readCachedRoute(key)
    if (cached) return cached
    if (mode === null) {
        const path = [segment.origin, segment.destination]
        fallbackPaths.add(path)
        memoryCache.set(key, path)
        return path
    }
    const existing = inFlight.get(key)
    if (existing) return existing
    const promise = enqueueRequest(async () => {
        for (let attempt = 0; attempt < 4; attempt++) {
            const response = await fetchWithAuth('/api/directions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ origin: segment.origin, destination: segment.destination, ...(mode ? { mode } : {}), transportMode: segment.transportMode }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                const message = typeof data.error === 'string' ? data.error : '路线规划失败'
                if (/CUQPS_HAS_EXCEEDED_THE_LIMIT|QPS_HAS_EXCEEDED_THE_LIMIT/i.test(message) && attempt < 3) {
                    await wait(1500 * 2 ** attempt)
                    continue
                }
                throw new Error(message)
            }
            const path = data.path as RoutePath
            if (!Array.isArray(path) || path.length < 2 || !path.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))) throw new Error('路线数据无效')
            if (data.fallback) fallbackPaths.add(path)
            memoryCache.set(key, path)
            if (mode === 'transit') transitExpires.set(key, data.fallback && data.fallback !== 'NO_ROUTE' ? Infinity : Date.now() + 3600000)
            if (Number.isFinite(data.distance) && (data.duration === null || Number.isFinite(data.duration)) && data.distance >= 0 && (data.duration === null || data.duration >= 0)) {
                const metrics = { distance: data.distance, duration: data.duration }
                metricsCache.set(key, metrics)
                try { localStorage.setItem(`${key}:metrics`, JSON.stringify(metrics)) } catch { /* storage unavailable */ }
            }
            try { localStorage.setItem(key, JSON.stringify(data.fallback || mode === 'transit' ? { path, fallback: data.fallback, createdAt: Date.now() } : path)) } catch { /* storage full/private mode */ }
            return path
        }
        throw new Error('路线规划请求超过频率限制')
    }).finally(() => inFlight.delete(key))
    inFlight.set(key, promise)
    return promise
}

const pathMetrics = new WeakMap<RoutePath, { cumulative: number[]; total: number }>()

export function pointAlongPath(path: RoutePath, progress: number): RouteCoordinate {
    if (path.length < 2) return path[0] || { lat: 0, lng: 0 }
    let metrics = pathMetrics.get(path)
    if (!metrics) {
        const cumulative = [0]
        for (let index = 1; index < path.length; index++) {
            const point = path[index], previous = path[index - 1]
            const avgLat = (point.lat + previous.lat) * Math.PI / 360
            cumulative.push(cumulative[index - 1] + Math.hypot((point.lat - previous.lat) * 111000, (point.lng - previous.lng) * 111000 * Math.cos(avgLat)))
        }
        metrics = { cumulative, total: cumulative[cumulative.length - 1] }
        pathMetrics.set(path, metrics)
    }
    const { total, cumulative } = metrics
    if (!total) return path[0]
    const distance = Math.max(0, Math.min(1, progress)) * total
    let low = 1, high = cumulative.length - 1
    while (low < high) {
        const middle = (low + high) >>> 1
        if (cumulative[middle] < distance) low = middle + 1
        else high = middle
    }
    const index = low - 1
    const length = cumulative[low] - cumulative[index]
    const fraction = length ? (distance - cumulative[index]) / length : 0
    return { lat: path[index].lat + (path[low].lat - path[index].lat) * fraction, lng: path[index].lng + (path[low].lng - path[index].lng) * fraction }
}
