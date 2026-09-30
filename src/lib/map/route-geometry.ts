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
    const deduplicated = [path[0]]
    for (let i = 1; i < path.length - 1; i++) {
        if (distance(deduplicated[deduplicated.length - 1], path[i]) >= 0.3) deduplicated.push(path[i])
    }
    deduplicated.push(path[path.length - 1])

    // At a waypoint, remove an arrival/departure excursion that revisits
    // the same entrance. Preserve the waypoint itself, not the road detour.
    const trimEnd = (values: RoutePath): RoutePath => {
        const endpoint = values[values.length - 1]
        let arc = 0, extent = 0, chosen = values.length - 1
        for (let i = values.length - 2; i >= 0; i--) {
            arc += distance(values[i], values[i + 1])
            extent = Math.max(extent, distance(values[i], endpoint))
            if (arc > 500 || extent > 180) break
            const chord = distance(values[i], endpoint)
            if (chord <= 65 && arc - chord >= 30 && arc >= Math.max(1, chord) * 1.6) chosen = i
        }
        return chosen < values.length - 1 ? [...values.slice(0, chosen + 1), endpoint] : values
    }
    const endpointCleaned = trimEnd(trimEnd(deduplicated).slice().reverse()).reverse()

    const segmentError = (p: RouteCoordinate, a: RouteCoordinate, b: RouteCoordinate) => {
        const dx = x(b) - x(a), dy = y(b) - y(a), length2 = dx * dx + dy * dy
        const px = x(p) - x(a), py = y(p) - y(a)
        const t = length2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / length2)) : 0
        return Math.hypot(px - t * dx, py - t * dy)
    }
    // Prune waypoint access loops before simplifying small street details.
    const localPoints = [endpointCleaned[0]]
    for (let start = 0; start < endpointCleaned.length - 1;) {
        let chosen = start + 1
        // Small closed excursions are visual noise anywhere along a segment;
        // larger access loops still require proximity to a waypoint.
        const nearWaypoint = Math.min(distance(endpointCleaned[start], path[0]), distance(endpointCleaned[start], path[path.length - 1])) <= 300
        let arc = 0, extent = 0
        for (let end = start + 1; end < endpointCleaned.length; end++) {
            arc += distance(endpointCleaned[end - 1], endpointCleaned[end])
            extent = Math.max(extent, distance(endpointCleaned[start], endpointCleaned[end]))
            if (arc > 500 || extent > 180) break
            const chord = distance(endpointCleaned[start], endpointCleaned[end])
            const smallLoop = extent <= 60 && arc <= 300 && chord <= 20 && arc - chord >= 50
            if (end >= start + 3 && (nearWaypoint || smallLoop) && chord <= 50 && arc - chord >= (smallLoop ? 50 : 100) && arc >= Math.max(1, chord) * 3.5) chosen = end
        }
        localPoints.push(endpointCleaned[chosen])
        start = chosen
    }
    // A short bend / traffic circle within a 30m corridor can become a chord.
    // Limit arc length and detour ratio so major turns and larger loops survive.
    const cleaned = [localPoints[0]]
    for (let start = 0; start < localPoints.length - 1;) {
        let chosen = start + 1, arc = 0
        for (let end = start + 1; end < Math.min(localPoints.length, start + 129); end++) {
            arc += distance(localPoints[end - 1], localPoints[end])
            if (arc > 300) break
            const chord = distance(localPoints[start], localPoints[end])
            if (end < start + 2 || arc - chord < 8 || chord < arc * 0.5) continue
            let maximum = 0
            for (let i = start + 1; i < end; i++) {
                maximum = Math.max(maximum, segmentError(localPoints[i], localPoints[start], localPoints[end]))
            }
            if (maximum <= 30) chosen = end
        }
        cleaned.push(localPoints[chosen])
        start = chosen
    }

    // Remove small jitters with bounded-error Douglas–Peucker simplification.
    const keep = new Set([0, cleaned.length - 1])
    const stack: Array<[number, number]> = [[0, cleaned.length - 1]]
    while (stack.length) {
        const [start, end] = stack.pop()!
        const a = cleaned[start], b = cleaned[end]
        let furthest = -1, maxError = 6
        for (let i = start + 1; i < end; i++) {
            const error = segmentError(cleaned[i], a, b)
            if (error > maxError) { maxError = error; furthest = i }
        }
        if (furthest >= 0) { keep.add(furthest); stack.push([start, furthest], [furthest, end]) }
    }
    const simplified = cleaned.filter((_, i) => keep.has(i))
    const result = [simplified[0]]
    const lerp = (a: RouteCoordinate, b: RouteCoordinate, t: number): RouteCoordinate => ({ lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t })
    for (let i = 1; i < simplified.length - 1; i++) {
        const previous = simplified[i - 1], point = simplified[i], next = simplified[i + 1]
        const incoming = distance(previous, point), outgoing = distance(point, next)
        const cosine = incoming && outgoing ? ((x(point) - x(previous)) * (x(next) - x(point)) + (y(point) - y(previous)) * (y(next) - y(point))) / (incoming * outgoing) : -1
        // Large reversals remain intentional. Broader tangent-aligned rounds
        // remove the tiny straight stubs produced by the previous 25% trim.
        if (cosine < -0.85 || !incoming || !outgoing) { result.push(point); continue }
        const radius = Math.min(45, incoming * 0.45, outgoing * 0.45)
        const entry = lerp(point, previous, radius / incoming), exit = lerp(point, next, radius / outgoing)
        result.push(entry)
        for (let step = 1; step <= 10; step++) {
            const t = step / 10
            result.push(lerp(lerp(entry, point, t), lerp(point, exit, t), t))
        }
    }
    result.push(simplified[simplified.length - 1])
    cache.set(path, result)
    return result
}

