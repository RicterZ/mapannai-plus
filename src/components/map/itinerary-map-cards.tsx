'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMapStore } from '@/store/map-store'
import { routeColor } from '@/lib/map/route-presentation'
import { itineraryCardSize, itineraryLeaderEnd, layoutItineraryCards, sameItineraryPlacements, type MapCardPlacement } from '@/lib/map/itinerary-card-layout'
import type { MarkerCoordinates } from '@/types/marker'
import { itineraryAnchors } from '@/lib/map/itinerary-anchors'
import type { MapAnchor } from './sdk-map-renderer'

interface Props {
    createAnchor: (coordinates: MarkerCoordinates) => MapAnchor | undefined
    routePaths: () => Array<Array<{ x: number; y: number }>>
    project: (coordinates: MarkerCoordinates) => { x: number; y: number } | undefined
    subscribe: (update: () => void, moving: () => void) => () => void
    onMarkerClick: (id: string) => void
    onFitMarkers: (ids: string[]) => void
}


export function ItineraryMapCards({ createAnchor, project, routePaths, subscribe, onMarkerClick, onFitMarkers }: Props) {
    const { activeView, tripDays, markers, leftSidebar, interactionState, setActiveView } = useMapStore()
    const root = useRef<HTMLDivElement>(null)
    const [placements, setPlacements] = useState<MapCardPlacement[]>([])
    const [moving, setMoving] = useState(false)
    // Each label lives inside a native map overlay at its anchor, so the map itself moves it during pan/zoom.
    const anchorsRef = useRef(new Map<string, MapAnchor>())
    const [anchorNodes, setAnchorNodes] = useState<Map<string, HTMLElement>>(new Map())
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
                    eyebrow: `${date} · ${["周日","周一","周二","周三","周四","周五","周六"][new Date(day.date + "T12:00:00").getDay()]}`,
                    title: `第${dayIndex}天`,
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
        const ensureAnchors = () => {
            let added = false
            for (const card of cards) {
                if (anchorsRef.current.has(card.id)) continue
                const anchor = createAnchor(card.coordinates)
                if (anchor) { anchorsRef.current.set(card.id, anchor); added = true }
            }
            if (added) setAnchorNodes(new Map(Array.from(anchorsRef.current, ([id, anchor]) => [id, anchor.node])))
        }
        const update = () => {
            if (frame) return
            frame = requestAnimationFrame(() => {
                frame = 0
                ensureAnchors()
                if (element.clientWidth < 1024) return
                const rect = element.getBoundingClientRect()
                const anchors = cards.flatMap(card => { const p = project(card.coordinates); return p ? [{ id: card.id, ...p }] : [] })
                const rightPanel = interactionState.isSidebarOpen ? document.querySelector('.right-sidebar')?.getBoundingClientRect().width || 400 : 0
                setPlacements(previous => {
                    const next = layoutItineraryCards(anchors, { left: leftSidebar.isOpen ? 420 : 20, top: 100, right: rect.width - rightPanel - 76, bottom: rect.height - 90 }, routePaths(), previous)
                    return sameItineraryPlacements(previous, next) ? previous : next
                })
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
    }, [cards, createAnchor, project, routePaths, subscribe, leftSidebar.isOpen, interactionState.isSidebarOpen, hidden])

    useEffect(() => () => {
        anchorsRef.current.forEach(anchor => anchor.dispose())
        anchorsRef.current.clear()
        setAnchorNodes(new Map())
    }, [cards, createAnchor])

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
        {!hidden && placements.map(p => {
            const card = cards.find(card => card.id === p.id), node = anchorNodes.get(p.id)
            if (!card || !node) return null
            const end = itineraryLeaderEnd(p)
            return createPortal(<>
                <svg aria-hidden="true" width="1" height="1" className="pointer-events-none absolute left-0 top-0 overflow-visible">
                    <line x1={0} y1={0} x2={end.x - p.x} y2={end.y - p.y} stroke={card.color} strokeWidth="1" />
                    <circle cx={0} cy={0} r="4" fill="white" stroke={card.color} strokeWidth="2" />
                </svg>
                <button type="button" title={`${card.eyebrow} · ${card.title}`} onClick={event => { event.stopPropagation(); if (card.markerId) onMarkerClick(card.markerId); else setActiveView('day', activeView.tripId, card.dayId, { focusFirstMarker: false }) }}
                    className="absolute flex items-center gap-2 overflow-hidden whitespace-nowrap rounded-md border border-gray-200 border-l-[3px] bg-white px-3 text-left shadow-[0_3px_18px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                    style={{ left: p.left - p.x, top: p.top - p.y, width: itineraryCardSize.width, height: itineraryCardSize.height, borderLeftColor: card.color }}>
                    <span className="min-w-0 truncate text-sm font-medium text-gray-900">{card.title}</span>
                    <span className="shrink-0 text-[11px] text-gray-400">{card.eyebrow}</span>
                </button>
            </>, node, p.id)
        })}
    </div>
}
