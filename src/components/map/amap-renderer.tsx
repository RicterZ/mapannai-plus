'use client'

import { isRangeFallback } from '@/lib/map/route-cache'

import { startAnimationLoop } from '@/lib/ui/animation-loop'

import React, { useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useMapStore } from '@/store/map-store'
import type { Marker } from '@/types/marker'
import type { MarkerCoordinates } from '@/types/marker'
import { wgs84ToGcj02, gcj02ToWgs84 } from '@/lib/coord-transform'
import { getControlPoint, bezierPoint, getBezierPath } from '@/lib/map/connection-geometry'
import { routeCacheKey, pointAlongPath } from '@/lib/map/route-cache'
import { usePlannedRoutes, RouteViewport } from '@/lib/map/use-planned-routes'
import { useRouteSettings } from '@/lib/map/route-settings'
import { getZoomThreshold } from '@/lib/zoom-threshold'
import { MapMarker } from './map-marker'
import { routeColor } from '@/lib/map/route-presentation'
import { pickRouteDay } from '@/lib/map/route-picking'
import { layoutRoutePaths } from '@/lib/map/route-geometry'
import type { MapSearchBounds } from '@/types/map-provider'

interface AMapPoint { lng?: number; lat?: number; getLng?: () => number; getLat?: () => number }
interface AMapInstance {
    on(event: string, handler: (event: any) => void): void
    off(event: string, handler: (event: any) => void): void
    destroy(): void
    setZoomAndCenter(zoom: number, center: number[], immediately?: boolean, duration?: number): void
    setCenter(center: number[]): void
    setZoom(zoom: number): void
    lngLatToContainer(point: number[]): { getX(): number; getY(): number }
    getCenter(): AMapPoint
    getZoom(): number
    getBounds(): { getSouthWest(): AMapPoint; getNorthEast(): AMapPoint }
    add(overlays: any[]): void
    remove(overlays: any[]): void
}
interface AMapNamespace {
    Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapInstance
    Marker: new (options: Record<string, unknown>) => any
    Polyline: new (options: Record<string, unknown>) => any
    Pixel: new (x: number, y: number) => any
}
declare global { interface Window { AMap?: AMapNamespace; _AMapSecurityConfig?: { securityJsCode: string } } }

