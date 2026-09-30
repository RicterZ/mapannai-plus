'use client'

import { useRef, useState, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useMapStore } from '@/store/map-store'
import { cn } from '@/utils/cn'

// Format ISO date as "3月1日（周五）"
function formatDate(iso: string): string {
    const d = new Date(iso + 'T00:00:00')
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return `${d.getMonth() + 1}月${d.getDate()}日（${weekdays[d.getDay()]}）`
}

// Get ordinal day number within a trip
function getDayNumber(tripId: string, dayId: string, tripDays: ReturnType<typeof useMapStore.getState>['tripDays']): number {
    const days = tripDays
        .filter(d => d.tripId === tripId)
        .sort((a, b) => a.date.localeCompare(b.date))
    const idx = days.findIndex(d => d.id === dayId)
    return idx + 1
}

export const ViewModeBanner = () => {
    const { activeView, trips, tripDays, setActiveView } = useMapStore()
    const [dayDropdownOpen, setDayDropdownOpen] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)
    const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
    useLayoutEffect(() => {
        if (!dayDropdownOpen) return
        const position = () => {
            const bounds = dropdownRef.current?.getBoundingClientRect()
            if (bounds) setMenuPosition({ left: Math.max(8, Math.min(bounds.right - 208, window.innerWidth - 216)), top: bounds.bottom + 8 })
        }
        position()
        window.addEventListener('resize', position)
        return () => window.removeEventListener('resize', position)
    }, [dayDropdownOpen])

    // 点击外部关闭下拉
    useEffect(() => {
        if (!dayDropdownOpen) return
        const handleClick = (e: MouseEvent) => {
            if (!dropdownRef.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) {
                setDayDropdownOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClick)
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setDayDropdownOpen(false)
                dropdownRef.current?.querySelector('button')?.focus()
            }
        }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('keydown', onKey) }
    }, [dayDropdownOpen])

    if (activeView.mode === 'overview') return null

    const trip = trips.find(t => t.id === activeView.tripId)
    const day = tripDays.find(d => d.id === activeView.dayId)
    const sortedDays = tripDays
        .filter(d => d.tripId === activeView.tripId)
        .sort((a, b) => a.date.localeCompare(b.date))
    const totalDays = sortedDays.length
    const dayNum = activeView.dayId && activeView.tripId
        ? getDayNumber(activeView.tripId, activeView.dayId, tripDays)
        : null

    const handleTripClick = () => {
        setActiveView('trip', activeView.tripId, null)
    }

    const handleDaySelect = (dayId: string) => {
        setDayDropdownOpen(false)
        setActiveView('day', activeView.tripId, dayId)
    }

    return (
        <div
            className={cn(
                'view-mode-banner fixed left-1/2 -translate-x-1/2 -translate-y-1/2 z-40',
                'bg-white/95 backdrop-blur border border-gray-200 shadow-lg rounded-full',
                'flex flex-nowrap items-center gap-1 px-3 py-1.5 text-sm whitespace-nowrap w-max max-w-[calc(100vw-96px)] sm:max-w-[90vw]',
                'animate-fade-in'
            )}
            style={{ top: 'calc(env(safe-area-inset-top) + 36px)' }}
        >
            {/* Trip name — 切换到旅途详情 */}
            <button
                onClick={handleTripClick}
                className={cn(
                    'min-w-0 outline-none font-medium transition-colors truncate max-w-[120px]',
                    activeView.mode === 'trip' ? 'text-blue-600' : 'text-gray-600 hover:text-blue-500'
                )}
                title={trip?.name}
            >
                {trip?.name ?? '旅行'}
            </button>

            {/* Day breadcrumb (only in day mode) — 点击弹出天选择 */}
            {activeView.mode === 'day' && day && (
                <>
                    <span className="text-gray-300 flex-shrink-0">›</span>
                    <div ref={dropdownRef} className="relative min-w-0">
                        <button
                            onClick={() => setDayDropdownOpen(v => !v)}
                            className="outline-none font-medium text-blue-600 max-w-[140px] sm:max-w-[240px] min-w-0 flex items-center gap-1"
                            aria-label="选择行程日期"
                            aria-expanded={dayDropdownOpen}
                            title={day.date}
                        >
                            <span className="min-w-0 truncate">
                                {day.title || `第${dayNum}天`}
                                <span className="ml-1 text-xs text-gray-400 font-normal hidden sm:inline">
                                    · {formatDate(day.date)}
                                </span>
                            </span>
                            <svg className={cn('w-3 h-3 text-gray-400 flex-shrink-0 transition-transform', dayDropdownOpen && 'rotate-180')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {dayDropdownOpen && (
                            createPortal(<div ref={menuRef} style={menuPosition} className="fixed bg-white border border-gray-200 rounded-xl shadow-xl w-[208px] max-h-[60dvh] overflow-y-auto whitespace-normal z-[80] flex flex-col">
                                {sortedDays.map((d, idx) => (
                                    <button
                                        key={d.id}
                                        onClick={() => handleDaySelect(d.id)}
                                        className={cn(
                                            'w-full text-left px-4 py-2.5 text-sm transition-colors',
                                            d.id === activeView.dayId
                                                ? 'bg-blue-50 text-blue-600 font-medium'
                                                : 'text-gray-700 hover:bg-gray-50'
                                        )}
                                    >
                                        <div className="font-medium">{d.title || `第${idx + 1}天`}</div>
                                        <div className="text-xs text-gray-400 mt-0.5">{formatDate(d.date)}</div>
                                    </button>
                                ))}
                            </div>, document.body)
                        )}
                    </div>
                </>
            )}

            {/* Progress (trip mode) — 点击弹出天选择 */}
            {activeView.mode === 'trip' && totalDays > 0 && (
                <div ref={dropdownRef} className="relative flex-shrink-0">
                    <button
                        onClick={() => setDayDropdownOpen(v => !v)}
                        className="outline-none text-xs text-gray-400 ml-1 flex-shrink-0 flex items-center gap-0.5 whitespace-nowrap hover:text-gray-600 transition-colors"
                    >
                        总览 · 共{totalDays}天
                        <svg className={cn('w-3 h-3 transition-transform', dayDropdownOpen && 'rotate-180')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>

                    {dayDropdownOpen && (
                        createPortal(<div ref={menuRef} style={menuPosition} className="fixed bg-white border border-gray-200 rounded-xl shadow-xl w-[208px] max-h-[60dvh] overflow-y-auto whitespace-normal z-[80] flex flex-col">
                            {sortedDays.map((d, idx) => (
                                <button
                                    key={d.id}
                                    onClick={() => handleDaySelect(d.id)}
                                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                >
                                    <div className="font-medium">{d.title || `第${idx + 1}天`}</div>
                                    <div className="text-xs text-gray-400 mt-0.5">{formatDate(d.date)}</div>
                                </button>
                            ))}
                        </div>, document.body)
                    )}
                </div>
            )}

            {/* Exit button */}
            <button
                onClick={() => setActiveView('overview', null, null)}
                className="outline-none ml-1 w-5 h-5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center transition-colors flex-shrink-0"
                title="退出旅行模式"
            >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    )
}
