'use client'

import { isRangeFallback } from '@/lib/map/route-cache'

import { startAnimationLoop } from '@/lib/ui/animation-loop'

import { useMemo, useEffect, useState, useSyncExternalStore } from 'react'
import { Source, Layer, useMap } from 'react-map-gl/maplibre'
import type { GeoJSONSource } from 'maplibre-gl'
import { toMapCoordinates } from '@/lib/map/basemap'
import type { BasemapProviderType } from '@/types/map-provider'
import { Marker } from '@/types/marker'
import { useMapStore } from '@/store/map-store'
import { getControlPoint, bezierPoint, getBezierPath } from '@/lib/map/connection-geometry'
import { routeCacheKey, pointAlongPath, RouteSegment } from '@/lib/map/route-cache'
import { usePlannedRoutes, RouteViewport } from '@/lib/map/use-planned-routes'
import { useRouteSettings } from '@/lib/map/route-settings'
import { getZoomThreshold } from '@/lib/zoom-threshold'
import { routeColor } from '@/lib/map/route-presentation'
import { pickRouteDay } from '@/lib/map/route-picking'
import { layoutRoutePaths } from '@/lib/map/route-geometry'

const emptyFeatureCollection: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: []
}

interface ConnectionLinesProps {
    routeProvider: string
    basemap?: BasemapProviderType
    markers?: Marker[]
    zoom?: number
}

interface ConnectionLine {
    id: string
    from: Marker
    to: Marker
    dayId: string
    fromId: string
    toId: string
    color: string
}

