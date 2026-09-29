'use client'

import { useRef, useState, useEffect } from 'react'
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

    // 点击外部关闭下拉
    useEffect(() => {
        if (!dayDropdownOpen) return
        const handleClick = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDayDropdownOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
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
                'fixed left-1/2 -translate-x-1/2 -translate-y-1/2 z-40',
                'bg-white/95 backdrop-blur border border-gray-200 shadow-lg rounded-full',
                'flex items-center gap-1 px-3 py-1.5 text-sm max-w-[90vw]',
                'animate-scale-in'
            )}
            style={{ top: 'calc(env(safe-area-inset-top) + 36px)' }}
        >
            {/* Trip name — 切换到旅途详情 */}
            <button
                onClick={handleTripClick}
                className={cn(
                    'font-medium transition-colors truncate max-w-[120px]',
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
                    <div ref={dropdownRef} className="relative">
                        <button
                            onClick={() => setDayDropdownOpen(v => !v)}
                            className="font-medium text-blue-600 truncate max-w-[140px] flex items-center gap-0.5"
                            title={day.date}
                        >
                            {day.title || `第${dayNum}天`}
                            <span className="ml-1 text-xs text-gray-400 font-normal hidden sm:inline">
                                · {formatDate(day.date)}
                            </span>
                            <svg className={cn('w-3 h-3 text-gray-400 flex-shrink-0 transition-transform', dayDropdownOpen && 'rotate-180')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {dayDropdownOpen && (
                            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden min-w-[160px] z-50">
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
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* Progress (trip mode) — 点击弹出天选择 */}
            {activeView.mode === 'trip' && totalDays > 0 && (
                <div ref={dropdownRef} className="relative">
                    <button
                        onClick={() => setDayDropdownOpen(v => !v)}
                        className="text-xs text-gray-400 ml-1 flex-shrink-0 flex items-center gap-0.5 hover:text-gray-600 transition-colors"
                    >
                        总览 · 共{totalDays}天
                        <svg className={cn('w-3 h-3 transition-transform', dayDropdownOpen && 'rotate-180')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>

                    {dayDropdownOpen && (
                        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden min-w-[160px] z-50">
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
                        </div>
                    )}
                </div>
            )}

            {/* Exit button */}
            <button
                onClick={() => setActiveView('overview', null, null)}
                className="ml-1 w-5 h-5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center transition-colors flex-shrink-0"
                title="退出旅行模式"
            >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    )
}