interface DisplayRoute { dayId: string; path: RoutePath | null }

/** Spread shared corridors within a day; independent days keep their geography. */
export function layoutRoutePaths(routes: DisplayRoute[]): Array<RoutePath | null> {
    const paths = routes.map(route => route.path ? smoothRoutePath(route.path) : null)
    const sampleCount = 64
    const sampled = paths.map(path => {
        if (!path || path.length < 2) return null
        const scale = Math.max(0.01, Math.cos(path[0].lat * Math.PI / 180))
        const lengths = [0]
        for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot((path[i].lng - path[i - 1].lng) * 111000 * scale, (path[i].lat - path[i - 1].lat) * 111000))
        const total = lengths[lengths.length - 1]
        if (total < 120) return null
        let index = 1
        const points: RoutePath = []
        for (let i = 0; i <= sampleCount; i++) {
            const target = total * i / sampleCount
            while (index < path.length - 1 && lengths[index] < target) index++
            const t = (target - lengths[index - 1]) / (lengths[index] - lengths[index - 1] || 1)
            points.push({ lng: path[index - 1].lng + (path[index].lng - path[index - 1].lng) * t, lat: path[index - 1].lat + (path[index].lat - path[index - 1].lat) * t })
        }
        return { points, total, scale }
    })
    return paths.map((path, routeIndex) => {
        const sample = sampled[routeIndex]
        if (!path || !sample) return path
        const origin = path[0]
        const project = (p: RouteCoordinate) => ({ x: (p.lng - origin.lng) * 111000 * sample.scale, y: (p.lat - origin.lat) * 111000 })
        const points = sample.points.map(project)
        const weights = points.map(() => 0)
        for (let otherIndex = 0; otherIndex < routes.length; otherIndex++) {
            if (otherIndex === routeIndex || routes[otherIndex].dayId !== routes[routeIndex].dayId || !sampled[otherIndex]) continue
            const other = sampled[otherIndex]!.points.map(project)
            const near = points.map((point, index) => {
                const previous = points[Math.max(0, index - 1)], next = points[Math.min(sampleCount, index + 1)]
                const dx = next.x - previous.x, dy = next.y - previous.y
                let closest = Infinity
                for (let i = 1; i < other.length; i++) {
                    const a = other[i - 1], b = other[i], vx = b.x - a.x, vy = b.y - a.y
                    // Crossings do not qualify as a shared corridor.
                    if (Math.abs(dx * vx + dy * vy) < Math.hypot(dx, dy) * Math.hypot(vx, vy) * 0.85) continue
                    const t = Math.max(0, Math.min(1, ((point.x - a.x) * vx + (point.y - a.y) * vy) / (vx * vx + vy * vy || 1)))
                    closest = Math.min(closest, Math.hypot(point.x - a.x - t * vx, point.y - a.y - t * vy))
                }
                return Math.max(0, 1 - closest / 35)
            })
            if (near.filter(weight => weight > 0).length < 10) continue
            near.forEach((weight, index) => { weights[index] = Math.max(weights[index], weight) })
        }
        if (!weights.some(Boolean)) return path
        // Broad transitions and zero endpoint displacement avoid sudden kinks.
        let relaxed = weights
        for (let pass = 0; pass < 4; pass++) relaxed = relaxed.map((_, i) => {
            let sum = 0, count = 0
            for (let j = Math.max(0, i - 4); j <= Math.min(sampleCount, i + 4); j++) { sum += relaxed[j]; count++ }
            return sum / count
        })
        const amplitude = Math.min(90, sample.total * 0.035)
        // Travel-direction normal separates outbound / inbound routes naturally.
        // Retain all smoothed vertices; add samples on long straight spans so
        // a two-point corridor can bow too, without cutting existing corners.
        const dense = [path[0]]
        for (let i = 1; i < path.length; i++) {
            const a = path[i - 1], b = path[i]
            const length = Math.hypot((b.lng - a.lng) * 111000 * sample.scale, (b.lat - a.lat) * 111000)
            const steps = Math.max(1, Math.ceil(length / (sample.total / sampleCount)))
            for (let step = 1; step < steps; step++) dense.push({ lng: a.lng + (b.lng - a.lng) * step / steps, lat: a.lat + (b.lat - a.lat) * step / steps })
            dense.push(b)
        }
        let travelled = 0
        return dense.map((point, i) => {
            if (i === 0) return path[0]
            if (i === dense.length - 1) return path[path.length - 1]
            travelled += Math.hypot((point.lng - dense[i - 1].lng) * 111000 * sample.scale, (point.lat - dense[i - 1].lat) * 111000)
            const progress = travelled / sample.total
            const position = progress * sampleCount, low = Math.min(sampleCount - 1, Math.floor(position)), t = position - low
            const weight = relaxed[low] * (1 - t) + relaxed[low + 1] * t
            const normal = (index: number) => {
                const a = points[Math.max(0, index - 3)], b = points[Math.min(sampleCount, index + 3)]
                const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1
                return { x: -dy / length, y: dx / length }
            }
            const a = normal(low), b = normal(low + 1)
            const offset = amplitude * weight * Math.sin(Math.PI * progress) ** 2
            return { lng: point.lng + (a.x * (1 - t) + b.x * t) * offset / (111000 * sample.scale), lat: point.lat + (a.y * (1 - t) + b.y * t) * offset / 111000 }
        })
    })
}
