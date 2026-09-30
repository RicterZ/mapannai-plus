'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Popup } from 'react-map-gl/maplibre'
import { MarkerCoordinates } from '@/types/marker'
import { useMapStore } from '@/store/map-store'
import { cn } from '@/utils/cn'
import { toMapCoordinates } from '@/lib/map/basemap'
import type { BasemapProviderType } from '@/types/map-provider'
import { wgs84ToGcj02 } from '@/lib/coord-transform'
import { compressedImageUrl } from '@/lib/upload/image-url'

interface MapPopupProps {
    basemap?: BasemapProviderType
    embedded?: boolean
    coordinates: MarkerCoordinates
    selectedMarkerId: string | null
    onAddMarker: (name?: string) => void
    onViewMarker: (markerId: string) => void
    onDeleteMarker: (markerId: string) => void
    onClose: () => void
    placeName?: string
    placeAddress?: string
    onInteract?: () => void
}

export const MapPopup = ({
    coordinates,
    basemap = 'osm',
    embedded = false,
    selectedMarkerId,
    onAddMarker,
    onViewMarker,
    onDeleteMarker,
    onClose,
    placeName,
    placeAddress,
    onInteract,
}: MapPopupProps) => {
    const popupRef = useRef<HTMLDivElement>(null)
    const { markers, activeView, tripDays, trips, interactionState, editMode, addMarkerToDay, setActiveView, openLeftSidebar, closeSidebar } = useMapStore()

    const { isSidebarOpen } = interactionState
    const isSidebarShowingThisMarker = isSidebarOpen && interactionState.selectedMarkerId === selectedMarkerId

    const selectedMarker = selectedMarkerId
        ? markers.find(m => m.id === selectedMarkerId)
        : null

    // "加入今天" 按钮逻辑（Day 模式）
    const currentDay = activeView.mode === 'day' && activeView.dayId
        ? tripDays.find(d => d.id === activeView.dayId)
        : null
    const isMarkerInCurrentDay = currentDay && selectedMarkerId
        ? currentDay.markerIds.includes(selectedMarkerId)
        : false

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
                if (!(event.target as HTMLElement).closest('.map-marker') &&
                    !(event.target as HTMLElement).closest('.maplibregl-map') &&
                    !(event.target as HTMLElement).closest('.amap-container') &&
                    !(event.target as HTMLElement).closest('.left-sidebar') &&
                    !(event.target as HTMLElement).closest('.right-sidebar')) {
                    onClose()
                }
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [onClose])

    // 该标记所属的行程+天列表（通过 tripDays 查找，SQLite 为权威来源）
    // 每条记录：{ trip, day, dayIndex }
    const markerTripDays = selectedMarkerId
        ? tripDays
            .filter(d => d.markerIds.includes(selectedMarkerId))
            .map(d => {
                const trip = trips.find(t => t.id === d.tripId)
                if (!trip) return null
                const sortedDays = tripDays
                    .filter(td => td.tripId === d.tripId)
                    .sort((a, b) => a.date.localeCompare(b.date))
                const dayIndex = sortedDays.findIndex(td => td.id === d.id)
                return { trip, day: d, dayIndex }
            })
            .filter((x): x is NonNullable<typeof x> => !!x)
        : []

    const handleGoToDay = (tripId: string, dayId: string) => {
        setActiveView('day', tripId, dayId)
        openLeftSidebar()
    }

    const handleAddToDay = async () => {
        if (!selectedMarkerId || !activeView.tripId || !activeView.dayId) return
        try {
            await addMarkerToDay(activeView.tripId, activeView.dayId, selectedMarkerId)
            toast.success('已加入今天行程')
            onClose()
        } catch {
            toast.error('操作失败，请重试')
        }
    }

    const content = (
            <div
                ref={popupRef}
                className={cn(
                    'bg-white rounded-xl shadow-2xl',
                    'w-[240px] overflow-hidden'
                )}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={() => onInteract?.()}
            >
                {selectedMarker ? (
                    // 已有标记：显示标题、编辑/删除、加入今天
                    <div className="max-w-[280px]">
                        {selectedMarker.content.headerImage && (
                            <div className="w-full h-28 bg-gray-100">
                                <img
                                    src={compressedImageUrl(selectedMarker.content.headerImage)}
                                    alt={selectedMarker.content.title || '标记图片'}
                                    className="w-full h-full object-cover"
                                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                                />
                            </div>
                        )}
                        <div className="p-3 space-y-2">
                            <h3 className="text-sm font-semibold text-gray-800">
                                {selectedMarker.content.title || '未命名标记'}
                            </h3>
                            {selectedMarker.content.address && (
                                <p className="text-xs text-gray-500 leading-relaxed">{selectedMarker.content.address}</p>
                            )}
                            <div className="flex gap-1.5">
                                <button
                                    onClick={() => isSidebarShowingThisMarker ? closeSidebar() : onViewMarker(selectedMarkerId!)}
                                    className={cn(
                                        'flex-1 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors focus:outline-none flex items-center justify-center gap-1',
                                        isSidebarShowingThisMarker
                                            ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                            : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                                    )}
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                    {isSidebarShowingThisMarker ? '收起' : '查看'}
                                </button>
                                <a
                                    href={(() => { const gcj = wgs84ToGcj02(selectedMarker.coordinates.longitude, selectedMarker.coordinates.latitude); return `https://maps.apple.com/?ll=${gcj.latitude},${gcj.longitude}&q=${encodeURIComponent(selectedMarker.content.title || '标记位置')}` })()}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-1 px-2 py-1.5 text-xs font-medium rounded-lg bg-green-50 text-green-600 hover:bg-green-100 transition-colors flex items-center justify-center gap-1"
                                    title="在地图中打开"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                    导航
                                </a>
                                {editMode.isEnabled && <button
                                    onClick={() => onDeleteMarker(selectedMarkerId!)}
                                    className="flex-1 px-2 py-1.5 text-xs font-medium whitespace-nowrap rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors focus:outline-none flex items-center justify-center gap-1"
                                >
                                    <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                    删除
                                </button>}
                            </div>
                            {markerTripDays.length > 0 && (
                                <div className="space-y-1">
                                    {markerTripDays.map(({ trip, day, dayIndex }) => (
                                        <button
                                            key={day.id}
                                            onClick={() => handleGoToDay(trip.id, day.id)}
                                            className="w-full px-2 py-1.5 text-xs font-medium rounded-lg bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors flex items-center gap-1.5"
                                        >
                                            <svg className="w-3 h-3 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                                            </svg>
                                            <span className="truncate">{trip.name}</span>
                                            <span className="flex-shrink-0 text-gray-400">· 第{dayIndex + 1}天</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {editMode.isEnabled && currentDay && !isMarkerInCurrentDay && (
                                <button
                                    onClick={handleAddToDay}
                                    className="w-full px-2 py-1.5 text-xs font-medium rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition-colors flex items-center justify-center gap-1"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                    </svg>
                                    加入今天行程
                                </button>
                            )}
                            {currentDay && isMarkerInCurrentDay && (
                                <span className="block text-xs text-indigo-500 text-center">✓ 已在今天行程中</span>
                            )}
                        </div>
                    </div>
                ) : (
                    // 空白区域：显示地点信息 + 添加按钮
                    <div className="p-0">
                        <div className="bg-gradient-to-r from-slate-50 to-gray-50 px-3 py-2.5 border-b border-gray-200">
                            <div className="min-w-0 space-y-1">
                                {placeName ? (
                                    <h3 className="text-sm font-semibold text-gray-900 truncate" title={placeName}>{placeName}</h3>
                                ) : (
                                    <div className="h-5 bg-gray-200 rounded animate-pulse mb-1 w-4/5"></div>
                                )}
                                {placeAddress ? (
                                    <p className="text-xs text-gray-600 truncate leading-relaxed" title={placeAddress}>{placeAddress}</p>
                                ) : (
                                    <div className="h-[19.5px] bg-gray-200 rounded animate-pulse w-full mt-1"></div>
                                )}
                            </div>
                        </div>
                        <div className="p-2 space-y-2">
                            <button
                                onClick={() => onAddMarker(placeName)}
                                className="w-full px-3 py-1.5 text-sm font-medium rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-700 hover:to-blue-800 transition-all flex items-center justify-center gap-2 shadow-md focus:outline-none"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                添加标记
                            </button>
                            <p className="text-xs text-gray-400 font-mono text-center">
                                {coordinates.latitude.toFixed(4)}, {coordinates.longitude.toFixed(4)}
                            </p>
                        </div>
                    </div>
                )}

                <button
                    onClick={onClose}
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-black/70 hover:bg-black/80 text-white flex items-center justify-center transition-colors shadow-lg"
                    aria-label="关闭弹窗"
                >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>
    )
    if (embedded) return <div className="relative">
        <span aria-hidden="true" className="absolute -top-2 left-1/2 -translate-x-1/2 w-0 h-0 border-x-[9px] border-x-transparent border-b-[9px] border-b-white" />
        {content}
    </div>
    return <Popup
        longitude={toMapCoordinates(coordinates, basemap).longitude}
        latitude={toMapCoordinates(coordinates, basemap).latitude}
        anchor="top" closeButton={false} closeOnClick={false} closeOnMove={false}
        className="map-popup" maxWidth="300px"
    >{content}</Popup>
}
