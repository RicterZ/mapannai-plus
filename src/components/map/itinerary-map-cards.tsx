'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useMapStore } from '@/store/map-store'
import { routeColor } from '@/lib/map/route-presentation'
import { itineraryCardSize, layoutItineraryCards, sameItineraryPlacements, type MapCardPlacement } from '@/lib/map/itinerary-card-layout'
import type { MarkerCoordinates } from '@/types/marker'
import { itineraryAnchors } from '@/lib/map/itinerary-anchors'

interface Props {
    routePaths: () => Array<Array<{ x: number; y: number }>>
    project: (coordinates: MarkerCoordinates) => { x: number; y: number } | undefined
    subscribe: (update: () => void, moving: () => void) => () => void
    onMarkerClick: (id: string) => void
    onFitMarkers: (ids: string[]) => void
}


export function ItineraryMapCards({ project, routePaths, subscribe, onMarkerClick, onFitMarkers }: Props) {
    const { activeView, tripDays, markers, leftSidebar, interactionState, setActiveView } = useMapStore()
    const root = useRef<HTMLDivElement>(null)
    const [placements, setPlacements] = useState<MapCardPlacement[]>([])
    const [moving, setMoving] = useState(false)
    const [hidden, setHidden] = useState(false)
    const cards = useMemo(() => {
        const byId = new Map(markers.map(marker => [marker.id, marker]))
        const days = tripDays.filter(day => day.tripId === activeView.tripId).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
        const anchors = itineraryAnchors(days, markers)
        return days.filter(day => activeView.mode === 'trip' || day.id === activeView.dayId).flatMap(day => {
            const ids = Array.from(new Set([...day.chains.flat(), ...day.markerIds])).filter(id => byId.has(id))
            const dayIndex = days.findIndex(item => item.id === day.id) + 1
            const color = routeColor(0, day.id, day.colorIndex)
            const date = `${Number(day.date.slice(5, 7))}月${Number(day.date.slice(8, 10))}日`
            if (activeView.mode === 'trip') {
                return (anchors.get(day.id) || []).map(id => ({
                    id: `${day.id}:${id}`, dayId: day.id, markerId: null as string | null,
                    coordinates: byId.get(id)!.coordinates, color,
                    eyebrow: `第${dayIndex}天 · ${date}`,
                    title: day.title || byId.get(id)!.content.title || '当天行程',
                }))
            }
            return ids.map((id, index) => {
                const marker = byId.get(id)!
                return { id: `${day.id}:${id}`, dayId: day.id, markerId: id as string | null, coordinates: marker.coordinates, color,
                    eyebrow: `${date} · 地点 ${index + 1}`, title: marker.content.title || '未命名地点',

                }
            })
        })
    }, [activeView.mode, activeView.tripId, activeView.dayId, tripDays, markers])

    useEffect(() => {
        const element = root.current
        if (!element || hidden) return
        let frame = 0
        let settled: ReturnType<typeof setTimeout> | undefined
        const update = () => {
            if (frame) return
            frame = requestAnimationFrame(() => {
                frame = 0
                if (element.clientWidth < 1024) return
                const rect = element.getBoundingClientRect()
                const anchors = cards.flatMap(card => { const p = project(card.coordinates); return p ? [{ id: card.id, ...p }] : [] })
                const rightPanel = interactionState.isSidebarOpen ? document.querySelector('.right-sidebar')?.getBoundingClientRect().width || 400 : 0
                const next = layoutItineraryCards(anchors, { left: leftSidebar.isOpen ? 420 : 20, top: 100, right: rect.width - rightPanel - 76, bottom: rect.height - 90 }, routePaths())
                setPlacements(previous => sameItineraryPlacements(previous, next) ? previous : next)
                setMoving(false)
            })
        }
        const observer = new ResizeObserver(update)
        observer.observe(element)
        const unsubscribe = subscribe(() => {
            clearTimeout(settled)
            settled = setTimeout(update, 180)
        }, () => {
            clearTimeout(settled)
            cancelAnimationFrame(frame)
            frame = 0
            setMoving(true)
        })
        update()
        return () => { observer.disconnect(); unsubscribe(); clearTimeout(settled); cancelAnimationFrame(frame) }
    }, [cards, project, routePaths, subscribe, leftSidebar.isOpen, interactionState.isSidebarOpen, hidden])

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
        {!hidden && <div aria-hidden={moving} className="absolute inset-0 transition-[opacity,transform] duration-200 motion-reduce:transition-none" style={{ opacity: moving ? 0 : 1, transform: moving ? 'scale(0.98)' : 'scale(1)', visibility: undefined, pointerEvents: moving ? 'none' : undefined }}>
            <svg aria-hidden="true" className="absolute inset-0 h-full w-full overflow-hidden">
                {placements.map(p => {
                    const card = cards.find(card => card.id === p.id)
                    if (!card) return null
                    const color = card.color
                    return <g key={p.id}><line x1={p.x} y1={p.y} x2={Math.max(p.left, Math.min(p.left + itineraryCardSize.width, p.x))} y2={Math.max(p.top, Math.min(p.top + itineraryCardSize.height, p.y))} stroke={color} strokeWidth="1" /><circle cx={p.x} cy={p.y} r="4" fill="white" stroke={color} strokeWidth="2" /></g>
                })}
            </svg>
            {placements.map(p => {
                const card = cards.find(card => card.id === p.id)
                if (!card) return null
                return <button key={card.id} type="button" title={`${card.eyebrow} · ${card.title}`} onClick={event => { event.stopPropagation(); if (card.markerId) onMarkerClick(card.markerId); else setActiveView('day', activeView.tripId, card.dayId, { focusFirstMarker: false }) }}
                    disabled={moving} className="pointer-events-auto disabled:pointer-events-none absolute overflow-hidden rounded-md border border-gray-200 border-l-[3px] bg-white px-3 py-2.5 text-left shadow-[0_3px_18px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                    style={{ left: p.left, top: p.top, width: itineraryCardSize.width, height: itineraryCardSize.height, borderLeftColor: card.color }}>
                    <div className="text-[11px]" style={{ color: card.color }}>{card.eyebrow}</div>
                    <div className="mt-1 truncate text-sm font-medium text-gray-900">{card.title}</div>
                </button>
            })}
        </div>}
    </div>
}
