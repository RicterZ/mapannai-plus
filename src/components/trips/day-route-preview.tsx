import React from 'react'
import type { Marker } from '@/types/marker'
import type { TripDay } from '@/types/trip'

export function DayRoutePreview({ day, markers }: { day: TripDay; markers: Marker[] }) {
    const byId = new Map(markers.map(marker => [marker.id, marker]))
    const routes = day.chains.map(chain => chain.filter(id => byId.has(id))).filter(chain => chain.length > 0)
    const assigned = new Set(routes.flat())
    const unplanned = markers.filter(marker => !assigned.has(marker.id))

    return <div className="journey-day-preview">
        {routes.slice(0, 2).map((chain, index) => <div key={index} className="mt-3">
            {routes.length > 1 && <div className="mb-1.5 text-[11px] text-gray-400">路线 {index + 1}</div>}
            <ol className="journey-preview-stops">
                {chain.slice(0, 3).map(id => <li key={id} className="break-words text-xs leading-5 text-gray-600">{byId.get(id)!.content.title || '未命名地点'}</li>)}
            </ol>
            {chain.length > 3 && <div className="mt-1 pl-4 text-[11px] text-gray-400">还有 {chain.length - 3} 站</div>}
        </div>)}
        {routes.length > 2 && <div className="mt-2 text-[11px] text-gray-400">还有 {routes.length - 2} 条路线</div>}
        {unplanned.length > 0 && <div className="mt-3 text-[11px] leading-5 text-gray-400">
            未加入路线 · {unplanned.length} 个地点
            {routes.length === 0 && <div className="line-clamp-2 text-xs text-gray-500">{unplanned.map(marker => marker.content.title || '未命名地点').join(' · ')}</div>}
        </div>}
        {markers.length === 0 && <div className="mt-3 text-xs text-gray-400">还没有安排地点</div>}
        <div className="mt-3 text-[11px] text-gray-400">{markers.length} 个地点 · {routes.length} 条路线</div>
    </div>
}
