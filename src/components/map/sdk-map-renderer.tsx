'use client'

import { loadGoogleMap } from '@/lib/map/google-map-sdk'
import { toMapCoordinates, fromMapCoordinates } from '@/lib/map/basemap'

import { routeTransportMode } from '@/lib/map/route-mode'

import { isRangeFallback } from '@/lib/map/route-cache'

import { startAnimationLoop } from '@/lib/ui/animation-loop'

import React, { useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useMapStore } from '@/store/map-store'
import type { Marker } from '@/types/marker'
import type { MarkerCoordinates } from '@/types/marker'
import { getControlPoint, bezierPoint, getBezierPath, pathMidpointHeading } from '@/lib/map/connection-geometry'
import { routeCacheKey, pointAlongPath } from '@/lib/map/route-cache'
import { usePlannedRoutes, RouteViewport } from '@/lib/map/use-planned-routes'
import { getZoomThreshold } from '@/lib/zoom-threshold'
import { MapMarker } from './map-marker'
import { routeColor, routeLineStyle, planeIconSvg } from '@/lib/map/route-presentation'
import { separateOverlappingPaths } from '@/lib/map/route-separation'
import { pickRouteDay } from '@/lib/map/route-picking'
import { layoutRoutePaths } from '@/lib/map/route-geometry'
import { SearchResultMarker, searchResultKey } from './search-result-marker'
import type { SearchResult } from '@/lib/api/search-service'
import type { MapSearchBounds } from '@/types/map-provider'

export interface SDKPoint { lng?: number; lat?: number; getLng?: () => number; getLat?: () => number }
export interface SDKMapInstance {
    on(event: string, handler: (event: any) => void): void
    off(event: string, handler: (event: any) => void): void
    destroy(): void
    setZoomAndCenter(zoom: number, center: number[], immediately?: boolean, duration?: number): void
    setCenter(center: number[]): void
    setZoom(zoom: number): void
    lngLatToContainer(point: number[]): { getX(): number; getY(): number }
    getCenter(): SDKPoint
    getZoom(): number
    getBounds(): { getSouthWest(): SDKPoint; getNorthEast(): SDKPoint }
    add(overlays: any[]): void
    remove(overlays: any[]): void
}
export interface SDKMapNamespace {
    Map: new (container: HTMLElement, options: Record<string, unknown>) => SDKMapInstance
    Marker: new (options: Record<string, unknown>) => any
    Polyline: new (options: Record<string, unknown>) => any
    Pixel: new (x: number, y: number) => any
}
declare global { interface Window { AMap?: SDKMapNamespace; _AMapSecurityConfig?: { securityJsCode: string } } }

