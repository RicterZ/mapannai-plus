'use client'

import { useRef, useCallback, useState, useEffect } from 'react'
import { useMapStore } from '@/store/map-store'
import { cn } from '@/utils/cn'
import { toast } from 'sonner'
import { wgs84ToGcj02 } from '@/lib/coord-transform'
import { compressedImageUrl, compressedContentImages } from '@/lib/upload/image-url'

interface SidebarProps {
    onClose?: () => void
}

export const Sidebar = ({ onClose }: SidebarProps) => {
    const sidebarRef = useRef<HTMLDivElement>(null)
    const [isAddingToChain, setIsAddingToChain] = useState(false)
    const [targetMarkerId, setTargetMarkerId] = useState<string | null>(null)
    const [confirmingDelete, setConfirmingDelete] = useState(false) // kept for potential future use
    // Animation state: 'hidden' | 'entering' | 'visible' | 'exiting'
    const [animState, setAnimState] = useState<'hidden' | 'entering' | 'visible' | 'exiting'>('hidden')
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const {
        markers,
        interactionState,
        closeSidebar,
        editMarkerModal,
        openEditMarkerModal,
        selectMarker,
        activeView,
        tripDays,
        addMarkerToDay,
    } = useMapStore()

    // 自定义关闭函数，在移动端关闭时跳转到正中间
    const handleClose = useCallback(() => {
        const { selectedMarkerId } = interactionState

        // 关闭添加模式
        setIsAddingToChain(false)
        setTargetMarkerId(null)
        setConfirmingDelete(false)

        closeSidebar()
    }, [closeSidebar, interactionState.selectedMarkerId, markers])

    // 处理标记链中的标记点击
    const handleMarkerClick = useCallback((markerId: string) => {
        selectMarker(markerId)
    }, [selectMarker])

    // 处理添加标记到链中
    const handleAddToChain = useCallback((sourceMarkerId: string) => {
        setIsAddingToChain(true)
        setTargetMarkerId(sourceMarkerId)

        // 显示提示信息
        const event = new CustomEvent('showMessage', {
            detail: {
                type: 'info',
                message: '点击地图上的标记添加到链中',
                duration: 5000
            }
        })
        window.dispatchEvent(event)
    }, [])

    // 处理标记选择（当处于添加模式时）
    const handleMarkerSelection = useCallback((markerId: string) => {
        if (isAddingToChain) {
            if (targetMarkerId) {
                // 触发路径重新计算
                const refreshEvent = new CustomEvent('refreshConnectionLines')
                window.dispatchEvent(refreshEvent)

                // 显示成功消息
                const event = new CustomEvent('showMessage', {
                    detail: {
                        type: 'success',
                        message: '成功添加到标记链',
                        duration: 3000
                    }
                })
                window.dispatchEvent(event)
            } else {
                // 如果没有目标标记，说明是直接添加模式，不需要添加到链中
                return // 直接返回，不执行后续逻辑
            }

            // 重置状态
            setIsAddingToChain(false)
            setTargetMarkerId(null)
        } else {
            // 正常选择标记
            selectMarker(markerId)
        }
    }, [isAddingToChain, targetMarkerId, selectMarker])

    // 监听添加标记事件
    useEffect(() => {
        const handleAddMarkerToChain = (event: CustomEvent) => {
            if (isAddingToChain) {
                handleMarkerSelection(event.detail.markerId)
            }
        }

        const handleCheckAddingMode = (event: CustomEvent) => {
            if (event.detail && event.detail.callback) {
                event.detail.callback(isAddingToChain)
            }
        }

        const handleResetAddMode = () => {
            setIsAddingToChain(false)
            setTargetMarkerId(null)
        }

        // Popup 触发：「设为下一站」按钮
        const handleStartAddToChain = (event: CustomEvent) => {
            handleAddToChain(event.detail.markerId)
        }

        window.addEventListener('addMarkerToChain', handleAddMarkerToChain as EventListener)
        window.addEventListener('checkAddingMode', handleCheckAddingMode as EventListener)
        window.addEventListener('resetAddMode', handleResetAddMode as EventListener)
        window.addEventListener('startAddToChain', handleStartAddToChain as EventListener)

        return () => {
            window.removeEventListener('addMarkerToChain', handleAddMarkerToChain as EventListener)
            window.removeEventListener('checkAddingMode', handleCheckAddingMode as EventListener)
            window.removeEventListener('resetAddMode', handleResetAddMode as EventListener)
            window.removeEventListener('startAddToChain', handleStartAddToChain as EventListener)
        }
    }, [isAddingToChain, targetMarkerId, handleMarkerSelection, handleAddToChain])

    const { isSidebarOpen, selectedMarkerId, displayedMarkerId } = interactionState

    // Drive enter/exit animation based on isSidebarOpen
    useEffect(() => {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
        if (isSidebarOpen) {
            // Mount → next frame animate in
            setAnimState('entering')
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setAnimState('visible')
                })
            })
        } else {
            if (animState === 'visible' || animState === 'entering') {
                setAnimState('exiting')
                closeTimerRef.current = setTimeout(() => {
                    setAnimState('hidden')
                }, 300)
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isSidebarOpen])

    const selectedMarker = displayedMarkerId
        ? markers.find(m => m.id === displayedMarkerId)
        : null

    // 移除“点击外部关闭”监听，避免误触导致关闭

    // 渲染富文本内容的只读版本（存储为 HTML）
    const renderReadOnlyContent = (content: string) => {
        if (!content || content.trim() === '' || content === '<p></p>') {
            return (
                <div className="text-gray-500 text-center py-8">
                    <div className="text-4xl mb-2">📝</div>
                    <p>暂无详细内容</p>
                    <p className="text-sm mt-1">通过编辑按钮添加内容</p>
                </div>
            )
        }

        return (
            <div
                className="prose prose-sm max-w-none rich-content"
                dangerouslySetInnerHTML={{ __html: compressedContentImages(content) }}
            />
        )
    }

    if (animState === 'hidden') {
        return null
    }

    return (
        <>
            {/* Backdrop */}
            <div
                className={cn(
                    'fixed inset-0 bg-black z-[69] lg:hidden',
                    'transition-opacity duration-300',
                    animState === 'visible' ? 'opacity-25' : 'opacity-0',
                )}
                onClick={() => {
                    // 关闭添加模式
                    setIsAddingToChain(false)
                    setTargetMarkerId(null)
                    // 调用关闭函数
                    if (onClose) {
                        onClose()
                    } else {
                        closeSidebar()
                    }
                }}
            />

            {/* Sidebar */}
            <div
                ref={sidebarRef}
                className={cn(
                    'right-sidebar fixed z-[70]',
                    'w-full max-w-md lg:max-w-lg xl:max-w-xl',
                    'bg-white shadow-2xl',
                    'flex flex-col',
                    // iPad特定样式
                    'sidebar-ipad-portrait sidebar-ipad-landscape',
                    // 移动端：全屏显示
                    'right-0 bottom-0 h-full',
                    // PC端：正常右侧显示
                    'lg:right-0 lg:top-0 lg:bottom-0 lg:h-auto',
                    // Slide animation
                    'transition-transform duration-300 ease-out',
                    (animState === 'entering' || animState === 'exiting') ? 'translate-x-full' : 'translate-x-0',
                )}
                style={{
                    paddingTop: 'env(safe-area-inset-top)',
                    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                }}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
                    <div className="flex-1">
                        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                            {selectedMarker && (() => {
                                const iconType = selectedMarker.content.iconType || 'location'
                                // MARKER_ICONS 已在 marker-chain.tsx 引用，需在此处引入
                                const { MARKER_ICONS } = require('@/types/marker')
                                const icon = MARKER_ICONS[iconType]
                                return <span className="text-base" aria-hidden>{icon.emoji}</span>
                            })()}
                            <span>{selectedMarker?.content.title || '标记详情'}</span>
                        </h2>
                        {selectedMarker && (
                            <p className="text-sm text-gray-500 mt-1">
                                位置: {selectedMarker.coordinates.latitude.toFixed(6)}, {selectedMarker.coordinates.longitude.toFixed(6)}
                            </p>
                        )}
                    </div>

                    {/* 右側：今天 + 編集 + 閉じる */}
                    <div className="flex items-center gap-1">
                        {selectedMarker && (() => {
                            const { activeView, tripDays, addMarkerToDay } = useMapStore.getState()
                            const currentDay = activeView.mode === 'day' && activeView.dayId
                                ? tripDays.find(d => d.id === activeView.dayId)
                                : null
                            if (!currentDay) return null
                            const isInDay = currentDay.markerIds.includes(selectedMarker.id)
                            if (isInDay) return (
                                <span className="px-2 py-1 text-xs text-indigo-500 font-medium">✓ 今天</span>
                            )
                            return (
                                <button
                                    onClick={async () => {
                                        try {
                                            await addMarkerToDay(activeView.tripId!, activeView.dayId!, selectedMarker.id)
                                            toast.success('已加入今天行程')
                                        } catch {
                                            toast.error('操作失败')
                                        }
                                    }}
                                    className="px-2 py-1 rounded-lg bg-indigo-500 text-white text-xs font-medium hover:bg-indigo-600 transition-colors flex items-center gap-1"
                                    title="加入今天行程"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                    </svg>
                                    今天
                                </button>
                            )
                        })()}

                        {selectedMarker && (
                            <a
                                href={(() => { const gcj = wgs84ToGcj02(selectedMarker.coordinates.longitude, selectedMarker.coordinates.latitude); return `https://maps.apple.com/?ll=${gcj.latitude},${gcj.longitude}&q=${encodeURIComponent(selectedMarker.content.title || '标记位置')}` })()}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 rounded-lg text-gray-500 hover:text-green-600 hover:bg-green-50 transition-all duration-200 min-h-[40px] min-w-[40px] flex items-center justify-center"
                                title="在地图中打开"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </a>
                        )}

                        {selectedMarker && (
                            <button
                                onClick={() => openEditMarkerModal(selectedMarker.id)}
                                className="p-2 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-all duration-200 focus:outline-none min-h-[40px] min-w-[40px] flex items-center justify-center"
                                title="编辑标记"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                            </button>
                        )}

                        <button
                            onClick={handleClose}
                            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-200 focus:outline-none min-h-[40px] min-w-[40px] flex items-center justify-center"
                            aria-label="关闭侧边栏"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* 添加模式指示器 */}
                {isAddingToChain && (
                    <div className="px-4 py-2 bg-blue-50 border-b border-blue-200">
                        <div className="flex items-center space-x-2">
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                            <span className="text-sm font-medium text-blue-700">添加模式</span>
                            <span className="text-xs text-blue-600">点击地图上的标记添加到链中</span>
                        </div>
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                    {selectedMarker ? (
                        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-visible custom-scrollbar">
                            {/* 首图显示 */}
                            {selectedMarker.content.headerImage && (
                                <div className="w-full">
                                    <img
                                        src={compressedImageUrl(selectedMarker.content.headerImage)}
                                        alt={selectedMarker.content.title || '标记首图'}
                                        className="w-full h-48 object-cover"
                                    />
                                </div>
                            )}

                            {/* 只读内容显示 */}
                            <div className="p-4">
                                {renderReadOnlyContent(selectedMarker.content.markdownContent)}
                            </div>
                        </div>
                    ) : (
                        // 无选中标记时的提示
                        <div className="flex-1 flex items-center justify-center p-8">
                            <div className="text-center text-gray-500">
                                <div className="text-6xl mb-4">🗺️</div>
                                <h3 className="text-lg font-medium mb-2">选择一个标记</h3>
                                <p className="text-sm">点击地图上的标记查看详细内容</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}
