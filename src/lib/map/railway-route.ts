import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'
import type { MapRoute, RoutePoint } from '@/types/map-provider'
import { isInChina } from '@/lib/coord-transform'
import { calculateDistance } from '@/utils/distance'

type RailNode = RoutePoint & { id: number }
type RailNetwork = { nodes: Map<number, RailNode>; graph: Map<number, [number, number][]> }
const networks = new WeakMap<unknown[], RailNetwork>()
const distance = (a: RoutePoint, b: RoutePoint) => calculateDistance(a.lat, a.lng, b.lat, b.lng)

/** Physical track geometry only: no timetable or passenger-service inference. */
export function railwayPath(elements: unknown[], origin: RoutePoint, destination: RoutePoint): MapRoute {
    const cached = networks.get(elements)
    const nodes = cached?.nodes ?? new Map<number, RailNode>()
    const ways: number[][] = []
    if (!cached) for (const raw of elements) {
        const item = raw as Record<string, any> | null
        if (!item || typeof item !== 'object') continue
        if (item.type === 'node' && Number.isSafeInteger(item.id) && Number.isFinite(item.lat) && Number.isFinite(item.lon) && Math.abs(item.lat) <= 90 && Math.abs(item.lon) <= 180) {
            nodes.set(item.id, { id: item.id, lat: item.lat, lng: item.lon })
        } else if (item.type === 'way' && Array.isArray(item.nodes) && item.nodes.every(Number.isSafeInteger) && item.tags?.railway === 'rail' && !item.tags.service) ways.push(item.nodes)
    }
    const network = cached ?? buildNetwork(nodes, ways)
    if (!cached) networks.set(elements, network)
    return routeNetwork(network, origin, destination)
}

function buildNetwork(nodes: Map<number, RailNode>, ways: number[][]): RailNetwork {
    const graph = new Map<number, [number, number][]>()
    for (const way of ways) for (let i = 1; i < way.length; i++) {
        const a = nodes.get(way[i - 1]), b = nodes.get(way[i])
        if (!a || !b) continue
        const length = distance(a, b)
        for (const [from, to] of [[a, b], [b, a]]) {
            if (!graph.has(from.id)) graph.set(from.id, [])
            graph.get(from.id)!.push([to.id, length])
        }
    }
    return { nodes, graph }
}

function routeNetwork({ nodes, graph }: RailNetwork, origin: RoutePoint, destination: RoutePoint): MapRoute {
    const candidates = (point: RoutePoint) => {
        const nearby: { id: number; gap: number }[] = []
        graph.forEach((_, id) => {
            const gap = distance(point, nodes.get(id)!)
            if (gap <= 5000) nearby.push({ id, gap })
        })
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
        for (const [id, length] of graph.get(current.id) ?? []) {
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

const offlineNetworks = new Map<string, RailNetwork>()

export async function getRailwayRoute(origin: RoutePoint, destination: RoutePoint): Promise<MapRoute> {
    const inJapan = (p: RoutePoint) => p.lat >= 20 && p.lat <= 46 && p.lng >= 122 && p.lng <= 154
    const region = isInChina(origin.lng, origin.lat) && isInChina(destination.lng, destination.lat) ? 'china' : inJapan(origin) && inJapan(destination) ? 'japan' : null
    if (!region) return { path: [origin, destination], distance: null, duration: null, fallback: 'NO_ROUTE' }
    let network = offlineNetworks.get(region)
    if (!network) {
        const data = JSON.parse(gunzipSync(readFileSync(path.join(process.cwd(), `src/lib/map/railway-data/${region}-railway.json.gz`))).toString('utf8')) as { nodes: number[][]; ways: number[][] }
        const nodes = new Map<number, RailNode>()
        for (const [id, lat, lng] of data.nodes) nodes.set(id, { id, lat, lng })
        network = buildNetwork(nodes, data.ways)
        offlineNetworks.set(region, network)
    }
    return routeNetwork(network, origin, destination)
}
