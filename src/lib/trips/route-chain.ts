import { v4 as randomUUID } from 'uuid'
import type { ChainLeg, ChainStop, RouteChain } from '@/types/trip'

export function projectChains(routes: RouteChain[]): string[][] {
    return routes.map(route => route.stops.map(stop => stop.markerId))
}
export function newRouteChain(markerIds: string[]): RouteChain {
    return { id: `chain_${randomUUID()}`, stops: markerIds.map(markerId => ({ id: `stop_${randomUUID()}`, markerId })), legs: [] }
}
export function retainAdjacentLegs(stops: ChainStop[], legs: ChainLeg[]): ChainLeg[] {
    const pairs = new Set(stops.slice(1).map((stop, index) => JSON.stringify([stops[index].id, stop.id])))
    return legs.filter(leg => pairs.has(JSON.stringify([leg.fromStopId, leg.toStopId])))
}
/** A marker's schedule follows its visit within this route, never across routes. */
export function reorderRouteStops(route: RouteChain, markerIds: string[]): RouteChain {
    const available = [...route.stops]
    const stops = markerIds.map(markerId => {
        const index = available.findIndex(stop => stop.markerId === markerId)
        return index < 0 ? { id: `stop_${randomUUID()}`, markerId } : available.splice(index, 1)[0]
    })
    const stopIds = new Set(stops.map(stop => stop.id))
    const edges = [...route.legs, ...(route.inactiveLegs ?? [])].filter(leg => stopIds.has(leg.fromStopId) && stopIds.has(leg.toStopId))
    const legs = retainAdjacentLegs(stops, edges)
    const active = new Set(legs)
    const inactiveLegs = edges.filter(leg => !active.has(leg))
    return { ...route, stops, legs, inactiveLegs: inactiveLegs.length ? inactiveLegs : undefined }
}
export function removeRouteMarker(routes: RouteChain[], markerId: string): RouteChain[] {
    return routes.map(route => {
        const stops = route.stops.filter(stop => stop.markerId !== markerId)
        const stopIds = new Set(stops.map(stop => stop.id))
        return { ...route, stops, legs: retainAdjacentLegs(stops, route.legs), inactiveLegs: route.inactiveLegs?.filter(leg => stopIds.has(leg.fromStopId) && stopIds.has(leg.toStopId)) }
    }).filter(route => route.stops.length > 0)
}

/** Legacy writers lack route IDs: match unchanged chains first, then only unambiguous edits.
 * Ambiguous edits to scheduled routes are rejected instead of moving schedules to the wrong route.
 */
export function reconcileLegacyChains(previous: RouteChain[], chains: string[][]): RouteChain[] {
    const used = new Set<string>()
    const matches: Array<RouteChain | undefined> = chains.map(ids => {
        const route = previous.find(item => !used.has(item.id) && JSON.stringify(item.stops.map(stop => stop.markerId)) === JSON.stringify(ids))
        if (route) used.add(route.id)
        return route
    })
    return chains.map((ids, index) => {
        let route = matches[index]
        if (!route) {
            const candidates = previous.filter(item => !used.has(item.id)).map(item => ({ item, overlap: item.stops.filter(stop => ids.includes(stop.markerId)).length }))
            const best = Math.max(0, ...candidates.map(candidate => candidate.overlap))
            const winners = candidates.filter(candidate => candidate.overlap === best && best > 0)
            if (winners.length === 1) route = winners[0].item
            else if (winners.some(({ item }) => (item.legs.length || item.inactiveLegs?.length) || item.stops.some(stop => stop.startTime !== undefined || stop.durationMinutes !== undefined || stop.note !== undefined))) {
                throw new Error('旧版路线修改无法确定安排归属，请按 chainId 修改路线')
            }
            if (route) used.add(route.id)
        }
        return route ? reorderRouteStops(route, ids) : newRouteChain(ids)
    })
}
