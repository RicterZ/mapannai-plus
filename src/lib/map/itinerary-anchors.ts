import type { Marker } from '@/types/marker'
import type { TripDay } from '@/types/trip'

/** Geographic separation only: never presented as a planned route distance. */
function separation(a: Marker, b: Marker): number {
    const rad = Math.PI / 180
    const lat = (b.coordinates.latitude - a.coordinates.latitude) * rad
    const lng = (b.coordinates.longitude - a.coordinates.longitude) * rad
    const h = Math.sin(lat / 2) ** 2 + Math.cos(a.coordinates.latitude * rad) * Math.cos(b.coordinates.latitude * rad) * Math.sin(lng / 2) ** 2
    return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)))
}

export function itineraryAnchors(days: TripDay[], markers: Marker[], automatic = true): Map<string, string[]> {
    const byId = new Map(markers.filter(m => Number.isFinite(m.coordinates.latitude) && Math.abs(m.coordinates.latitude) <= 90 && Number.isFinite(m.coordinates.longitude) && Math.abs(m.coordinates.longitude) <= 180).map(m => [m.id, m]))
    const segments = days.flatMap(day => day.chains.flatMap(chain => chain.slice(1).flatMap((id, i) => {
        const a = byId.get(chain[i]), b = byId.get(id)
        return a && b ? [{ dayId: day.id, from: a.id, to: b.id, distance: separation(a, b), chain }] : []
    })))
    const distances = segments.map(s => s.distance).filter(d => d > 0).sort((a, b) => a - b)
    const median = distances.length ? (distances[Math.floor((distances.length - 1) / 2)] + distances[Math.floor(distances.length / 2)]) / 2 : Infinity
    // With too few comparisons we cannot call a segment exceptional.
    const threshold = distances.length >= 3 ? Math.max(20000, median * 3) : Infinity
    return new Map(days.map(day => {
        const ids = Array.from(new Set([...day.chains.flat(), ...day.markerIds])).filter(id => byId.has(id))
        const visits = (day.routeChains || []).filter((route, i) => route.stops.length === day.chains[i]?.length && route.stops.every((stop, j) => stop.markerId === day.chains[i][j])).flatMap(route => route.stops).filter(stop => byId.has(stop.markerId))
        const highlighted = visits.filter(stop => stop.isHighlight === true).map(stop => stop.markerId)
        if (highlighted.length) return [day.id, Array.from(new Set(highlighted))]
        if (!automatic) return [day.id, []]
        const stops = visits.filter(stop => Number.isFinite(stop.durationMinutes) && stop.durationMinutes! > 0)
        const longest = Math.max(0, ...stops.map(stop => stop.durationMinutes!))
        const longSegments = segments.filter(segment => segment.dayId === day.id && segment.distance > threshold)
        let anchors = longest > 0 ? stops.filter(stop => stop.durationMinutes === longest).map(stop => stop.markerId) : longSegments.flatMap(segment => {
            const valid = segment.chain.filter(id => byId.has(id))
            return [valid[0], valid[valid.length - 1]]
        })
        if (!longest && anchors.length && ids.length > 1) {
            const chain = day.chains.find(chain => chain.length > 1 && chain[0] === chain[chain.length - 1])
            if (chain && byId.has(chain[0])) {
                const origin = byId.get(chain[0])!
                const farthest = ids.filter(id => id !== origin.id).sort((a, b) => separation(origin, byId.get(b)!) - separation(origin, byId.get(a)!))[0]
                if (farthest) anchors.push(farthest)
            }
        }
        return [day.id, Array.from(new Set(anchors.length ? anchors : ids.slice(-1)))]
    }))
}