let loader: Promise<AMapNamespace> | null = null
function loadAMap(key: string, securityCode: string): Promise<AMapNamespace> {
    if (window.AMap) return Promise.resolve(window.AMap)
    if (!loader) {
        loader = new Promise<AMapNamespace>((resolve, reject) => {
            if (securityCode) window._AMapSecurityConfig = { securityJsCode: securityCode }
            const script = document.createElement('script')
            script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`
            script.async = true
            script.onload = () => window.AMap ? resolve(window.AMap) : reject(new Error('高德 JS API 未加载'))
            script.onerror = () => reject(new Error('高德 JS API 加载失败'))
            document.head.appendChild(script)
        }).catch(error => { loader = null; throw error })
    }
    return loader!
}

export interface MapCamera { longitude: number; latitude: number; zoom: number; bearing?: number; pitch?: number }
export interface MapRendererHandle {
    flyTo(options: { center: [number, number]; zoom?: number; duration?: number; offset?: [number, number] }): void
    getSearchBounds(): MapSearchBounds | undefined
}
interface Props {
    routeProvider: string
    apiKey: string
    securityCode: string
    viewState: MapCamera
    markers: Marker[]
    selectedMarkerId: string | null
    popupCoordinates: MarkerCoordinates | null
    popup: React.ReactNode
    userLocation: { lng: number; lat: number } | null
    onMove: (view: MapCamera) => void
    onLoad: () => void
    onClick: (coordinates: MarkerCoordinates, originalEvent: Event) => void
    onMarkerClick: (id: string) => void
    onError: (error: Error) => void
}
const gcj = (c: { longitude: number; latitude: number }) => {
    const p = wgs84ToGcj02(c.longitude, c.latitude)
    return [p.longitude, p.latitude]
}
const wgs = (p: AMapPoint) => gcj02ToWgs84(p.getLng?.() ?? p.lng ?? 0, p.getLat?.() ?? p.lat ?? 0)

export const AMapRenderer = React.forwardRef<MapRendererHandle, Props>(function AMapRenderer(props, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const mapRef = useRef<AMapInstance | null>(null)
    const namespaceRef = useRef<AMapNamespace | null>(null)
    const [ready, setReady] = useState(false)
    const [routeViewport, setRouteViewport] = useState<RouteViewport | null>(null)
    const [markerNodes, setMarkerNodes] = useState<HTMLElement[]>([])
    const [popupNode, setPopupNode] = useState<HTMLElement | null>(null)
    const latest = useRef(props)
    latest.current = props
    const nodesRef = useRef<HTMLElement[]>([])
    const markerOverlaysRef = useRef(new Map<string, { overlay: any; node: HTMLElement }>())
    const pickableRoutesRef = useRef<Array<{ dayId: string; path: number[][] }>>([])
    const routeOverlaysRef = useRef(new Map<string, { casing: any; line: any; hitArea: any; dot?: any; node?: HTMLElement }>())
    const popupOverlayRef = useRef<any>(null)
    const popupNodeRef = useRef<HTMLElement | null>(null)
    const locationOverlayRef = useRef<any>(null)
    const locationNodeRef = useRef<HTMLElement | null>(null)

    useImperativeHandle(ref, () => ({
        getSearchBounds() {
            const bounds = mapRef.current?.getBounds()
            if (!bounds) return
            const sw = wgs(bounds.getSouthWest()), ne = wgs(bounds.getNorthEast())
            return { west: sw.longitude, south: sw.latitude, east: ne.longitude, north: ne.latitude }
        },
        flyTo({ center, zoom, duration, offset }) {
            const map = mapRef.current
            if (!map) return
            const point = wgs84ToGcj02(center[0], center[1])
            const targetZoom = zoom ?? map.getZoom()
            const worldSize = 256 * 2 ** targetZoom
            const latitude = Math.max(-85, Math.min(85, point.latitude)) * Math.PI / 180
            const worldY = (1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2
            const centerY = worldY + (offset?.[1] ?? 0) / worldSize
            const target = [point.longitude - (offset?.[0] ?? 0) * 360 / worldSize, Math.atan(Math.sinh(Math.PI * (1 - 2 * centerY))) * 180 / Math.PI]
            const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
            map.setZoomAndCenter(targetZoom, target, reduced, reduced ? 0 : duration ?? 700)
        },
    }), [])

    useEffect(() => {
        if (!containerRef.current) return
        const key = props.apiKey
        if (!key) { props.onError(new Error('AMAP_JS_KEY 未配置')); return }
        if (!props.securityCode) { props.onError(new Error('AMAP_JS_SECURITY_CODE 未配置')); return }
        let cancelled = false
        let map: AMapInstance | null = null
        const onClick = (event: any) => {
            if (event.originEvent?.target?.closest?.('.map-marker, .map-popup, .amap-marker')) return
            latest.current.onClick(wgs(event.lnglat), event.originEvent || new Event('click'))
        }
        const onMove = () => {
            if (!map) return
            const center = wgs(map.getCenter())
            latest.current.onMove({ ...center, zoom: map.getZoom() })
            const bounds = map.getBounds()
            const sw = wgs(bounds.getSouthWest()), ne = wgs(bounds.getNorthEast())
            setRouteViewport({ west: sw.longitude, east: ne.longitude, south: sw.latitude, north: ne.latitude, centerLat: center.latitude, centerLng: center.longitude })
        }
        loadAMap(key, props.securityCode).then(AMap => {
            if (cancelled || !containerRef.current) return
            namespaceRef.current = AMap
            map = new AMap.Map(containerRef.current, {
                zoom: latest.current.viewState.zoom,
                center: gcj(latest.current.viewState),
                viewMode: '2D',
                resizeEnable: true,
            })
            mapRef.current = map
            map.on('click', onClick)
            map.on('moveend', onMove)
            map.on('zoomend', onMove)
            setReady(true)
            onMove()
            latest.current.onLoad()
        }).catch(error => { if (!cancelled) latest.current.onError(error) })
        return () => {
            cancelled = true
            if (map) {
                map.off('click', onClick)
                map.off('moveend', onMove)
                map.off('zoomend', onMove)
                map.destroy()
            }
            mapRef.current = null
            setReady(false)
        }
    }, [])

    useEffect(() => {
        const map = mapRef.current, AMap = namespaceRef.current
        if (!ready || !map || !AMap) return
        const removed: any[] = [], added: any[] = []
        const ids = new Set(props.markers.map(marker => marker.id))
        for (const [id, entry] of Array.from(markerOverlaysRef.current)) {
            if (!ids.has(id)) { removed.push(entry.overlay); entry.node.remove(); markerOverlaysRef.current.delete(id) }
        }
        for (const marker of props.markers) {
            const existing = markerOverlaysRef.current.get(marker.id)
            if (existing) {
                existing.overlay.setPosition(gcj(marker.coordinates))
                existing.overlay.setzIndex(marker.id === props.selectedMarkerId ? 120 : 100)
                continue
            }
            const node = document.createElement('div')
            node.className = 'map-marker'
            node.style.cssText = 'width:28px;height:28px;cursor:pointer'
            const overlay = new AMap.Marker({ position: gcj(marker.coordinates), content: node, offset: new AMap.Pixel(-14, -14), zIndex: marker.id === props.selectedMarkerId ? 120 : 100 })
            added.push(overlay)
            markerOverlaysRef.current.set(marker.id, { overlay, node })
        }
        if (removed.length) map.remove(removed)
        if (added.length) map.add(added)
        nodesRef.current = props.markers.map(marker => markerOverlaysRef.current.get(marker.id)!.node)
        setMarkerNodes([...nodesRef.current])
    }, [ready, props.markers, props.selectedMarkerId])

    useEffect(() => () => {
        markerOverlaysRef.current.forEach(entry => entry.node.remove())
        markerOverlaysRef.current.clear()
        routeOverlaysRef.current.clear()
    }, [])

    const { tripDays, activeView, interactionState } = useMapStore()
    const [hoveredDayId, setHoveredDayId] = useState<string | null>(null)
    const effectiveDayId = activeView.mode === 'day' ? activeView.dayId : interactionState.highlightedDayId ?? hoveredDayId
    const zoomThreshold = useSyncExternalStore(
        callback => { window.addEventListener('zoomThresholdChange', callback); return () => window.removeEventListener('zoomThresholdChange', callback) },
        getZoomThreshold, getZoomThreshold,
    )
    useEffect(() => {
        const handler = (event: Event) => setHoveredDayId((event as CustomEvent).detail.dayId)
        window.addEventListener('markerDayHover', handler)
        return () => window.removeEventListener('markerDayHover', handler)
    }, [])
    const routeProvider = props.routeProvider
    const routeSettings = useRouteSettings()
    const routeSegments = React.useMemo(() => {
        const byId = new Map(props.markers.map(marker => [marker.id, marker]))
        const relevant = tripDays.filter(day => activeView.mode === 'day' ? day.id === activeView.dayId : activeView.mode === 'trip' ? day.tripId === activeView.tripId : true)
        return relevant.flatMap(day => (day.chains || []).flatMap((chain, chainIndex) => chain.slice(0, -1).flatMap((fromId, index) => {
            const from = byId.get(fromId), to = byId.get(chain[index + 1])
            return from && to ? [{ dayId: day.id, displayKey: `${day.id}:${chainIndex}:${index}`, fromId, toId: to.id, origin: { lat: from.coordinates.latitude, lng: from.coordinates.longitude }, destination: { lat: to.coordinates.latitude, lng: to.coordinates.longitude } }] : []
        })))
    }, [props.markers, tripDays, activeView.mode, activeView.dayId, activeView.tripId])
    const planned = usePlannedRoutes(routeSegments, routeProvider, routeViewport)
    const displayPaths = React.useMemo(() => {
        const paths = layoutRoutePaths(routeSegments.map(segment => {
            const path = planned.enabled ? planned.routes[routeCacheKey(routeProvider, routeSettings.auto ? 'auto' : routeSettings.mode, segment)] ?? null : null
            return { dayId: segment.dayId, path: isRangeFallback(path) ? null : path }
        }))
        return new Map(routeSegments.map((segment, index) => [segment.displayKey, paths[index]]))
    }, [routeSegments, planned.enabled, planned.routes, routeProvider, routeSettings.mode, routeSettings.auto])
    useEffect(() => {
        const map = mapRef.current, AMap = namespaceRef.current
        if (!ready || !map || !AMap) return
        if (props.viewState.zoom < zoomThreshold) {
            map.remove(Array.from(routeOverlaysRef.current.values()).flatMap(entry => [entry.casing, entry.line, entry.hitArea, ...(entry.dot ? [entry.dot] : [])]))
            routeOverlaysRef.current.clear()
            pickableRoutesRef.current = []
            return
        }
        const byId = new Map(props.markers.map(marker => [marker.id, marker]))
        const relevant = tripDays.filter(day => activeView.mode === 'day' ? day.id === activeView.dayId : activeView.mode === 'trip' ? day.tripId === activeView.tripId : true)
        pickableRoutesRef.current = []
        const overlays: any[] = []
        const liveKeys = new Set<string>()
        const animated: Array<{ dot: any; from: { lat: number; lng: number }; to: { lat: number; lng: number }; path: Array<{ lat: number; lng: number }> | null }> = []
        for (const day of relevant) for (const [chainIndex, chain] of Array.from((day.chains || []).entries())) {
            for (let index = 0; index < chain.length - 1; index++) {
                const fromMarker = byId.get(chain[index]), toMarker = byId.get(chain[index + 1])
                if (!fromMarker || !toMarker) continue
                const [fromLng, fromLat] = gcj(fromMarker.coordinates), [toLng, toLat] = gcj(toMarker.coordinates)
                const from = { lng: fromLng, lat: fromLat }, to = { lng: toLng, lat: toLat }
                const highlighted = day.id === effectiveDayId
                const segment = { fromId: fromMarker.id, toId: toMarker.id, origin: { lat: fromMarker.coordinates.latitude, lng: fromMarker.coordinates.longitude }, destination: { lat: toMarker.coordinates.latitude, lng: toMarker.coordinates.longitude } }
                const cachedPath = planned.enabled ? planned.routes[routeCacheKey(routeProvider, routeSettings.auto ? 'auto' : routeSettings.mode, segment)] : null
                const path = cachedPath && !isRangeFallback(cachedPath) ? displayPaths.get(`${day.id}:${chainIndex}:${index}`)!.map(point => gcj({ longitude: point.lng, latitude: point.lat })) : getBezierPath(from, to)
                pickableRoutesRef.current.push({ dayId: day.id, path })
                const width = Math.max(3, 3 + (props.viewState.zoom - 10) * 0.2) + (highlighted ? 2 : 0)
                const color = routeColor(chainIndex, day.id, day.colorIndex)
                const key = `${day.id}:${chainIndex}:${index}`
                liveKeys.add(key)
                let entry = routeOverlaysRef.current.get(key)
                const casingOptions = { path, lineJoin: 'round', lineCap: 'round', strokeColor: '#ffffff', strokeWeight: width + 2, strokeOpacity: highlighted ? 1 : effectiveDayId ? 0.4 : 0.8, zIndex: highlighted ? 52 : 48 }
                const lineOptions = { path, lineJoin: 'round', lineCap: 'round', strokeColor: color, strokeStyle: planned.enabled && (!cachedPath || isRangeFallback(cachedPath)) ? 'dashed' : 'solid', strokeDasharray: [8, 6], strokeWeight: width, strokeOpacity: highlighted ? 1 : effectiveDayId ? 0.25 : 0.8, zIndex: highlighted ? 53 : 49 }
                const hitOptions = { path, strokeColor: color, strokeWeight: 28, strokeOpacity: 0, zIndex: highlighted ? 56 : 55, bubble: false }
                if (!entry) {
                    entry = { casing: new AMap.Polyline(casingOptions), line: new AMap.Polyline(lineOptions), hitArea: new AMap.Polyline(hitOptions) }
                    entry.hitArea.on('mouseover', () => setHoveredDayId(day.id))
                    entry.hitArea.on('mouseout', () => setHoveredDayId(null))
                    entry.hitArea.on('click', (event: any) => {
                        const state = useMapStore.getState()
                        if (state.activeView.mode === 'day' || !event.lnglat) return
                        const pixel = map.lngLatToContainer([event.lnglat.getLng(), event.lnglat.getLat()])
                        const candidates = pickableRoutesRef.current.map(route => ({ dayId: route.dayId, path: route.path.map(position => {
                            const projected = map.lngLatToContainer(position)
                            return { x: projected.getX(), y: projected.getY() }
                        }) }))
                        const picked = pickRouteDay({ x: pixel.getX(), y: pixel.getY() }, candidates, state.interactionState.highlightedDayId)
                        const day = state.tripDays.find(item => item.id === picked)
                        if (day) { setHoveredDayId(null); state.setActiveView('day', day.tripId, day.id, { focusFirstMarker: false }) }
                    })
                    routeOverlaysRef.current.set(key, entry)
                    overlays.push(entry.casing, entry.line, entry.hitArea)
                } else {
                    // AMap geometry updates use setPath; setOptions only updates style.
                    entry.casing.setPath(path)
                    entry.line.setPath(path)
                    entry.hitArea.setPath(path)
                    entry.casing.setOptions(casingOptions)
                    entry.line.setOptions(lineOptions)
                    entry.hitArea.setOptions(hitOptions)
                }
                if (highlighted) {
                    if (!entry.dot) {
                        entry.node = document.createElement('div')
                        entry.dot = new AMap.Marker({ position: [from.lng, from.lat], content: entry.node, offset: new AMap.Pixel(-5, -5), zIndex: 54, clickable: false })
                        overlays.push(entry.dot)
                    }
                    entry.node!.style.cssText = `width:10px;height:10px;border:2px solid white;border-radius:50%;background:${color};box-sizing:border-box;pointer-events:none`
                    animated.push({ dot: entry.dot, from, to, path: cachedPath && !isRangeFallback(cachedPath) ? path.map(([lng, lat]) => ({ lng, lat })) : null })
                } else if (entry.dot) {
                    map.remove([entry.dot]); entry.node?.remove(); entry.dot = undefined; entry.node = undefined
                }
            }
        }
        for (const [key, entry] of Array.from(routeOverlaysRef.current)) {
            if (!liveKeys.has(key)) {
                map.remove([entry.casing, entry.line, entry.hitArea, ...(entry.dot ? [entry.dot] : [])])
                entry.node?.remove()
                routeOverlaysRef.current.delete(key)
            }
        }
        if (overlays.length) map.add(overlays)
        const animate = (now: number) => {
            const progress = (now / 2100) % 1
            for (const { dot, from, to, path } of animated) {
                const position = path ? pointAlongPath(path, progress) : bezierPoint(from, getControlPoint(from, to), to, progress)
                dot.setPosition(Array.isArray(position) ? position : [position.lng, position.lat])
                dot.getContent().style.opacity = String(Math.min(1, progress * 10, (1 - progress) * 10))
            }
        }
        if (!animated.length) return
        return startAnimationLoop(animate, () => {
            for (const { dot } of animated) dot.getContent().style.opacity = '0'
        })
    }, [ready, props.markers, tripDays, activeView.mode, activeView.dayId, activeView.tripId, effectiveDayId, props.viewState.zoom, zoomThreshold, planned.enabled, planned.routes, displayPaths, routeProvider, routeSettings.mode, routeSettings.auto])

    useEffect(() => {
        const map = mapRef.current, AMap = namespaceRef.current
        if (!ready || !map || !AMap) return
        if (popupOverlayRef.current) map.remove([popupOverlayRef.current])
        popupNodeRef.current?.remove()
        popupOverlayRef.current = null
        popupNodeRef.current = null
        setPopupNode(null)
        if (!props.popupCoordinates) return
        const node = document.createElement('div')
        node.className = 'map-popup'
        const overlay = new AMap.Marker({ position: gcj(props.popupCoordinates), content: node, offset: new AMap.Pixel(-120, props.selectedMarkerId ? 36 : 20), zIndex: 130 })
        map.add([overlay])
        popupOverlayRef.current = overlay
        popupNodeRef.current = node
        setPopupNode(node)
        return () => { map.remove([overlay]); node.remove(); popupOverlayRef.current = null; popupNodeRef.current = null }
    }, [ready, props.popupCoordinates, props.selectedMarkerId])

    useEffect(() => {
        const map = mapRef.current, AMap = namespaceRef.current
        if (!ready || !map || !AMap) return
        if (locationOverlayRef.current) map.remove([locationOverlayRef.current])
        locationNodeRef.current?.remove()
        if (!props.userLocation) return
        const node = document.createElement('div')
        node.innerHTML = '<div style="width:16px;height:16px;border:2px solid white;border-radius:50%;background:#3b82f6;box-shadow:0 1px 6px #555"></div>'
        const overlay = new AMap.Marker({ position: gcj({ longitude: props.userLocation.lng, latitude: props.userLocation.lat }), content: node, offset: new AMap.Pixel(-8, -8), zIndex: 140 })
        map.add([overlay])
        locationOverlayRef.current = overlay
        locationNodeRef.current = node
        return () => { map.remove([overlay]); node.remove(); locationOverlayRef.current = null; locationNodeRef.current = null }
    }, [ready, props.userLocation])

    return <>
        <div ref={containerRef} className="absolute inset-0 isolate z-0" />
        {ready && markerNodes.map((node, index) => props.markers[index] && createPortal(
            <MapMarker marker={props.markers[index]} isSelected={props.markers[index].id === props.selectedMarkerId} onClick={() => props.onMarkerClick(props.markers[index].id)} zoom={props.viewState.zoom} />,
            node, props.markers[index].id,
        ))}
        {ready && popupNode && createPortal(props.popup, popupNode)}
    </>
})
