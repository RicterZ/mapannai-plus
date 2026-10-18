import type { MapRoute, RoutePoint } from '@/types/map-provider'
import { calculateDistance } from '@/utils/distance'

type RailNode = RoutePoint & { id: number }
type RailWay = { nodes: number[]; tags?: Record<string, string> }
const distance = (a: RoutePoint, b: RoutePoint) => calculateDistance(a.lat, a.lng, b.lat, b.lng)

/** Physical track geometry only: no timetable or passenger-service inference. */
export function railwayPath(elements: unknown[], origin: RoutePoint, destination: RoutePoint): MapRoute {
    const nodes = new Map<number, RailNode>()
    const ways: RailWay[] = []
    for (const raw of elements) {
        const item = raw as Record<string, any> | null
        if (!item || typeof item !== 'object') continue
        if (item.type === 'node' && Number.isSafeInteger(item.id) && Number.isFinite(item.lat) && Number.isFinite(item.lon) && Math.abs(item.lat) <= 90 && Math.abs(item.lon) <= 180) {
            nodes.set(item.id, { id: item.id, lat: item.lat, lng: item.lon })
        } else if (item.type === 'way' && Array.isArray(item.nodes) && item.nodes.every(Number.isSafeInteger) && item.tags?.railway === 'rail' && !item.tags.service) ways.push(item as unknown as RailWay)
    }
    const graph = new Map<number, Map<number, number>>()
    for (const way of ways) for (let i = 1; i < way.nodes.length; i++) {
        const a = nodes.get(way.nodes[i - 1]), b = nodes.get(way.nodes[i])
        if (!a || !b) continue
        const length = distance(a, b)
        for (const [from, to] of [[a, b], [b, a]]) {
            if (!graph.has(from.id)) graph.set(from.id, new Map())
            graph.get(from.id)!.set(to.id, length)
        }
    }
    const candidates = (point: RoutePoint) => {
        const nearby = Array.from(graph.keys()).map(id => ({ id, gap: distance(point, nodes.get(id)!) })).filter(node => node.gap < 1500)
        const nearest = nearby.reduce((gap, node) => Math.min(gap, node.gap), Infinity)
        // Stations have parallel tracks: do not lock both ends to unrelated nearest tracks.
        return nearby.filter(node => node.gap <= nearest + 100)
    }
    const starts = candidates(origin), ends = new Map(candidates(destination).map(node => [node.id, node.gap]))
    const empty: MapRoute = { path: [origin, destination], distance: null, duration: null, fallback: 'NO_ROUTE' }
    if (!starts.length || !ends.size) return empty
    const costs = new Map<number, number>(), previous = new Map<number, number>()
    const heap: { id: number; cost: number }[] = []
    const push = (id: number, cost: number) => {
        let i = heap.length
        heap.push({ id, cost })
        while (i > 0) {
            const parent = (i - 1) >> 1
            if (heap[parent].cost <= cost) break
            heap[i] = heap[parent]; i = parent
        }
        heap[i] = { id, cost }
    }
    for (const { id, gap } of starts) { costs.set(id, gap); push(id, gap) }
    let end: number | undefined, total = Infinity
    while (heap.length) {
        const current = heap[0], last = heap.pop()!
        if (heap.length) {
            let i = 0
            while (i * 2 + 1 < heap.length) {
                let child = i * 2 + 1
                if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++
                if (heap[child].cost >= last.cost) break
                heap[i] = heap[child]; i = child
            }
            heap[i] = last
        }
        if (current.cost !== costs.get(current.id)) continue
        if (current.cost >= total) break
        const endGap = ends.get(current.id)
        if (endGap !== undefined && current.cost + endGap < total) { end = current.id; total = current.cost + endGap }
        for (const [id, length] of Array.from(graph.get(current.id) ?? [])) {
            const cost = current.cost + length
            if (cost >= (costs.get(id) ?? Infinity)) continue
            costs.set(id, cost); previous.set(id, current.id); push(id, cost)
        }
    }
    if (end === undefined || !previous.has(end)) return empty
    const ids = [end]
    while (previous.has(ids[ids.length - 1])) ids.push(previous.get(ids[ids.length - 1])!)
    const track = ids.reverse().map(id => { const { lat, lng } = nodes.get(id)!; return { lat, lng } })
    // shortcut: shortest physical mainline, not a specific train; add line selection only if needed.
    return { path: [origin, ...track, destination], distance: total, duration: null }
}

export async function getRailwayRoute(origin: RoutePoint, destination: RoutePoint): Promise<MapRoute> {
    // Bound public Overpass work; large networks need regional extracts instead.
    if (distance(origin, destination) > 800000 || Math.abs(origin.lng - destination.lng) > 180) return { path: [origin, destination], distance: null, duration: null, fallback: 'OVER_DIRECTION_RANGE' }
    const south = Math.max(-90, Math.min(origin.lat, destination.lat) - 0.15)
    const north = Math.min(90, Math.max(origin.lat, destination.lat) + 0.15)
    const padding = Math.min(1, 0.15 / Math.max(0.15, Math.cos(origin.lat * Math.PI / 180)))
    const west = Math.max(-180, Math.min(origin.lng, destination.lng) - padding)
    const east = Math.min(180, Math.max(origin.lng, destination.lng) + padding)
    const query = `[out:json][timeout:25][maxsize:134217728];way[railway=rail][!service](${south},${west},${north},${east});(._;>;);out body;`
    const url = new URL(process.env.OSM_OVERPASS_URL || 'https://overpass-api.de/api/interpreter')
    url.searchParams.set('data', query)
    const response = await fetch(url, {
        headers: { 'User-Agent': 'MapAnNai/1.0 (railway geometry; https://github.com/RicterZ/mapannai-public)' },
        signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new Error(`OSM railway request failed (${response.status})`)
    const data = await response.json()
    if (data.remark || !Array.isArray(data.elements) || data.elements.length > 250000) throw new Error('OSM railway response incomplete or too large')
    return railwayPath(data.elements, origin, destination)
}
