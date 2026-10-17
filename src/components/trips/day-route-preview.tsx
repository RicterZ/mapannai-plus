import React from 'react'
import { Bike, Bus, Car, Footprints, Plane, Ship, TrainFront, Route } from 'lucide-react'
import type { Marker } from '@/types/marker'
import type { TripDay, TransportMode } from '@/types/trip'
import { formatPlannedDuration } from './route-schedule'

const transport: Record<TransportMode, { label: string; icon: typeof Route }> = {
    walking: { label: '步行', icon: Footprints }, cycling: { label: '骑行', icon: Bike },
    driving: { label: '驾车', icon: Car }, taxi: { label: '出租车', icon: Car },
    bus: { label: '公交', icon: Bus }, subway: { label: '地铁', icon: TrainFront },
    train: { label: '火车', icon: TrainFront }, flight: { label: '飞机', icon: Plane },
    ferry: { label: '轮船', icon: Ship }, other: { label: '其他交通', icon: Route },
}

export function DayRoutePreview({ day, markers }: { day: TripDay; markers: Marker[] }) {
    const byId = new Map(markers.map(marker => [marker.id, marker]))
    // Keep original indices: filtering missing places must not attach another route's schedule.
    const routes = day.chains.map((chain, index) => ({ chain: chain.filter(id => byId.has(id)), index }))
        .filter(({ chain }) => chain.length > 0)
    const assigned = new Set(routes.flatMap(({ chain }) => chain))
    const unplanned = markers.filter(marker => !assigned.has(marker.id))

    return <div className="journey-day-preview">
        {routes.map(({ chain, index }) => {
            const candidate = day.routeChains?.[index]
            const route = candidate?.stops.length === chain.length && candidate.stops.every((stop, i) => stop.markerId === chain[i]) ? candidate : undefined
            return <div key={index} className="mt-4">
                {routes.length > 1 && <div className="mb-2 text-[11px] text-gray-400">路线 {index + 1}</div>}
                <ol className="border-l border-gray-200 ml-1.5">
                    {chain.map((id, position) => {
                        const stop = route?.stops[position]
                        const next = route?.stops[position + 1]
                        const leg = stop && next ? route?.legs.find(item => item.fromStopId === stop.id && item.toStopId === next.id) : undefined
                        const mode = leg && transport[leg.mode]
                        const Icon = mode?.icon || Route
                        return <li key={`${position}-${id}`} className="relative pb-3 pl-4 last:pb-0">
                            <span aria-hidden="true" className="absolute -left-[4px] top-1.5 h-[7px] w-[7px] rounded-full border border-gray-400 bg-white" />
                            <div className="flex items-baseline gap-2">
                                <span className="min-w-0 flex-1 break-words text-xs leading-5 text-gray-700">{byId.get(id)!.content.title || '未命名地点'}</span>
                                {stop?.startTime && <span className="shrink-0 text-[11px] tabular-nums text-gray-500">{stop.startTime}</span>}
                            </div>
                            {stop?.durationMinutes !== undefined && <div className="text-[11px] text-gray-400">停留 {formatPlannedDuration(stop.durationMinutes)}</div>}
                            {stop?.note && <div className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-[11px] leading-5 text-gray-500">{stop.note}</div>}
                            {leg && <div className="mt-2 rounded-md bg-gray-50 px-2.5 py-2 text-[11px] leading-5 text-gray-500">
                                <div className="flex items-start gap-1.5"><Icon size={13} aria-hidden="true" className="mt-1 shrink-0" /><span className="min-w-0 flex-1 break-words">{mode?.label}{leg.serviceNumber && ` · ${leg.serviceNumber}`}</span></div>
                                {(leg.startTime || leg.durationMinutes !== undefined) && <div className="mt-0.5 tabular-nums">{[leg.startTime && `${leg.startTime} 出发`, leg.durationMinutes !== undefined && `计划 ${formatPlannedDuration(leg.durationMinutes)}`].filter(Boolean).join(' · ')}</div>}
                                {leg.note && <div className="mt-1 line-clamp-2 whitespace-pre-wrap break-words">{leg.note}</div>}
                            </div>}
                        </li>
                    })}
                </ol>
            </div>
        })}
        {unplanned.length > 0 && <div className="mt-3 text-[11px] leading-5 text-gray-400">
            未加入路线 · {unplanned.length} 个地点
            <div className="break-words text-xs text-gray-500">{unplanned.map(marker => marker.content.title || '未命名地点').join(' · ')}</div>
        </div>}
        {markers.length === 0 && <div className="mt-3 text-xs text-gray-400">还没有安排地点</div>}
        <div className="mt-3 text-[11px] text-gray-400">{markers.length} 个地点 · {routes.length} 条路线</div>
    </div>
}