export const ConnectionLines = ({ zoom = 11, basemap = 'osm', routeProvider }: ConnectionLinesProps) => {
    const { markers, tripDays, activeView, interactionState } = useMapStore()
    const { highlightedDayId } = interactionState
    const { current: map } = useMap()
    const [routeViewport, setRouteViewport] = useState<RouteViewport | null>(null)
    useEffect(() => {
        const instance = map?.getMap()
        if (!instance) return
        const update = () => {
            const bounds = instance.getBounds(), center = instance.getCenter()
            setRouteViewport({ west: bounds.getWest(), east: bounds.getEast(), south: bounds.getSouth(), north: bounds.getNorth(), centerLat: center.lat, centerLng: center.lng })
        }
        update()
        instance.on('moveend', update)
        return () => { instance.off('moveend', update) }
    }, [map])

    // 订阅 zoomThreshold 动态变化（响应 window.__setZoomThreshold 调用）
    const zoomThreshold = useSyncExternalStore(
        (cb) => {
            window.addEventListener('zoomThresholdChange', cb)
            return () => window.removeEventListener('zoomThresholdChange', cb)
        },
        () => getZoomThreshold(),
        () => getZoomThreshold(),
    )

    // hover 临时激活的 dayId（优先级高于 click 锁定的 highlightedDayId）
    const [hoveredDayId, setHoveredDayId] = useState<string | null>(null)
    const effectiveDayId = activeView.mode === 'day' ? activeView.dayId : highlightedDayId ?? hoveredDayId

    // 监听 marker hover 事件（临时激活）
    useEffect(() => {
        const handler = (e: Event) => {
            setHoveredDayId((e as CustomEvent).detail.dayId)
        }
        window.addEventListener('markerDayHover', handler)
        return () => window.removeEventListener('markerDayHover', handler)
    }, [])

    // hover/click 线段时激活对应 day
    useEffect(() => {
        const mapInstance = map?.getMap()
        if (!mapInstance) return

        const LINE_LAYERS = ['connection-lines-hit-area']

        const onMouseEnter = (e: any) => {
            const dayId = e.features?.[0]?.properties?.dayId
            if (dayId) setHoveredDayId(dayId)
            mapInstance.getCanvas().style.cursor = 'pointer'
        }

        const onMouseLeave = () => {
            setHoveredDayId(null)
            mapInstance.getCanvas().style.cursor = ''
        }

        const onClick = (e: any) => {
            const state = useMapStore.getState()
            if (state.activeView.mode === 'day') return
            const features = mapInstance.queryRenderedFeatures(e.point, { layers: LINE_LAYERS })
            const candidates = features.flatMap(feature => {
                if (feature.geometry.type !== 'LineString' || !feature.properties?.dayId) return []
                return [{ dayId: String(feature.properties.dayId), path: feature.geometry.coordinates.map(position => mapInstance.project([position[0], position[1]])) }]
            })
            const picked = pickRouteDay(e.point, candidates, state.interactionState.highlightedDayId)
            const day = state.tripDays.find(item => item.id === picked)
            if (day) { setHoveredDayId(null); state.setActiveView('day', day.tripId, day.id, { focusFirstMarker: false }) }
        }

        LINE_LAYERS.forEach(layer => {
            mapInstance.on('mouseenter', layer, onMouseEnter)
            mapInstance.on('mouseleave', layer, onMouseLeave)
            mapInstance.on('click', layer, onClick)
        })

        return () => {
            LINE_LAYERS.forEach(layer => {
                mapInstance.off('mouseenter', layer, onMouseEnter)
                mapInstance.off('mouseleave', layer, onMouseLeave)
                mapInstance.off('click', layer, onClick)
            })
        }
    }, [map])

    // 按 activeView 过滤相关的 TripDay
    const relevantDays = useMemo(() => {
        if (activeView.mode === 'day' && activeView.dayId) {
            return tripDays.filter(d => d.id === activeView.dayId)
        }
        if (activeView.mode === 'trip' && activeView.tripId) {
            return tripDays.filter(d => d.tripId === activeView.tripId)
        }
        // overview：取全部
        return tripDays
    }, [tripDays, activeView])

    // 计算所有连接线：每个 day 的 chains 里相邻对
    const connectionLines = useMemo(() => {
        const lines: ConnectionLine[] = []
        const markerMap = new Map(markers.map(m => [m.id, { ...m, coordinates: toMapCoordinates(m.coordinates, basemap) }]))

        for (const day of relevantDays) {
            const chains = day.chains ?? []
            for (let ci = 0; ci < chains.length; ci++) {
                const chain = chains[ci]
                for (let i = 0; i < chain.length - 1; i++) {
                    const fromMarker = markerMap.get(chain[i])
                    const toMarker = markerMap.get(chain[i + 1])
                    if (fromMarker && toMarker) {
                        lines.push({
                            id: `${day.id}-c${ci}-${i}`,
                            from: fromMarker,
                            to: toMarker,
                            dayId: day.id,
                            fromId: fromMarker.id,
                            toId: toMarker.id,
                            color: routeColor(ci, day.id, day.colorIndex),
                        })
                    }
                }
            }
        }

        return lines
    }, [relevantDays, markers, basemap])

    const routeSettings = useRouteSettings()
    const segments = useMemo(() => connectionLines.map(line => ({
        fromId: line.fromId, toId: line.toId,
        origin: { lat: line.from.coordinates.latitude, lng: line.from.coordinates.longitude },
        destination: { lat: line.to.coordinates.latitude, lng: line.to.coordinates.longitude },
    })), [connectionLines])
    const planned = usePlannedRoutes(segments, routeProvider, routeViewport)

    // 计算需要高亮的连线ID（hover 临时覆盖 click 锁定）
    const highlightedLineIds = useMemo(() => {
        if (!effectiveDayId) return []
        return connectionLines
            .filter(l => l.dayId === effectiveDayId)
            .map(l => l.id)
    }, [connectionLines, effectiveDayId])

    // Each segment uses its planned path once cached; pending/failed segments retain the curve.
    const lineControlPoints = useMemo(() => {
        const displayPaths = layoutRoutePaths(connectionLines.map((line, index) => {
            const path = planned.enabled ? planned.routes[routeCacheKey(routeProvider, routeSettings.mode, segments[index])] ?? null : null
            return { dayId: line.dayId, path: isRangeFallback(path) ? null : path }
        }))
        return connectionLines.map((line, index) => {
            const from = { lat: line.from.coordinates.latitude, lng: line.from.coordinates.longitude }
            const to = { lat: line.to.coordinates.latitude, lng: line.to.coordinates.longitude }
            return { id: line.id, from, ctrl: getControlPoint(from, to), to, route: displayPaths[index] }
        })
    }, [connectionLines, planned.enabled, planned.routes, routeProvider, routeSettings.mode, segments])

    // 小圆球动画
    useEffect(() => {
        const mapInstance = map?.getMap()

        // Stop animation when no highlighted lines or map not ready
        if (!mapInstance || highlightedLineIds.length === 0 || zoom < zoomThreshold) {
            // Clear dots
            const src = mapInstance?.getSource('connection-dots') as GeoJSONSource | undefined
            src?.setData(emptyFeatureCollection)
            return
        }

        const highlighted = new Set(highlightedLineIds)
        const colors = new Map(connectionLines.map(line => [line.id, line.color]))
        const lines = lineControlPoints.filter(line => highlighted.has(line.id))

        const animate = (now: number) => {
            const progress = (now / 2100) % 1

            const features: GeoJSON.Feature[] = lines.flatMap(lc => {
                const { lng, lat } = lc.route ? pointAlongPath(lc.route, progress) : (() => {
                    const [lng, lat] = bezierPoint(lc.from, lc.ctrl, lc.to, progress)
                    return { lng, lat }
                })()
                return [{
                    type: 'Feature' as const,
                    geometry: { type: 'Point' as const, coordinates: [lng, lat] },
                    properties: { opacity: Math.min(1, progress * 10, (1 - progress) * 10), radius: 5, color: colors.get(lc.id) || routeColor(0) }
                }]
            })

            const src = mapInstance.getSource('connection-dots') as unknown as GeoJSONSource | undefined
            src?.setData({ type: 'FeatureCollection', features })
        }

        return startAnimationLoop(animate, () => {
            const src = mapInstance.getSource('connection-dots') as GeoJSONSource | undefined
            src?.setData(emptyFeatureCollection)
        })
    }, [highlightedLineIds, lineControlPoints, connectionLines, map, zoom, zoomThreshold])

    // 生成贝塞尔曲线连接线的 GeoJSON
    const connectionGeoJSON = useMemo(() => {
        if (connectionLines.length === 0) {
            return {
                type: 'FeatureCollection' as const,
                features: []
            }
        }

        const features = connectionLines.map((line, index) => {
            const plannedPath = lineControlPoints[index].route
            const coordinates = plannedPath
                ? plannedPath.map(point => [point.lng, point.lat] as [number, number])
                : getBezierPath(
                    { lat: line.from.coordinates.latitude, lng: line.from.coordinates.longitude },
                    { lat: line.to.coordinates.latitude, lng: line.to.coordinates.longitude }
                )

            return {
                type: 'Feature' as const,
                geometry: {
                    type: 'LineString' as const,
                    coordinates
                },
                properties: {
                    id: line.id,
                    fromId: line.from.id,
                    toId: line.to.id,
                    dayId: line.dayId,
                    isDragPreview: false,
                    isWalkingRoute: false,
                    color: line.color,
                    schematic: planned.enabled && (!plannedPath || isRangeFallback(planned.routes[routeCacheKey(routeProvider, routeSettings.mode, segments[index])])),
                }
            }
        })

        return {
            type: 'FeatureCollection' as const,
            features
        }
    }, [connectionLines, lineControlPoints, planned.enabled, planned.routes, routeProvider, routeSettings.mode, segments])

    // 如果没有连接线，不渲染任何内容
    if (connectionLines.length === 0) {
        return null
    }

    // 当缩放级别小于阈值时，隐藏连接线
    if (zoom < zoomThreshold) {
        return null
    }

    return (
        <>
            <Source id="connection-lines" type="geojson" data={connectionGeoJSON}>
                <Layer id="connection-lines-hit-area" type="line" paint={{ 'line-width': 28, 'line-opacity': 0 }} layout={{ 'line-join': 'round', 'line-cap': 'round' }} />
                {/* 白色描边层（casing）— 在所有线层最下面，制造轮廓对比 */}
                <Layer
                    id="connection-lines-casing"
                    type="line"
                    paint={{
                        'line-color': 'rgba(255, 255, 255, 0.95)',
                        'line-width': [
                            'interpolate', ['linear'], ['zoom'],
                            10, 5,
                            15, 6,
                            20, 7
                        ],
                        'line-opacity': [
                            'case',
                            ['>', ['length', ['literal', highlightedLineIds]], 0],
                            0.4,
                            0.8
                        ],
                    }}
                    layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                />

                {/* 普通连接线 — 靛蓝色，比灰色更易识别 */}
                <Layer
                    id="connection-lines-layer"
                    type="line"
                    paint={{
                        'line-color': ['get', 'color'],
                        'line-width': [
                            'interpolate', ['linear'], ['zoom'],
                            10, 3,
                            15, 4,
                            20, 5
                        ],
                        'line-opacity': [
                            'case',
                            ['>', ['length', ['literal', highlightedLineIds]], 0],
                            0.25,
                            0.8
                        ],
                    }}
                    layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                    filter={['==', ['get', 'schematic'], false]}
                />

                <Layer id="schematic-connection-lines-layer" type="line" paint={{ 'line-color': ['get', 'color'], 'line-width': 4, 'line-dasharray': [2, 2], 'line-opacity': 0.65 }} layout={{ 'line-join': 'round', 'line-cap': 'round' }} filter={['==', ['get', 'schematic'], true]} />

                {/* 高亮白色描边 */}
                <Layer
                    id="highlighted-connection-lines-casing"
                    type="line"
                    paint={{
                        'line-color': 'rgba(255, 255, 255, 0.95)',
                        'line-width': [
                            'interpolate', ['linear'], ['zoom'],
                            10, 6,
                            15, 8,
                            20, 10
                        ],
                        'line-opacity': 1,
                    }}
                    layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                    filter={highlightedLineIds.length > 0 ? [
                        'in', ['get', 'id'], ['literal', highlightedLineIds]
                    ] : ['literal', false]}
                />

                {/* 高亮连接线 */}
                <Layer
                    id="highlighted-connection-lines-layer"
                    type="line"
                    paint={{
                        'line-color': ['get', 'color'],
                        'line-width': [
                            'interpolate', ['linear'], ['zoom'],
                            10, 4,
                            15, 6,
                            20, 8
                        ],
                        'line-opacity': 1,
                    }}
                    layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                    filter={highlightedLineIds.length > 0 ? ['all', ['==', ['get', 'schematic'], false], [
                        'in', ['get', 'id'], ['literal', highlightedLineIds]
                    ]] : ['literal', false]}
                />
            </Source>

            {/* 小圆球动画层（always mounted so source is available for rAF writes） */}
            <Source id="connection-dots" type="geojson" data={emptyFeatureCollection}>
                <Layer
                    id="connection-dots-layer"
                    type="circle"
                    paint={{
                        'circle-radius': ['get', 'radius'],
                        'circle-color': ['get', 'color'],
                        'circle-opacity': ['get', 'opacity'],
                        'circle-blur': 0.2,
                        'circle-stroke-width': 1.5,
                        'circle-stroke-color': 'rgba(255, 255, 255, 0.9)',
                    }}
                />
            </Source>
        </>
    )
}
