import type { RoutePath, RouteCoordinate } from './route-cache'

const cache = new WeakMap<RoutePath, RoutePath>()

/** Display-only smoothing. Raw navigation geometry and distance remain intact. */
export function smoothRoutePath(path: RoutePath): RoutePath {
    const cached = cache.get(path)
    if (cached) return cached
    if (path.length < 3) return path
    const scale = Math.max(0.01, Math.cos(path[0].lat * Math.PI / 180))
    const x = (p: RouteCoordinate) => (p.lng - path[0].lng) * 111000 * scale
    const y = (p: RouteCoordinate) => (p.lat - path[0].lat) * 111000
    const distance = (a: RouteCoordinate, b: RouteCoordinate) => Math.hypot(x(a) - x(b), y(a) - y(b))
    const points = [path[0]]
    for (let i = 1; i < path.length - 1; i++) {
        if (distance(points[points.length - 1], path[i]) >= 0.3) points.push(path[i])
    }
    points.push(path[path.length - 1])

    // Remove sub-metre jitter with bounded-error Douglas–Peucker simplification.
    const keep = new Set([0, points.length - 1])
    const stack: Array<[number, number]> = [[0, points.length - 1]]
    while (stack.length) {
        const [start, end] = stack.pop()!
        const a = points[start], b = points[end]
        const dx = x(b) - x(a), dy = y(b) - y(a), length2 = dx * dx + dy * dy
        let furthest = -1, maxError = 1
        for (let i = start + 1; i < end; i++) {
            const px = x(points[i]) - x(a), py = y(points[i]) - y(a)
            const t = length2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / length2)) : 0
            const error = (px - t * dx) ** 2 + (py - t * dy) ** 2
            if (error > maxError) { maxError = error; furthest = i }
        }
        if (furthest >= 0) { keep.add(furthest); stack.push([start, furthest], [furthest, end]) }
    }
    const simplified = points.filter((_, i) => keep.has(i))
    const result = [simplified[0]]
    const lerp = (a: RouteCoordinate, b: RouteCoordinate, t: number): RouteCoordinate => ({ lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t })
    for (let i = 1; i < simplified.length - 1; i++) {
        const previous = simplified[i - 1], point = simplified[i], next = simplified[i + 1]
        const incoming = distance(previous, point), outgoing = distance(point, next)
        const cosine = incoming && outgoing ? ((x(point) - x(previous)) * (x(next) - x(point)) + (y(point) - y(previous)) * (y(next) - y(point))) / (incoming * outgoing) : -1
        // Preserve U-turns; round ordinary corners only within six metres.
        if (cosine < -0.5 || !incoming || !outgoing) { result.push(point); continue }
        const radius = Math.min(6, incoming * 0.25, outgoing * 0.25)
        const entry = lerp(point, previous, radius / incoming), exit = lerp(point, next, radius / outgoing)
        result.push(entry)
        for (let step = 1; step <= 6; step++) {
            const t = step / 6
            result.push(lerp(lerp(entry, point, t), lerp(point, exit, t), t))
        }
    }
    result.push(simplified[simplified.length - 1])
    cache.set(path, result)
    return result
}
