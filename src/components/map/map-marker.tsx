'use client'

import React, { useState, useCallback, useSyncExternalStore } from 'react'
import { Marker, MARKER_ICONS } from '@/types/marker'
import { cn } from '@/utils/cn'
import { getZoomThreshold } from '@/lib/zoom-threshold'
import { useMapStore } from '@/store/map-store'

interface MapMarkerProps {
    marker: Marker
    isSelected: boolean
    onClick: () => void
    zoom?: number
}

export const MapMarker = React.memo(function MapMarker({
    marker,
    isSelected,
    onClick,
    zoom
}: MapMarkerProps) {
    const [isHovered, setIsHovered] = useState(false)
    const iconType = marker.content.iconType || 'location'

    // 订阅 zoomThreshold 动态变化（响应 window.__setZoomThreshold 调用）
    const zoomThreshold = useSyncExternalStore(
        (cb) => {
            window.addEventListener('zoomThresholdChange', cb)
            return () => window.removeEventListener('zoomThresholdChange', cb)
        },
        () => getZoomThreshold(),
        () => getZoomThreshold(),
    )

    const handleMouseEnter = useCallback(() => {
        setIsHovered(true)
        const { tripDays, activeView } = useMapStore.getState()
        if (activeView.mode !== 'day') {
            const day = tripDays.find(d => d.markerIds.includes(marker.id))
            window.dispatchEvent(new CustomEvent('markerDayHover', { detail: { dayId: day?.id ?? null } }))
        }
    }, [marker.id])

    const handleMouseLeave = useCallback(() => {
        setIsHovered(false)
        window.dispatchEvent(new CustomEvent('markerDayHover', { detail: { dayId: null } }))
    }, [])
    
    // 安全获取图标配置，如果不存在则使用默认的 location 配置
    const iconConfig = MARKER_ICONS[iconType] || MARKER_ICONS['location']

    // 从配置中读取背景色类
    const markerColor = `${iconConfig.bgClass} ${iconConfig.hoverBgClass}`

    // 当缩放级别较小时，仅显示纯色小点
    const shouldRenderAsDot = typeof zoom === 'number' && zoom < zoomThreshold

    // 检查是否为临时标记
    const isTemporary = marker.content.isTemporary
    const hasSyncError = marker.content.syncError

    return (
        <div
            role="button"
            aria-pressed={isSelected}
            className={cn(
                'map-marker relative flex items-center justify-center',
                'w-[28px] h-[28px] border-2',
                'rounded-full border-white',
                'transition-all duration-300 ease-out',
                'origin-center', // 确保变换以中心为原点
                // 根据缩放级别调整大小
                shouldRenderAsDot ? 'scale-[0.36]' : 'scale-100', // 0.36 = 10/28，保持中心缩放
                // 增强的hover效果：放大 + 增加不透明度
                shouldRenderAsDot 
                    ? 'hover:scale-[0.36] shadow-none' 
                    : 'hover:scale-125 hover:opacity-100 shadow-lg hover:shadow-xl',
                'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
                // 临时标记样式
                isTemporary && !hasSyncError
                    ? 'bg-yellow-500/75 hover:bg-yellow-500 animate-pulse' // 同步中的临时标记
                    : hasSyncError
                    ? 'bg-red-500/75 hover:bg-red-500' // 同步失败的标记
                    : isSelected
                    ? shouldRenderAsDot 
                        ? 'bg-blue-600 scale-[0.36] z-10' // 圆点状态时，选中圆圈也缩小
                        : 'bg-blue-600 scale-110 z-10 ring-2 ring-blue-600 ring-offset-2' // 正常状态时，选中圆圈放大
                    : markerColor
            )}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onClick()
            }}
            aria-label={`${iconConfig.name}: ${marker.content.title || '未命名标记'} at ${marker.coordinates.latitude}, ${marker.coordinates.longitude}`}
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onClick()
                }
            }}
        >
            {!shouldRenderAsDot && (
                <div className="w-4 h-4 flex items-center justify-center">
                    <span className="text-white text-xs filter drop-shadow-sm">
                        {iconConfig.emoji}
                    </span>
                </div>
            )}

            {/* Selection indicator */}
            {isSelected && !shouldRenderAsDot && (
                <div className="absolute -inset-1 bg-blue-400 rounded-full animate-pulse opacity-30" />
            )}

            {/* Hover effect indicator */}
            {isHovered && !shouldRenderAsDot && !isSelected && (
                <div className="absolute -inset-2 bg-white rounded-full opacity-20 animate-pulse" />
            )}

            {/* 临时标记状态指示器 */}
            {!shouldRenderAsDot && isTemporary && (
                <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full flex items-center justify-center">
                    {hasSyncError ? (
                        // 同步失败指示器
                        <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" title={`同步失败: ${marker.content.syncError}`} />
                    ) : (
                        // 同步中指示器
                        <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" title="正在同步到服务器..." />
                    )}
                </div>
            )}
        </div>
    )
}, (prev, next) => {
    return prev.marker.id === next.marker.id &&
        prev.isSelected === next.isSelected &&
        prev.zoom === next.zoom &&
        prev.marker.content.iconType === next.marker.content.iconType &&
        prev.marker.content.title === next.marker.content.title &&
        prev.marker.content.isTemporary === next.marker.content.isTemporary &&
        prev.marker.content.syncError === next.marker.content.syncError
})
