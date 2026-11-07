'use client'

import { placeMemberships } from '@/lib/trips/place-memberships'
import { TripPlaceNotes } from '@/components/trips/trip-place-notes'
import { PlaceIcon } from '@/components/ui/place-icon'

import { useRef, useState, useEffect } from 'react'
import { ArrowUpRight, Pencil, X } from 'lucide-react'
import { routeColor } from '@/lib/map/route-presentation'
import { useMapStore } from '@/store/map-store'
import { MARKER_ICONS } from '@/types/marker'
import { cn } from '@/utils/cn'
import { wgs84ToGcj02 } from '@/lib/coord-transform'
import { PlaceCover } from '@/components/trips/place-cover'

export const Sidebar = ({ onClose }: { onClose?: () => void }) => {
    const sidebarRef = useRef<HTMLDivElement>(null)
    const [animState, setAnimState] = useState<'hidden' | 'entering' | 'visible' | 'exiting'>('hidden')
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [noteTripId, setNoteTripId] = useState<string | null>(null)
    const { markers, interactionState, closeSidebar, openEditMarkerModal, activeView, trips, tripDays } = useMapStore()
    const { isSidebarOpen, displayedMarkerId } = interactionState
    const marker = markers.find(item => item.id === displayedMarkerId)
    useEffect(() => { setNoteTripId(activeView.tripId) }, [displayedMarkerId, isSidebarOpen, activeView.tripId])
    const close = () => { if (onClose) onClose(); else closeSidebar() }
    useEffect(() => {
        let frame = 0
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
        if (isSidebarOpen) {
            setAnimState('entering')
            frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => setAnimState('visible')) })
        } else {
            setAnimState(state => state === 'hidden' ? 'hidden' : 'exiting')
            closeTimerRef.current = setTimeout(() => setAnimState('hidden'), 240)
        }
        return () => { cancelAnimationFrame(frame); if (closeTimerRef.current) clearTimeout(closeTimerRef.current) }
    }, [isSidebarOpen])
    useEffect(() => { if (sidebarRef.current) sidebarRef.current.inert = !isSidebarOpen }, [isSidebarOpen, animState])
    if (animState === 'hidden') return null
    const icon = MARKER_ICONS[marker?.content.iconType || 'location'] || MARKER_ICONS.location
    const memberships = marker ? placeMemberships(marker.id, trips, tripDays) : []
    return <>
        <div className={cn('fixed inset-0 z-[69] bg-black lg:hidden panel-backdrop', isSidebarOpen ? 'panel-open' : 'panel-closed', animState === 'visible' ? 'opacity-25' : 'opacity-0')} onClick={close} />
        <div ref={sidebarRef} className={cn('right-sidebar fixed right-0 bottom-0 z-[70] flex h-full w-full max-w-md flex-col bg-white lg:top-0 lg:bottom-0 lg:h-auto lg:w-[420px] lg:max-w-[420px] sidebar-ipad-portrait sidebar-ipad-landscape app-panel', (animState === 'entering' || animState === 'exiting') ? 'translate-x-full' : 'translate-x-0')} style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-3">
                <span className="text-xs font-medium text-gray-500">地点详情</span>
                <div className="flex items-center gap-1">
                    {marker && <button onClick={() => openEditMarkerModal(marker.id, noteTripId)} className="workspace-icon-button" aria-label="编辑地点" title="编辑地点"><Pencil size={17} /></button>}
                    <button onClick={close} className="workspace-icon-button" aria-label="返回地图" title="返回地图"><X size={18} /></button>
                </div>
            </div>
            {marker ? <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                <div className="space-y-6 p-5">
                    <div className="space-y-3">
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-500"><PlaceIcon emoji={icon.emoji} size={18} />{icon.name}</span>
                        <h2 className="break-words text-2xl font-semibold leading-8 tracking-tight text-gray-900">{marker.content.title || '未命名地点'}</h2>
                        {marker.content.address && <p className="text-sm leading-6 text-gray-500">{marker.content.address}</p>}
                        <div className="flex flex-wrap items-center gap-2">
                            <a href={(() => { const gcj = wgs84ToGcj02(marker.coordinates.longitude, marker.coordinates.latitude); return `https://maps.apple.com/?ll=${gcj.latitude},${gcj.longitude}&q=${encodeURIComponent(marker.content.title || '地点')}` })()} target="_blank" rel="noopener noreferrer" className="workspace-secondary-button inline-flex items-center gap-1.5">在地图中打开<ArrowUpRight size={14} /></a>

                        </div>
                    </div>
                    {!!memberships.length && <section className="space-y-2"><h3 className="text-xs font-medium text-gray-400">所属行程</h3><div className="space-y-1.5">{memberships.map(({ trip, days }) => {
                        const selected = noteTripId === trip.id
                        const ordered = tripDays.filter(day => day.tripId === trip.id).sort((a, b) => a.date.localeCompare(b.date))
                        return <button key={trip.id} type="button" aria-label={trip.name} aria-pressed={selected}
                            className={cn('trip-membership flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors', selected ? 'border-slate-300 bg-slate-100/80' : 'border-transparent bg-gray-50 hover:bg-gray-100')}
                            onClick={() => setNoteTripId(current => current === trip.id ? null : trip.id)}>
                            <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', selected ? 'bg-white shadow-sm' : 'bg-white/70')}><PlaceIcon emoji={trip.emoji || '✈️'} size={20} /></span>
                            <span className="min-w-0 flex-1">
                                <span className={cn('block break-words text-sm font-medium leading-5', selected ? 'text-gray-900' : 'text-gray-700')}>{trip.name}</span>
                                <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs leading-4 text-gray-500">
                                    {days.length ? days.map(day => { const index = ordered.findIndex(item => item.id === day.id); return <span key={day.id} className="inline-flex items-center gap-1 whitespace-nowrap"><span className="size-1.5 rounded-full" style={{ background: routeColor(0, day.id, day.colorIndex) }} />第{index + 1}天 <span className="text-gray-400">{day.date.slice(5).replace('-', '/')}</span></span> })
                                        : <span className="text-gray-400">{trip.markerIds?.includes(marker.id) ? '未分配日期' : '已移出行程'}</span>}
                                </span>
                            </span>
                        </button>
                    })}</div></section>}
                    <PlaceCover marker={marker} tripId={noteTripId} className="aspect-video w-full rounded-2xl object-cover" />
                    <TripPlaceNotes marker={marker} tripId={noteTripId} />
                    <details className="border-t border-gray-100 pt-3 text-xs text-gray-400"><summary className="cursor-pointer py-2">位置信息</summary><p className="py-2 font-mono">{marker.coordinates.latitude.toFixed(6)}, {marker.coordinates.longitude.toFixed(6)}</p></details>
                </div>
            </div> : <div className="flex flex-1 items-center justify-center p-8 text-sm text-gray-400">选择一个地点查看详情</div>}
        </div>
    </>
}
