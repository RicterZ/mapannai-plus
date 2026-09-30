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
export interface RouteMetrics { distance: number; duration: number }
const metricsCache = new Map<string, RouteMetrics>()
const cachePrefix = 'mapannai_route_v1:'
const inFlight = new Map<string, Promise<RoutePath>>()
const memoryCache = new Map<string, RoutePath>()
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
export function readRouteMetrics(key: string): RouteMetrics | null {
    const memory = metricsCache.get(key)
    if (memory) return memory
    try {
        const raw = localStorage.getItem(`${key}:metrics`)
        if (!raw) return null
        const metrics = JSON.parse(raw)
        return Number.isFinite(metrics.distance) && metrics.distance >= 0 && Number.isFinite(metrics.duration) && metrics.duration >= 0 ? metrics : null
    } catch { return null }
}
export async function getPlannedRoute(provider: string, mode: RouteMode, segment: RouteSegment): Promise<RoutePath> {
    const key = routeCacheKey(provider, mode, segment)
    const cached = readCachedRoute(key)
    if (cached) return cached
    const existing = inFlight.get(key)
    if (existing) return existing
    const promise = enqueueRequest(async () => {
        for (let attempt = 0; attempt < 4; attempt++) {
            const response = await fetchWithAuth('/api/directions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ origin: segment.origin, destination: segment.destination, mode }),
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
            memoryCache.set(key, path)
            if (Number.isFinite(data.distance) && Number.isFinite(data.duration) && data.distance >= 0 && data.duration >= 0) {
                const metrics = { distance: data.distance, duration: data.duration }
                metricsCache.set(key, metrics)
                try { localStorage.setItem(`${key}:metrics`, JSON.stringify(metrics)) } catch { /* storage unavailable */ }
            }
            try { localStorage.setItem(key, JSON.stringify(path)) } catch { /* storage full/private mode */ }
            return path
        }
        throw new Error('路线规划请求超过频率限制')
    }).finally(() => inFlight.delete(key))
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
