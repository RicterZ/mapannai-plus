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
    // Collapse only short excursions inside a narrow corridor. Bounded length
    // and deviation prevent large road loops / U-turns from being shortcut.
    const localPoints = [endpointCleaned[0]]
    for (let start = 0; start < endpointCleaned.length - 1;) {
        let chosen = start + 1
        if (Math.min(distance(endpointCleaned[start], path[0]), distance(endpointCleaned[start], path[path.length - 1])) <= 300) {
            let arc = 0, extent = 0
            for (let end = start + 1; end < endpointCleaned.length; end++) {
                arc += distance(endpointCleaned[end - 1], endpointCleaned[end])
                extent = Math.max(extent, distance(endpointCleaned[start], endpointCleaned[end]))
                if (arc > 500 || extent > 180) break
                const chord = distance(endpointCleaned[start], endpointCleaned[end])
                if (end >= start + 3 && chord <= 50 && arc - chord >= 100 && arc >= Math.max(1, chord) * 3.5) chosen = end
            }
        }
        localPoints.push(endpointCleaned[chosen])
        start = chosen
    }
    const cleaned = [localPoints[0]]
    for (let start = 0; start < localPoints.length - 1;) {
        let chosen = start + 1, arc = 0
        for (let end = start + 1; end < Math.min(localPoints.length, start + 33); end++) {
            arc += distance(localPoints[end - 1], localPoints[end])
            if (arc > 80) break
            const chord = distance(localPoints[start], localPoints[end])
            if (end < start + 2 || arc < 3 || arc < Math.max(1, chord) * 1.4) continue
            let maximum = 0
            for (let i = start + 1; i < end; i++) {
                maximum = Math.max(maximum, segmentError(localPoints[i], localPoints[start], localPoints[end]))
            }
            if (maximum <= 10) chosen = end
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
        let furthest = -1, maxError = 2
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
        const radius = Math.min(18, incoming * 0.45, outgoing * 0.45)
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
