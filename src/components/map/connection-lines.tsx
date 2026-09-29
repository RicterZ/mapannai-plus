'use client'

import { useMemo, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Source, Layer, useMap } from 'react-map-gl/maplibre'
import type { GeoJSONSource } from 'maplibre-gl'
import { toMapCoordinates } from '@/lib/map/basemap'
import type { BasemapProviderType } from '@/types/map-provider'
import { Marker } from '@/types/marker'
import { useMapStore } from '@/store/map-store'
import { getZoomThreshold } from '@/lib/zoom-threshold'

/** 计算贝塞尔控制点 */
function getControlPoint(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number }
): { lat: number; lng: number } {
    const midLat = (from.lat + to.lat) / 2
    const midLng = (from.lng + to.lng) / 2
    const dLat = to.lat - from.lat
    const dLng = to.lng - from.lng
    const dist = Math.sqrt(dLat * dLat + dLng * dLng)
    if (dist === 0) return { lat: midLat, lng: midLng }
    const offset = dist * 0.15
    return {
        lat: midLat - dLng * offset / dist,
        lng: midLng + dLat * offset / dist,
    }
}

/** 计算二次贝塞尔曲线在参数 t 处的坐标 [lng, lat] */
function bezierPoint(
    from: { lat: number; lng: number },
    ctrl: { lat: number; lng: number },
    to: { lat: number; lng: number },
    t: number
): [number, number] {
    const lng = (1 - t) * (1 - t) * from.lng + 2 * (1 - t) * t * ctrl.lng + t * t * to.lng
    const lat = (1 - t) * (1 - t) * from.lat + 2 * (1 - t) * t * ctrl.lat + t * t * to.lat
    return [lng, lat]
}

/**
 * 生成二次贝塞尔曲线坐标点
 * 控制点为两点中点向垂直方向偏移，偏移量与两点距离成比例
 */
function getBezierPath(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    numPoints = 32
): Array<[number, number]> {
    const ctrl = getControlPoint(from, to)
    if (ctrl.lat === from.lat && ctrl.lng === from.lng) {
        return [[from.lng, from.lat], [to.lng, to.lat]]
    }

    // 采样贝塞尔曲线
    const points: Array<[number, number]> = []
    for (let i = 0; i <= numPoints; i++) {
        points.push(bezierPoint(from, ctrl, to, i / numPoints))
    }
    return points
}

const emptyFeatureCollection: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: []
}

interface ConnectionLinesProps {
    basemap?: BasemapProviderType
    markers?: Marker[]
    zoom?: number
}

interface ConnectionLine {
    id: string
    from: Marker
    to: Marker
    dayId: string
}

