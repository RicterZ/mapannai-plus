'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMapStore } from '@/store/map-store'
import { routeColor, transportLabels } from '@/lib/map/route-presentation'
import { getBezierPath } from '@/lib/map/connection-geometry'
import { routeTransportMode } from '@/lib/map/route-mode'
import { formatPlannedDuration } from '@/components/trips/route-schedule'
import { itineraryCardSize, itineraryLeaderEnd, layoutItineraryCards, sameItineraryPlacements, type MapCardPlacement } from '@/lib/map/itinerary-card-layout'
import type { MarkerCoordinates } from '@/types/marker'
import { itineraryAnchors } from '@/lib/map/itinerary-anchors'
import type { MapAnchor } from './sdk-map-renderer'

interface Props {
    createAnchor: (coordinates: MarkerCoordinates) => MapAnchor | undefined
    routeMidpoint: (key: string) => MarkerCoordinates | undefined
    routePaths: () => Array<Array<{ x: number; y: number }>>
    project: (coordinates: MarkerCoordinates) => { x: number; y: number } | undefined
    subscribe: (update: () => void, moving: () => void) => () => void
    onMarkerClick: (id: string) => void
    onFitMarkers: (ids: string[]) => void
}


export function ItineraryMapCards({ createAnchor, routeMidpoint, project, routePaths, subscribe, onMarkerClick, onFitMarkers }: Props) {
    const { activeView, tripDays, markers, leftSidebar, interactionState, setActiveView } = useMapStore()
    const root = useRef<HTMLDivElement>(null)
    const [placements, setPlacements] = useState<MapCardPlacement[]>([])
    const [moving, setMoving] = useState(false)
    // Each label lives inside a native map overlay at its anchor, so the map itself moves it during pan/zoom.
    const anchorsRef = useRef(new Map<string, MapAnchor & { coordinates: MarkerCoordinates }>())
    const [anchorNodes, setAnchorNodes] = useState<Map<string, HTMLElement>>(new Map())
    const hoveredCard = useRef<string | null>(null)
    const [hidden, setHidden] = useState(false)
    const cards = useMemo(() => {
        const byId = new Map(markers.map(marker => [marker.id, marker]))
        const days = tripDays.filter(day => day.tripId === activeView.tripId).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
        const anchors = itineraryAnchors(days, markers, false)
        return days.filter(day => activeView.mode === 'trip' || day.id === activeView.dayId).flatMap(day => {
            const ids = Array.from(new Set([...day.chains.flat(), ...day.markerIds])).filter(id => byId.has(id))
            const color = routeColor(0, day.id, day.colorIndex)
            const date = `${Number(day.date.slice(5, 7))}月${Number(day.date.slice(8, 10))}日`
            const places = ids.filter(id => anchors.get(day.id)?.includes(id)).map(id => {
                const marker = byId.get(id)!
                const stop = day.routeChains?.flatMap((route, i) => route.stops.every((item, j) => item.markerId === day.chains[i]?.[j]) ? route.stops : []).find(item => item.markerId === id && item.isHighlight)
                const timing = [stop?.startTime, stop?.durationMinutes !== undefined ? `停留 ${formatPlannedDuration(stop.durationMinutes)}` : null].filter(Boolean).join(' · ')
                return { id: `${day.id}:${id}`, dayId: day.id, markerId: id as string | null, coordinates: marker.coordinates, color,
                    eyebrow: date, timing, note: stop?.note || '', title: marker.content.title || '未命名地点',
                    routeKey: null as string | null, legMarkerIds: null as string[] | null,
                }
            })
            // Arranged legs get the same card at the midpoint of their displayed link.
            const legs = day.chains.flatMap((chain, chainIndex) => chain.slice(1).flatMap((toId, index) => {
                const fromId = chain[index], route = day.routeChains?.[chainIndex]
                const from = byId.get(fromId), to = byId.get(toId), mode = routeTransportMode(route, fromId, toId)
                // Manual highlights apply to any transport mode.
                if (!from || !to || !mode || !route) return []
                const fromStop = route.stops[index], toStop = route.stops[index + 1]
                const leg = route.legs.find(item => item.fromStopId === fromStop?.id && item.toStopId === toStop?.id)
                if (!leg?.isHighlight) return []
                const curve = getBezierPath({ lat: from.coordinates.latitude, lng: from.coordinates.longitude }, { lat: to.coordinates.latitude, lng: to.coordinates.longitude })
                const [lng, lat] = curve[curve.length >> 1]
                const timing = [leg?.startTime, leg?.durationMinutes !== undefined ? formatPlannedDuration(leg.durationMinutes) : null].filter(Boolean).join(' · ')
                return [{ id: `${day.id}:leg:${chainIndex}:${index}`, dayId: day.id, markerId: null as string | null, coordinates: { latitude: lat, longitude: lng }, color,
                    eyebrow: date, timing, note: leg?.note || '', title: [transportLabels[mode], leg?.serviceNumber].filter(Boolean).join(' '),
                    routeKey: `${day.id}:${chainIndex}:${index}`, legMarkerIds: [fromId, toId] }]
            }))
            // Automatic selection remains paused.
            return [...places, ...legs]
        })
    }, [activeView.mode, activeView.tripId, activeView.dayId, tripDays, markers])

    useEffect(() => {
        const element = root.current
        if (!element || hidden) return
        let frame = 0
        let settled: ReturnType<typeof setTimeout> | undefined
        const position = (card: typeof cards[number]) => (card.routeKey && routeMidpoint(card.routeKey)) || card.coordinates
        const ensureAnchors = () => {
            let added = false
            for (const card of cards) {
                const coordinates = position(card), current = anchorsRef.current.get(card.id)
                if (current && Math.abs(current.coordinates.latitude - coordinates.latitude) < 1e-7 && Math.abs(current.coordinates.longitude - coordinates.longitude) < 1e-7) continue
                current?.dispose()
                const anchor = createAnchor(coordinates)
                if (anchor) anchorsRef.current.set(card.id, { ...anchor, coordinates }); else anchorsRef.current.delete(card.id)
                added = true
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
                const anchors = cards.flatMap(card => { const p = project(position(card)); const button = anchorsRef.current.get(card.id)?.node.querySelector('button'); return p ? [{ id: card.id, ...p, height: button?.getBoundingClientRect().height || itineraryCardSize.height }] : [] })
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
        anchorsRef.current.forEach(anchor => { const button = anchor.node.querySelector('button'); if (button) observer.observe(button) })
        window.addEventListener('itineraryRoutesChanged', update)
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
        return () => { observer.disconnect(); window.removeEventListener('itineraryRoutesChanged', update); unsubscribe(); clearTimeout(settled); cancelAnimationFrame(frame) }
    }, [anchorNodes, cards, createAnchor, routeMidpoint, project, routePaths, subscribe, leftSidebar.isOpen, interactionState.isSidebarOpen, hidden])

    useEffect(() => () => {
        anchorsRef.current.forEach(anchor => anchor.dispose())
        anchorsRef.current.clear()
        setAnchorNodes(new Map())
    }, [cards, createAnchor])

    useEffect(() => () => {
        if (hoveredCard.current) {
            hoveredCard.current = null
            window.dispatchEvent(new CustomEvent('markerDayHover', { detail: { dayId: null } }))
        }
    }, [cards, hidden])

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
                <button type="button"
                    onMouseEnter={() => { hoveredCard.current = card.id; window.dispatchEvent(new CustomEvent('markerDayHover', { detail: { dayId: card.dayId } })) }}
                    onMouseLeave={() => { hoveredCard.current = null; window.dispatchEvent(new CustomEvent('markerDayHover', { detail: { dayId: null } })) }}
                    title={[card.title, card.eyebrow, card.timing, card.note].filter(Boolean).join('\n')} onClick={event => { event.stopPropagation(); if (card.markerId) onMarkerClick(card.markerId); else if (card.legMarkerIds) onFitMarkers(card.legMarkerIds); else setActiveView('day', activeView.tripId, card.dayId, { focusFirstMarker: false }) }}
                    className="absolute flex flex-col items-stretch gap-1 overflow-hidden whitespace-normal py-2 rounded-md border border-gray-200 border-l-[3px] bg-white px-3 text-left shadow-[0_3px_18px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                    style={{ left: p.left - p.x, top: p.top - p.y, width: itineraryCardSize.width, borderLeftColor: card.color }}>
                    <span className="flex items-baseline gap-2"><span className="min-w-0 flex-1 break-words text-sm font-medium text-gray-900">{card.title}</span><span className="shrink-0 text-[11px] text-gray-400">{card.eyebrow}</span></span>
                    {card.timing && <span className="text-xs text-gray-600">{card.timing}</span>}
                    {card.note && <span className="whitespace-pre-wrap break-words text-xs leading-5 text-gray-500">{card.note}</span>}
                </button>
            </>, node, p.id)
        })}
    </div>
}
