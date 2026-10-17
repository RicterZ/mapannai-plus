'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useMapStore } from '@/store/map-store'
import { routeColor } from '@/lib/map/route-presentation'
import { itineraryCardSize, layoutItineraryCards, type MapCardPlacement } from '@/lib/map/itinerary-card-layout'
import type { MarkerCoordinates } from '@/types/marker'
import { formatPlannedDuration } from '../trips/route-schedule'

interface Props {
    project: (coordinates: MarkerCoordinates) => { x: number; y: number } | undefined
    subscribe: (update: () => void) => () => void
    onMarkerClick: (id: string) => void
    onFitMarkers: (ids: string[]) => void
}
const modeLabels: Record<string, string> = { walking: '步行', cycling: '骑行', driving: '驾车', taxi: '出租车', bus: '公交', subway: '地铁', train: '火车', flight: '飞机', ferry: '轮船', other: '交通' }

export function ItineraryMapCards({ project, subscribe, onMarkerClick, onFitMarkers }: Props) {
    const { activeView, tripDays, markers, leftSidebar, interactionState, setActiveView } = useMapStore()
    const root = useRef<HTMLDivElement>(null)
    const [placements, setPlacements] = useState<MapCardPlacement[]>([])
    const [hidden, setHidden] = useState(false)
    const cards = useMemo(() => {
        const byId = new Map(markers.map(marker => [marker.id, marker]))
        const days = tripDays.filter(day => day.tripId === activeView.tripId).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
        return days.filter(day => activeView.mode === 'trip' || day.id === activeView.dayId).flatMap(day => {
            const ids = Array.from(new Set([...day.chains.flat(), ...day.markerIds])).filter(id => byId.has(id))
            const dayIndex = days.findIndex(item => item.id === day.id) + 1
            const color = routeColor(0, day.id, day.colorIndex)
            const date = `${Number(day.date.slice(5, 7))}月${Number(day.date.slice(8, 10))}日`
            if (activeView.mode === 'trip') {
                const first = byId.get(ids[0])
                if (!first) return []
                const legs = (day.routeChains || []).filter((route, index) => route.stops.length === day.chains[index]?.length && route.stops.every((stop, i) => stop.markerId === day.chains[index][i])).flatMap(route => route.legs.filter(leg => route.stops.some((stop, i) => stop.id === leg.fromStopId && route.stops[i + 1]?.id === leg.toStopId)))
                return [{ id: day.id, dayId: day.id, markerId: null as string | null, coordinates: first.coordinates, color,
                    eyebrow: `第${dayIndex}天 · ${date}`, title: day.title || '当天行程',
                    description: ids.map(id => byId.get(id)!.content.title || '未命名地点').join(' → '),
                    detail: legs.map(leg => [leg.startTime, modeLabels[leg.mode], leg.serviceNumber].filter(Boolean).join(' ')).join(' · ') || `${ids.length} 个地点`,
                }]
            }
            return ids.map((id, index) => {
                const marker = byId.get(id)!
                const route = day.routeChains?.find((route, routeIndex) => route.stops.length === day.chains[routeIndex]?.length && route.stops.every((stop, i) => stop.markerId === day.chains[routeIndex][i]) && route.stops.some(stop => stop.markerId === id))
                const stopIndex = route?.stops.findIndex(stop => stop.markerId === id) ?? -1
                const stop = route?.stops[stopIndex]
                const next = route?.stops[stopIndex + 1]
                const leg = next && route?.legs.find(leg => leg.fromStopId === stop?.id && leg.toStopId === next.id)
                return { id: `${day.id}:${id}`, dayId: day.id, markerId: id as string | null, coordinates: marker.coordinates, color,
                    eyebrow: `${date} · 地点 ${index + 1}`, title: marker.content.title || '未命名地点',
                    description: stop?.note || marker.content.address || '查看地点详情',
                    detail: [stop?.startTime && `${stop.startTime} 游览`, stop?.durationMinutes !== undefined && `停留 ${formatPlannedDuration(stop.durationMinutes)}`, leg && [leg.startTime, modeLabels[leg.mode], leg.serviceNumber].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
                }
            })
        })
    }, [activeView.mode, activeView.tripId, activeView.dayId, tripDays, markers])

    useEffect(() => {
        const element = root.current
        if (!element || hidden) return
        let frame = 0
        const update = () => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => {
                const rect = element.getBoundingClientRect()
                const anchors = cards.flatMap(card => { const p = project(card.coordinates); return p ? [{ id: card.id, ...p }] : [] })
                const rightPanel = interactionState.isSidebarOpen ? document.querySelector('.right-sidebar')?.getBoundingClientRect().width || 400 : 0
                setPlacements(layoutItineraryCards(anchors, { left: leftSidebar.isOpen ? 420 : 20, top: 100, right: rect.width - rightPanel - 76, bottom: rect.height - 90 }))
            })
        }
        const observer = new ResizeObserver(update)
        observer.observe(element)
        const unsubscribe = subscribe(update)
        update()
        return () => { observer.disconnect(); unsubscribe(); cancelAnimationFrame(frame) }
    }, [cards, project, subscribe, leftSidebar.isOpen, interactionState.isSidebarOpen, hidden])

    if (!cards.length) return null
    return <div ref={root} className="pointer-events-none absolute inset-0 z-20 hidden lg:block" aria-label="地图行程说明">
        <div className="pointer-events-auto absolute bottom-6 flex items-center gap-3 rounded-full border border-gray-200 bg-white/95 px-4 py-2 shadow-sm" style={{ left: leftSidebar.isOpen ? 420 : 20 }}>
            <button type="button" onClick={() => {
                const days = tripDays.filter(day => day.tripId === activeView.tripId && (activeView.mode === 'trip' || day.id === activeView.dayId))
                onFitMarkers(Array.from(new Set(days.flatMap(day => [...day.chains.flat(), ...day.markerIds]))))
            }} className="border-r border-gray-200 pr-3 text-xs text-gray-600">{activeView.mode === 'trip' ? '查看全程' : '查看当天'}</button>
            <button type="button" aria-pressed={!hidden} onClick={() => setHidden(value => !value)} className="text-xs text-gray-600">{hidden ? '显示行程卡片' : '隐藏行程卡片'}</button>
            {!hidden && <span className="text-[11px] text-gray-400">{placements.length} / {cards.length} · 放大地图查看沿途安排</span>}
        </div>
        {!hidden && <>
            <svg aria-hidden="true" className="absolute inset-0 h-full w-full overflow-hidden">
                {placements.map(p => {
                    const color = cards.find(card => card.id === p.id)!.color
                    return <g key={p.id}><line x1={p.x} y1={p.y} x2={Math.max(p.left, Math.min(p.left + itineraryCardSize.width, p.x))} y2={Math.max(p.top, Math.min(p.top + itineraryCardSize.height, p.y))} stroke={color} strokeWidth="1" /><circle cx={p.x} cy={p.y} r="4" fill="white" stroke={color} strokeWidth="2" /></g>
                })}
            </svg>
            {placements.map(p => {
                const card = cards.find(card => card.id === p.id)!
                return <button key={card.id} type="button" onClick={event => { event.stopPropagation(); if (card.markerId) onMarkerClick(card.markerId); else setActiveView('day', activeView.tripId, card.dayId, { focusFirstMarker: false }) }}
                    className="pointer-events-auto absolute overflow-hidden rounded-lg border border-gray-200 border-l-[3px] bg-white/95 px-4 py-3 text-left shadow-[0_3px_18px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                    style={{ left: p.left, top: p.top, width: itineraryCardSize.width, height: itineraryCardSize.height, borderLeftColor: card.color }}>
                    <div className="text-[11px]" style={{ color: card.color }}>{card.eyebrow}</div>
                    <div className="mt-1 truncate text-sm font-medium text-gray-900">{card.title}</div>
                    <div className="mt-2 line-clamp-2 break-words text-xs leading-5 text-gray-500">{card.description}</div>
                    {card.detail && <div className="mt-2 line-clamp-2 break-words text-[11px] leading-4 text-gray-600">{card.detail}</div>}
                </button>
            })}
        </>}
    </div>
}