let loader: Promise<SDKMapNamespace> | null = null
function loadAMap(key: string, securityCode: string): Promise<SDKMapNamespace> {
    if (window.AMap) return Promise.resolve(window.AMap)
    if (!loader) {
        loader = new Promise<SDKMapNamespace>((resolve, reject) => {
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
/** Zero-size native overlay at a coordinate; content positioned inside moves with the map like a marker. */
export interface MapAnchor { node: HTMLElement; dispose(): void }
export interface MapRendererHandle {
    createAnchor(coordinates: MarkerCoordinates, zIndex?: number): MapAnchor | undefined
    routeMidpoints(): Map<string, MarkerCoordinates>
    flyTo(options: { center: [number, number]; zoom?: number; duration?: number; offset?: [number, number] }): void
    project(coordinates: MarkerCoordinates): { x: number; y: number } | undefined
    routeScreenPaths(): Array<Array<{ x: number; y: number }>>
    subscribeCamera(handler: () => void, moving: () => void): () => void
    getSearchBounds(): MapSearchBounds | undefined
}
interface Props {
    renderer: 'amap' | 'google'
    routeProvider: string
    apiKey: string
    securityCode: string
    viewState: MapCamera
    markers: Marker[]
    searchResults: SearchResult[]
    selectedSearchKey: string | null
    onSearchResultClick: (result: SearchResult) => void
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
export const SDKMapRenderer = React.forwardRef<MapRendererHandle, Props>(function SDKMapRenderer(props, ref) {
    const toDisplayPoint = (c: { longitude: number; latitude: number }) => {
        const p = toMapCoordinates(c, props.renderer)
        return [p.longitude, p.latitude]
    }
    const fromDisplayPoint = (p: SDKPoint) => fromMapCoordinates({ longitude: p.getLng?.() ?? p.lng ?? 0, latitude: p.getLat?.() ?? p.lat ?? 0 }, props.renderer)
    const containerRef = useRef<HTMLDivElement>(null)
    const mapRef = useRef<SDKMapInstance | null>(null)
    const namespaceRef = useRef<SDKMapNamespace | null>(null)
    const [ready, setReady] = useState(false)
    const [routeViewport, setRouteViewport] = useState<RouteViewport | null>(null)
    const [markerNodes, setMarkerNodes] = useState<HTMLElement[]>([])
    const [searchNodes, setSearchNodes] = useState<Array<{ key: string; node: HTMLElement }>>([])
    const searchOverlaysRef = useRef(new Map<string, { overlay: any; node: HTMLElement }>())
    const [popupNode, setPopupNode] = useState<HTMLElement | null>(null)
    const latest = useRef(props)
    latest.current = props
    const nodesRef = useRef<HTMLElement[]>([])
    const markerOverlaysRef = useRef(new Map<string, { overlay: any; node: HTMLElement }>())
    const pickableRoutesRef = useRef<Array<{ dayId: string; path: number[][] }>>([])
    const routeOverlaysRef = useRef(new Map<string, { casing: any; line: any; hitArea: any; dot?: any; node?: HTMLElement; plane?: any; planeNode?: HTMLElement }>())
    const routeMidpointsRef = useRef(new Map<string, MarkerCoordinates>())
    const separationRef = useRef<{ signature: string; paths: Map<string, number[][]> } | null>(null)
    const popupOverlayRef = useRef<any>(null)
    const popupNodeRef = useRef<HTMLElement | null>(null)
    const locationOverlayRef = useRef<any>(null)
    const locationNodeRef = useRef<HTMLElement | null>(null)

    useImperativeHandle(ref, () => ({
        createAnchor(coordinates, zIndex = 125) {
            const map = mapRef.current, SDK = namespaceRef.current
            if (!map || !SDK) return
            const node = document.createElement('div')
            node.style.cssText = 'position:relative;width:0;height:0;overflow:visible'
            const overlay = new SDK.Marker({ position: toDisplayPoint(coordinates), content: node, offset: new SDK.Pixel(0, 0), zIndex, bubble: true })
            map.add([overlay])
            return { node, dispose: () => { map.remove([overlay]); node.remove() } }
        },
        routeMidpoints() { return routeMidpointsRef.current },
        project(coordinates) {
            const display = toMapCoordinates(coordinates, latest.current.renderer)
            const point = mapRef.current?.lngLatToContainer([display.longitude, display.latitude])
            return point && { x: point.getX(), y: point.getY() }
        },
        routeScreenPaths() {
            const map = mapRef.current
            if (!map) return []
            return pickableRoutesRef.current.map(route => route.path.map(point => {
                const pixel = map.lngLatToContainer(point)
                return { x: pixel.getX(), y: pixel.getY() }
            }))
        },
        subscribeCamera(handler, moving) {
            const map = mapRef.current
            const events = latest.current.renderer === 'google' ? ['idle'] : ['moveend', 'zoomend']
            const starts = latest.current.renderer === 'google' ? ['bounds_changed'] : ['movestart', 'zoomstart']
            events.forEach(event => map?.on(event, handler))
            starts.forEach(event => map?.on(event, moving))
            return () => { events.forEach(event => map?.off(event, handler)); starts.forEach(event => map?.off(event, moving)) }
        },
        getSearchBounds() {
            const bounds = mapRef.current?.getBounds()
            if (!bounds) return
            const sw = fromDisplayPoint(bounds.getSouthWest()), ne = fromDisplayPoint(bounds.getNorthEast())
            return { west: sw.longitude, south: sw.latitude, east: ne.longitude, north: ne.latitude }
        },
        flyTo({ center, zoom, duration, offset }) {
            const map = mapRef.current
            if (!map) return
            const point = toMapCoordinates({ longitude: center[0], latitude: center[1] }, latest.current.renderer)
            const targetZoom = zoom ?? map.getZoom()
            const worldSize = 256 * 2 ** targetZoom
            const latitude = Math.max(-85, Math.min(85, point.latitude)) * Math.PI / 180
            const worldY = (1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2
            const centerY = worldY - (offset?.[1] ?? 0) / worldSize
            const target = [point.longitude - (offset?.[0] ?? 0) * 360 / worldSize, Math.atan(Math.sinh(Math.PI * (1 - 2 * centerY))) * 180 / Math.PI]
            const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
            map.setZoomAndCenter(targetZoom, target, reduced, reduced ? 0 : duration ?? 700)
        },
    }), [])

    useEffect(() => {
        if (!containerRef.current) return
        const key = props.apiKey
        if (!key) { props.onError(new Error(props.renderer === 'google' ? 'Google 地图 Key 未配置' : 'AMAP_JS_KEY 未配置')); return }
        if (props.renderer === 'amap' && !props.securityCode) { props.onError(new Error('AMAP_JS_SECURITY_CODE 未配置')); return }
        const onAuthError = () => latest.current.onError(new Error('Google 地图认证失败，请检查地图 Key 配置'))
        if (props.renderer === 'google') window.addEventListener('googleMapAuthError', onAuthError)
        let cancelled = false
        let map: SDKMapInstance | null = null
        const onClick = (event: any) => {
            if (event.originEvent?.target?.closest?.('.map-marker, .map-search-marker, .map-popup, .amap-marker')) return
            latest.current.onClick(fromDisplayPoint(event.lnglat), event.originEvent || new Event('click'))
        }
        let panning = false
        const onPanStart = () => { panning = true }
        const onMove = () => {
            if (!map) return
            const center = fromDisplayPoint(map.getCenter())
            latest.current.onMove({ ...center, zoom: map.getZoom() })
            const bounds = map.getBounds()
            const sw = fromDisplayPoint(bounds.getSouthWest()), ne = fromDisplayPoint(bounds.getNorthEast())
            setRouteViewport({ west: sw.longitude, east: ne.longitude, south: sw.latitude, north: ne.latitude, centerLat: center.latitude, centerLng: center.longitude })
        }
        const onPanEnd = () => { panning = false; onMove() }
        const onZoomEnd = () => { if (!panning) onMove() }
        (props.renderer === 'google' ? loadGoogleMap(key) : loadAMap(key, props.securityCode)).then(SDK => {
            if (cancelled || !containerRef.current) return
            namespaceRef.current = SDK
            map = new SDK.Map(containerRef.current, {
                zoom: latest.current.viewState.zoom,
                center: toDisplayPoint(latest.current.viewState),
                viewMode: '2D',
                resizeEnable: true,
            })
            mapRef.current = map
            map.on('click', onClick)
            map.on('movestart', onPanStart)
            map.on('moveend', onPanEnd)
            map.on('zoomend', onZoomEnd)
            setReady(true)
            onMove()
            latest.current.onLoad()
        }).catch(error => { if (!cancelled) latest.current.onError(error) })
        return () => {
            cancelled = true
            window.removeEventListener('googleMapAuthError', onAuthError)
            if (map) {
                map.off('click', onClick)
                map.off('movestart', onPanStart)
                map.off('moveend', onPanEnd)
                map.off('zoomend', onZoomEnd)
                map.destroy()
            }
            mapRef.current = null
            setReady(false)
        }
    }, [])

    useEffect(() => {
        const map = mapRef.current, SDK = namespaceRef.current
        if (!ready || !map || !SDK) return
        const removed: any[] = [], added: any[] = []
        const ids = new Set(props.markers.map(marker => marker.id))
        for (const [id, entry] of Array.from(markerOverlaysRef.current)) {
            if (!ids.has(id)) { removed.push(entry.overlay); entry.node.remove(); markerOverlaysRef.current.delete(id) }
        }
        for (const marker of props.markers) {
            const existing = markerOverlaysRef.current.get(marker.id)
            if (existing) {
                existing.overlay.setPosition(toDisplayPoint(marker.coordinates))
                existing.overlay.setzIndex(marker.id === props.selectedMarkerId ? 120 : 100)
                continue
            }
            const node = document.createElement('div')
            node.className = 'map-marker'
            node.style.cssText = 'width:28px;height:28px;cursor:pointer'
            const overlay = new SDK.Marker({ position: toDisplayPoint(marker.coordinates), content: node, offset: new SDK.Pixel(-14, -14), zIndex: marker.id === props.selectedMarkerId ? 120 : 100 })
            added.push(overlay)
            markerOverlaysRef.current.set(marker.id, { overlay, node })
        }
        if (removed.length) map.remove(removed)
        if (added.length) map.add(added)
        nodesRef.current = props.markers.map(marker => markerOverlaysRef.current.get(marker.id)!.node)
        setMarkerNodes([...nodesRef.current])
    }, [ready, props.markers, props.selectedMarkerId])

    useEffect(() => {
        const map = mapRef.current, SDK = namespaceRef.current
        if (!ready || !map || !SDK) return
        const live = new Set(props.searchResults.map(searchResultKey))
        for (const [key, entry] of Array.from(searchOverlaysRef.current)) {
            if (!live.has(key)) {
                map.remove([entry.overlay]); entry.node.remove(); searchOverlaysRef.current.delete(key)
            }
        }
        for (const result of props.searchResults) {
            const key = searchResultKey(result)
            const zIndex = props.selectedSearchKey === key ? 125 : 105
            const existing = searchOverlaysRef.current.get(key)
            if (existing) { existing.overlay.setPosition(toDisplayPoint(result.coordinates)); existing.overlay.setzIndex(zIndex); continue }
            const node = document.createElement('div')
            node.className = 'map-search-marker'
            const overlay = new SDK.Marker({ position: toDisplayPoint(result.coordinates), content: node,
                offset: new SDK.Pixel(-22, -22), zIndex })
            map.add([overlay]); searchOverlaysRef.current.set(key, { overlay, node })
        }
        setSearchNodes(props.searchResults.map(result => ({ key: searchResultKey(result), node: searchOverlaysRef.current.get(searchResultKey(result))!.node })))
    }, [ready, props.searchResults, props.selectedSearchKey])

    useEffect(() => () => {
        markerOverlaysRef.current.forEach(entry => entry.node.remove())
        markerOverlaysRef.current.clear()
        searchOverlaysRef.current.forEach(entry => entry.node.remove())
        searchOverlaysRef.current.clear()
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
    const routeSegments = React.useMemo(() => {
        const byId = new Map(props.markers.map(marker => [marker.id, marker]))
        const relevant = tripDays.filter(day => activeView.mode === 'day' ? day.id === activeView.dayId : activeView.mode === 'trip' ? day.tripId === activeView.tripId : true)
        return relevant.flatMap(day => (day.chains || []).flatMap((chain, chainIndex) => chain.slice(0, -1).flatMap((fromId, index) => {
            const from = byId.get(fromId), to = byId.get(chain[index + 1])
            return from && to ? [{ dayId: day.id, displayKey: `${day.id}:${chainIndex}:${index}`, transportMode: routeTransportMode(day.routeChains?.[chainIndex], fromId, to.id, index), fromId, toId: to.id, origin: { lat: from.coordinates.latitude, lng: from.coordinates.longitude }, destination: { lat: to.coordinates.latitude, lng: to.coordinates.longitude } }] : []
        })))
    }, [props.markers, tripDays, activeView.mode, activeView.dayId, activeView.tripId])
    const planned = usePlannedRoutes(routeSegments, routeProvider, routeViewport)
    const displayPaths = React.useMemo(() => {
        const paths = layoutRoutePaths(routeSegments.map(segment => {
            const path = planned.enabled ? planned.routes[routeCacheKey(routeProvider, segment)] ?? null : null
            return { dayId: segment.dayId, path: isRangeFallback(path) ? null : path }
        }))
        return new Map(routeSegments.map((segment, index) => [segment.displayKey, paths[index]]))
    }, [routeSegments, planned.enabled, planned.routes, routeProvider])
    useEffect(() => {
        const map = mapRef.current, SDK = namespaceRef.current
        if (!ready || !map || !SDK) return
        if (props.viewState.zoom < zoomThreshold && activeView.mode === 'overview') {
            map.remove(Array.from(routeOverlaysRef.current.values()).flatMap(entry => [entry.casing, entry.line, entry.hitArea, ...(entry.dot ? [entry.dot] : []), ...(entry.plane ? [entry.plane] : [])]))
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
        // Display paths for every link first, so overlapping corridors can be split into lanes together.
        const rawPaths = new Map<string, number[][]>()
        for (const day of relevant) for (const [chainIndex, chain] of Array.from((day.chains || []).entries())) {
            for (let index = 0; index < chain.length - 1; index++) {
                const fromMarker = byId.get(chain[index]), toMarker = byId.get(chain[index + 1])
                if (!fromMarker || !toMarker) continue
                const [fromLng, fromLat] = toDisplayPoint(fromMarker.coordinates), [toLng, toLat] = toDisplayPoint(toMarker.coordinates)
                const segment = { transportMode: routeTransportMode(day.routeChains?.[chainIndex], fromMarker.id, toMarker.id, index), fromId: fromMarker.id, toId: toMarker.id, origin: { lat: fromMarker.coordinates.latitude, lng: fromMarker.coordinates.longitude }, destination: { lat: toMarker.coordinates.latitude, lng: toMarker.coordinates.longitude } }
                const cachedPath = planned.enabled ? planned.routes[routeCacheKey(routeProvider, segment)] : null
                rawPaths.set(`${day.id}:${chainIndex}:${index}`, cachedPath && !isRangeFallback(cachedPath) ? displayPaths.get(`${day.id}:${chainIndex}:${index}`)!.map(point => toDisplayPoint({ longitude: point.lng, latitude: point.lat })) : getBezierPath({ lng: fromLng, lat: fromLat }, { lng: toLng, lat: toLat }))
            }
        }
        const zoomBucket = Math.round(props.viewState.zoom * 2) / 2
        const signature = `${zoomBucket}|${Array.from(rawPaths, ([key, path]) => `${key}:${path.length}:${path[0]}:${path[path.length - 1]}:${path[path.length >> 1]}`).join('|')}`
        if (separationRef.current?.signature !== signature) {
            const keys = Array.from(rawPaths.keys())
            const separated = separateOverlappingPaths(keys.map(key => rawPaths.get(key)!), zoomBucket, 256, { spacing: 5.5 })
            separationRef.current = { signature, paths: new Map(keys.map((key, i) => [key, separated[i]])) }
        }
        const lanePaths = separationRef.current.paths
        routeMidpointsRef.current = new Map(Array.from(lanePaths, ([key, path]) => {
            const mid = pathMidpointHeading(path)
            return [key, mid ? fromMapCoordinates({ longitude: mid.position[0], latitude: mid.position[1] }, props.renderer) : null] as const
        }).filter((entry): entry is [string, MarkerCoordinates] => !!entry[1]))
        window.dispatchEvent(new Event('itineraryRoutesChanged'))
        for (const day of relevant) for (const [chainIndex, chain] of Array.from((day.chains || []).entries())) {
            for (let index = 0; index < chain.length - 1; index++) {
                const fromMarker = byId.get(chain[index]), toMarker = byId.get(chain[index + 1])
                if (!fromMarker || !toMarker) continue
                const [fromLng, fromLat] = toDisplayPoint(fromMarker.coordinates), [toLng, toLat] = toDisplayPoint(toMarker.coordinates)
                const from = { lng: fromLng, lat: fromLat }, to = { lng: toLng, lat: toLat }
                const highlighted = day.id === effectiveDayId
                const segment = { transportMode: routeTransportMode(day.routeChains?.[chainIndex], fromMarker.id, toMarker.id, index), fromId: fromMarker.id, toId: toMarker.id, origin: { lat: fromMarker.coordinates.latitude, lng: fromMarker.coordinates.longitude }, destination: { lat: toMarker.coordinates.latitude, lng: toMarker.coordinates.longitude } }
                const cachedPath = planned.enabled ? planned.routes[routeCacheKey(routeProvider, segment)] : null
                const path = lanePaths.get(`${day.id}:${chainIndex}:${index}`)!
                pickableRoutesRef.current.push({ dayId: day.id, path })
                const style = routeLineStyle(segment.transportMode)
                const width = Math.min(4, Math.max(1.5, 2.2 + (props.viewState.zoom - 10) * 0.15 + style.widthOffset * 0.6)) + (highlighted ? 1 : 0)
                const color = routeColor(chainIndex, day.id, day.colorIndex)
                const key = `${day.id}:${chainIndex}:${index}`
                liveKeys.add(key)
                let entry = routeOverlaysRef.current.get(key)
                const casingOptions = { path, lineJoin: 'round', lineCap: 'round', strokeColor: '#ffffff', strokeWeight: width + 1.5, strokeOpacity: highlighted ? 1 : effectiveDayId && activeView.mode === 'overview' ? 0.4 : 0.95, zIndex: highlighted ? 52 : 48 }
                const lineOptions = { path, lineJoin: 'round', lineCap: 'round', strokeColor: color, strokeStyle: (style.dashed ?? (planned.enabled && (!cachedPath || isRangeFallback(cachedPath)))) ? 'dashed' : 'solid', strokeDasharray: [8, 6], strokeWeight: width, strokeOpacity: highlighted ? 1 : effectiveDayId && activeView.mode === 'overview' ? 0.25 : 0.9, zIndex: highlighted ? 53 : 49 }
                const hitOptions = { path, strokeColor: color, strokeWeight: 28, strokeOpacity: 0, zIndex: highlighted ? 56 : 55, bubble: false }
                if (!entry) {
                    entry = { casing: new SDK.Polyline(casingOptions), line: new SDK.Polyline(lineOptions), hitArea: new SDK.Polyline(hitOptions) }
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
                    // Keep geometry shared by the visible line, casing and click target.
                    entry.casing.setPath(path)
                    entry.line.setPath(path)
                    entry.hitArea.setPath(path)
                    entry.casing.setOptions(casingOptions)
                    entry.line.setOptions(lineOptions)
                    entry.hitArea.setOptions(hitOptions)
                }
                const heading = style.plane ? pathMidpointHeading(path) : null
                if (heading) {
                    const lineOpacity = String(lineOptions.strokeOpacity)
                    if (!entry.plane) {
                        entry.planeNode = document.createElement('div')
                        entry.plane = new SDK.Marker({ position: heading.position, content: entry.planeNode, offset: new SDK.Pixel(-10, -10), zIndex: highlighted ? 54 : 50, clickable: false })
                        overlays.push(entry.plane)
                    } else {
                        entry.plane.setPosition(heading.position)
                    }
                    entry.planeNode!.style.cssText = `width:20px;height:20px;pointer-events:none;transform:rotate(${heading.heading}deg);opacity:${lineOpacity}`
                    entry.planeNode!.innerHTML = planeIconSvg(color)
                } else if (entry.plane) {
                    map.remove([entry.plane]); entry.planeNode?.remove(); entry.plane = undefined; entry.planeNode = undefined
                }
                if (highlighted && props.viewState.zoom >= zoomThreshold) {
                    if (!entry.dot) {
                        entry.node = document.createElement('div')
                        entry.dot = new SDK.Marker({ position: [from.lng, from.lat], content: entry.node, offset: new SDK.Pixel(-5, -5), zIndex: 54, clickable: false })
                        overlays.push(entry.dot)
                    }
                    entry.node!.style.cssText = `width:10px;height:10px;border:2px solid white;border-radius:50%;background:${color};box-sizing:border-box;pointer-events:none`
                    animated.push({ dot: entry.dot, from, to, path: path.map(([lng, lat]) => ({ lng, lat })) })
                } else if (entry.dot) {
                    map.remove([entry.dot]); entry.node?.remove(); entry.dot = undefined; entry.node = undefined
                }
            }
        }
        for (const [key, entry] of Array.from(routeOverlaysRef.current)) {
            if (!liveKeys.has(key)) {
                map.remove([entry.casing, entry.line, entry.hitArea, ...(entry.dot ? [entry.dot] : []), ...(entry.plane ? [entry.plane] : [])])
                entry.node?.remove(); entry.planeNode?.remove()
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
    }, [ready, props.markers, tripDays, activeView.mode, activeView.dayId, activeView.tripId, effectiveDayId, props.viewState.zoom, zoomThreshold, planned.enabled, planned.routes, displayPaths, routeProvider])

    useEffect(() => {
        const map = mapRef.current, SDK = namespaceRef.current
        if (!ready || !map || !SDK) return
        if (popupOverlayRef.current) map.remove([popupOverlayRef.current])
        popupNodeRef.current?.remove()
        popupOverlayRef.current = null
        popupNodeRef.current = null
        setPopupNode(null)
        if (!props.popupCoordinates) return
        const node = document.createElement('div')
        node.className = 'map-popup'
        node.style.width = 'max-content'
        node.style.transform = 'translateX(-50%)'
        const overlay = new SDK.Marker({ position: toDisplayPoint(props.popupCoordinates), content: node, offset: new SDK.Pixel(0, props.selectedMarkerId ? 36 : 20), zIndex: 130 })
        map.add([overlay])
        popupOverlayRef.current = overlay
        popupNodeRef.current = node
        setPopupNode(node)
        return () => { map.remove([overlay]); node.remove(); popupOverlayRef.current = null; popupNodeRef.current = null }
    }, [ready, props.popupCoordinates, props.selectedMarkerId])

    useEffect(() => {
        const map = mapRef.current, SDK = namespaceRef.current
        if (!ready || !map || !SDK) return
        if (locationOverlayRef.current) map.remove([locationOverlayRef.current])
        locationNodeRef.current?.remove()
        if (!props.userLocation) return
        const node = document.createElement('div')
        node.innerHTML = '<div style="width:16px;height:16px;border:2px solid white;border-radius:50%;background:#3b82f6;box-shadow:0 1px 6px #555"></div>'
        const overlay = new SDK.Marker({ position: toDisplayPoint({ longitude: props.userLocation.lng, latitude: props.userLocation.lat }), content: node, offset: new SDK.Pixel(-8, -8), zIndex: 140 })
        map.add([overlay])
        locationOverlayRef.current = overlay
        locationNodeRef.current = node
        return () => { map.remove([overlay]); node.remove(); locationOverlayRef.current = null; locationNodeRef.current = null }
    }, [ready, props.userLocation])

    return <>
        <div ref={containerRef} className={`absolute inset-0 isolate z-0 ${props.renderer === 'google' ? 'google-map-container' : ''}`} data-map-renderer={props.renderer} />
        {ready && markerNodes.map((node, index) => props.markers[index] && createPortal(
            <MapMarker marker={props.markers[index]} isSelected={props.markers[index].id === props.selectedMarkerId} onClick={() => props.onMarkerClick(props.markers[index].id)} zoom={props.viewState.zoom} />,
            node, props.markers[index].id,
        ))}
        {ready && searchNodes.map(({ key, node }) => {
            const result = props.searchResults.find(item => searchResultKey(item) === key)
            return result && createPortal(<SearchResultMarker result={result} selected={props.selectedSearchKey === key} onClick={() => props.onSearchResultClick(result)} />, node, `search:${key}`)
        })}
        {ready && popupNode && createPortal(props.popup, popupNode)}
    </>
})