export const ConnectionLines = ({ zoom = 11, basemap = 'osm' }: ConnectionLinesProps) => {
    const { markers, tripDays, activeView, interactionState } = useMapStore()
    const { highlightedDayId } = interactionState
    const { current: map } = useMap()

    // 订阅 zoomThreshold 动态变化（响应 window.__setZoomThreshold 调用）
    const zoomThreshold = useSyncExternalStore(
        (cb) => {
            window.addEventListener('zoomThresholdChange', cb)
            return () => window.removeEventListener('zoomThresholdChange', cb)
        },
        () => getZoomThreshold(),
        () => getZoomThreshold(),
    )

    // rAF handle and animation progress (not React state to avoid re-renders)
    const rafRef = useRef<number | null>(null)
    const tRef = useRef(0)

    // hover 临时激活的 dayId（优先级高于 click 锁定的 highlightedDayId）
    const [hoveredDayId, setHoveredDayId] = useState<string | null>(null)
    const effectiveDayId = hoveredDayId ?? highlightedDayId

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

        const LINE_LAYERS = ['connection-lines-layer', 'connection-lines-casing']

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
            const dayId = e.features?.[0]?.properties?.dayId
            if (!dayId) return
            const { activeView, setHighlightedDay } = useMapStore.getState()
            if (activeView.mode !== 'day') {
                setHighlightedDay(dayId)
            }
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
                        })
                    }
                }
            }
        }

        return lines
    }, [relevantDays, markers, basemap])

    // 计算需要高亮的连线ID（hover 临时覆盖 click 锁定）
    const highlightedLineIds = useMemo(() => {
        if (!effectiveDayId) return []
        return connectionLines
            .filter(l => l.dayId === effectiveDayId)
            .map(l => l.id)
    }, [connectionLines, effectiveDayId])

    // 预计算每条连线的控制点（避免动画循环中重复计算）
    const lineControlPoints = useMemo(() =>
        connectionLines.map(line => {
            const from = { lat: line.from.coordinates.latitude, lng: line.from.coordinates.longitude }
            const to = { lat: line.to.coordinates.latitude, lng: line.to.coordinates.longitude }
            return {
                id: line.id,
                from,
                ctrl: getControlPoint(from, to),
                to,
            }
        }),
        [connectionLines]
    )

    // 小圆球动画
    useEffect(() => {
        const mapInstance = map?.getMap()

        // Stop animation when no highlighted lines or map not ready
        if (!mapInstance || highlightedLineIds.length === 0) {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current)
                rafRef.current = null
            }
            // Clear dots
            const src = mapInstance?.getSource('connection-dots') as GeoJSONSource | undefined
            src?.setData(emptyFeatureCollection)
            return
        }

        tRef.current = 0

        const animate = () => {
            // Advance progress ~0.008/frame → ~2s per loop at 60fps
            tRef.current = (tRef.current + 0.008) % 1

            const features: GeoJSON.Feature[] = highlightedLineIds.flatMap(lineId => {
                const lc = lineControlPoints.find(l => l.id === lineId)
                if (!lc) return []
                const [lng, lat] = bezierPoint(lc.from, lc.ctrl, lc.to, tRef.current)
                return [{
                    type: 'Feature' as const,
                    geometry: { type: 'Point' as const, coordinates: [lng, lat] },
                    properties: { opacity: 1, radius: 7 }
                }]
            })

            const src = mapInstance.getSource('connection-dots') as unknown as GeoJSONSource | undefined
            src?.setData({ type: 'FeatureCollection', features })
            rafRef.current = requestAnimationFrame(animate)
        }

        rafRef.current = requestAnimationFrame(animate)

        return () => {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current)
                rafRef.current = null
            }
        }
    }, [highlightedLineIds, lineControlPoints, map])

    // 生成贝塞尔曲线连接线的 GeoJSON
    const connectionGeoJSON = useMemo(() => {
        if (connectionLines.length === 0) {
            return {
                type: 'FeatureCollection' as const,
                features: []
            }
        }

        const features = connectionLines.map(line => {
            const coordinates = getBezierPath(
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
                    isWalkingRoute: false
                }
            }
        })

        return {
            type: 'FeatureCollection' as const,
            features
        }
    }, [connectionLines])

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
                {/* 白色描边层（casing）— 在所有线层最下面，制造轮廓对比 */}
                <Layer
                    id="connection-lines-casing"
                    type="line"
                    paint={{
                        'line-color': 'rgba(255, 255, 255, 0.95)',
                        'line-width': [
                            'interpolate', ['linear'], ['zoom'],
                            10, 6,
                            15, 8,
                            20, 10
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
                        'line-color': 'rgb(99, 102, 241)', // indigo-500
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
                />

                {/* 高亮白色描边 */}
                <Layer
                    id="highlighted-connection-lines-casing"
                    type="line"
                    paint={{
                        'line-color': 'rgba(255, 255, 255, 0.95)',
                        'line-width': [
                            'interpolate', ['linear'], ['zoom'],
                            10, 8,
                            15, 11,
                            20, 14
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
                        'line-color': 'rgba(59, 130, 246, 1)', // blue-500
                        'line-width': [
                            'interpolate', ['linear'], ['zoom'],
                            10, 4,
                            15, 6,
                            20, 8
                        ],
                        'line-opacity': 1,
                    }}
                    layout={{ 'line-join': 'round', 'line-cap': 'round' }}
                    filter={highlightedLineIds.length > 0 ? [
                        'in', ['get', 'id'], ['literal', highlightedLineIds]
                    ] : ['literal', false]}
                />
            </Source>

            {/* 小圆球动画层（always mounted so source is available for rAF writes） */}
            <Source id="connection-dots" type="geojson" data={emptyFeatureCollection}>
                <Layer
                    id="connection-dots-layer"
                    type="circle"
                    paint={{
                        'circle-radius': ['get', 'radius'],
                        'circle-color': 'rgba(59, 130, 246, 1)',
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
