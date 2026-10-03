import { getDb } from './index'
import { getDayById, upsertTripDay } from './trip-service'
import { getMarkerById } from './marker-service'
import { newRouteChain, reorderRouteStops } from '@/lib/trips/route-chain'
import { routeChainPatchSchema, type RouteChainPatch } from '@/lib/trips/route-chain-schema'
import type { ChainLeg, ChainStop, TripDay } from '@/types/trip'

function target(tripId: string, dayId: string, chainId: string) {
    const day = getDayById(dayId)
    if (!day || day.tripId !== tripId) throw new Error('行程日不存在')
    const route = day.routeChains?.find(item => item.id === chainId)
    if (!route) throw new Error('路线不存在，请查询最新行程')
    return { day, route }
}
function patchFields<T extends object>(value: T, patch: object, keys: string[]): T {
    const result = { ...value } as T & Record<string, unknown>
    for (const key of keys) {
        const field = (patch as Record<string, unknown>)[key]
        if (field === null) delete result[key]
        else if (field !== undefined) Object.assign(result, { [key]: field })
    }
    return result
}
const scheduleKeys = ['startTime', 'durationMinutes', 'note']

export function createRouteChain(tripId: string, dayId: string, markerIds: string[]) {
    return getDb().transaction(() => {
        const day = getDayById(dayId)
        if (!day || day.tripId !== tripId) throw new Error('行程日不存在')
        if (markerIds.length < 2 || new Set(markerIds).size !== markerIds.length) throw new Error('路线需要至少两个不重复地点')
        if (markerIds.some(id => !getMarkerById(id))) throw new Error('路线包含不存在的地点')
        const route = newRouteChain(markerIds)
        const addedMarkerIds = markerIds.filter(id => !day.markerIds.includes(id))
        upsertTripDay({ ...day, markerIds: [...day.markerIds, ...addedMarkerIds] }, [...(day.routeChains ?? []), route])
        return { route, addedMarkerIds }
    })()
}

/** Partial metadata patches and reordering are atomic; omission preserves, null clears. */
export function updateRouteChain(tripId: string, dayId: string, chainId: string, input: RouteChainPatch): TripDay {
    const patch = routeChainPatchSchema.parse(input)
    return getDb().transaction(() => {
        const { day, route } = target(tripId, dayId, chainId)
        if (patch.markerIds) {
            if (new Set(patch.markerIds).size !== patch.markerIds.length) throw new Error('路线不能重复使用地点')
            if (patch.markerIds.some(id => !getMarkerById(id))) throw new Error('路线包含不存在的地点')
        }
        let updated = patch.markerIds ? reorderRouteStops(route, patch.markerIds) : route
        const stops = updated.stops.map(stop => ({ ...stop }))
        const legs = updated.legs.map(leg => ({ ...leg }))
        const seenStops = new Set<string>(), seenLegs = new Set<string>()
        for (const change of patch.stops ?? []) {
            if (seenStops.has(change.stopId)) throw new Error('同一次访问不能重复修改')
            seenStops.add(change.stopId)
            const index = stops.findIndex(stop => stop.id === change.stopId)
            if (index < 0) throw new Error('地点访问不属于这条路线')
            stops[index] = patchFields<ChainStop>(stops[index], change, scheduleKeys)
        }
        for (const change of patch.legs ?? []) {
            const pair = JSON.stringify([change.fromStopId, change.toStopId])
            if (seenLegs.has(pair)) throw new Error('同一路段不能重复修改')
            seenLegs.add(pair)
            const fromIndex = stops.findIndex(stop => stop.id === change.fromStopId)
            if (fromIndex < 0 || stops[fromIndex + 1]?.id !== change.toStopId) throw new Error('交通路段必须是当前路线中有方向的相邻访问')
            const index = legs.findIndex(leg => leg.fromStopId === change.fromStopId && leg.toStopId === change.toStopId)
            if (change.remove) {
                if ([...scheduleKeys, 'mode', 'serviceNumber'].some(key => (change as Record<string, unknown>)[key] !== undefined)) throw new Error('清除路段时不能同时修改字段')
                if (index >= 0) legs.splice(index, 1)
                continue
            }
            const mode = change.mode ?? (index >= 0 ? legs[index].mode : undefined)
            if (!mode) throw new Error('新建交通安排必须指定交通方式')
            const leg: ChainLeg = patchFields(index >= 0 ? legs[index] : { fromStopId: change.fromStopId, toStopId: change.toStopId, mode }, change, [...scheduleKeys, 'mode', 'serviceNumber'])
            if (index < 0) legs.push(leg)
            else legs[index] = leg
        }
        updated = { ...updated, stops, legs }
        const routes = day.routeChains!.map(item => item.id === chainId ? updated : item)
        const markerIds = [...day.markerIds, ...stops.map(stop => stop.markerId).filter(id => !day.markerIds.includes(id))]
        upsertTripDay({ ...day, markerIds }, routes)
        return getDayById(dayId)!
    })()
}
export function deleteRouteChain(tripId: string, dayId: string, chainId: string): TripDay {
    return getDb().transaction(() => {
        const { day } = target(tripId, dayId, chainId)
        upsertTripDay(day, day.routeChains!.filter(route => route.id !== chainId))
        return getDayById(dayId)!
    })()
}
