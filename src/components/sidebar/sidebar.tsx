'use client'

import { PlaceIcon } from '@/components/ui/place-icon'

import { useRef, useState, useEffect } from 'react'
import { ArrowUpRight, FileText, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import { useMapStore } from '@/store/map-store'
import { MARKER_ICONS } from '@/types/marker'
import { cn } from '@/utils/cn'
import { wgs84ToGcj02 } from '@/lib/coord-transform'
import { compressedImageUrl, compressedContentImages } from '@/lib/upload/image-url'

export const Sidebar = ({ onClose }: { onClose?: () => void }) => {
    const sidebarRef = useRef<HTMLDivElement>(null)
    const [animState, setAnimState] = useState<'hidden' | 'entering' | 'visible' | 'exiting'>('hidden')
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [adding, setAdding] = useState(false)
    const { markers, interactionState, closeSidebar, openEditMarkerModal, activeView, trips, tripDays, addMarkerToDay, setTripMarker, setActiveView, openLeftSidebar, editMode } = useMapStore()
    const { isSidebarOpen, displayedMarkerId } = interactionState
    const marker = markers.find(item => item.id === displayedMarkerId)
    const currentDay = activeView.mode === 'day' ? tripDays.find(day => day.id === activeView.dayId) : undefined
    const currentTrip = trips.find(trip => trip.id === activeView.tripId)
    const belongsToDay = !!marker && !!currentDay?.markerIds.includes(marker.id)
    const belongsToTrip = !!marker && (!!currentTrip?.markerIds?.includes(marker.id) || tripDays.some(day => day.tripId === currentTrip?.id && day.markerIds.includes(marker.id)))
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
    const content = marker?.content.markdownContent || ''
    const hasContent = !!content.trim() && content !== '<p></p>'
    const icon = MARKER_ICONS[marker?.content.iconType || 'location'] || MARKER_ICONS.location
    const memberships = marker ? trips.map(trip => ({ trip, days: tripDays.filter(day => day.tripId === trip.id && day.markerIds.includes(marker.id)).sort((a, b) => a.date.localeCompare(b.date)) })).filter(item => item.days.length || item.trip.markerIds?.includes(marker.id)) : []
    return <>
        <div className={cn('fixed inset-0 z-[69] bg-black lg:hidden panel-backdrop', isSidebarOpen ? 'panel-open' : 'panel-closed', animState === 'visible' ? 'opacity-25' : 'opacity-0')} onClick={close} />
        <div ref={sidebarRef} className={cn('right-sidebar fixed right-0 bottom-0 z-[70] flex h-full w-full max-w-md flex-col bg-white lg:top-0 lg:bottom-0 lg:h-auto lg:w-[420px] lg:max-w-[420px] sidebar-ipad-portrait sidebar-ipad-landscape app-panel', (animState === 'entering' || animState === 'exiting') ? 'translate-x-full' : 'translate-x-0')} style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-3">
                <span className="text-xs font-medium text-gray-500">地点详情</span>
                <div className="flex items-center gap-1">
                    {marker && editMode.isEnabled && <button onClick={() => openEditMarkerModal(marker.id)} className="workspace-icon-button" aria-label="编辑地点" title="编辑地点"><Pencil size={17} /></button>}
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
                            {editMode.isEnabled && currentTrip && !(currentDay ? belongsToDay : belongsToTrip) && <button disabled={adding} className="workspace-primary-button" onClick={async () => {
                                setAdding(true)
                                try {
                                    if (currentDay) await addMarkerToDay(currentTrip.id, currentDay.id, marker.id)
                                    else await setTripMarker(currentTrip.id, marker.id, true)
                                    toast.success('已加入行程')
                                } catch { toast.error('加入行程失败，请重试') }
                                finally { setAdding(false) }
                            }}>{adding ? '加入中…' : currentDay ? '加入当天' : '加入旅行'}</button>}
                        </div>
                    </div>
                    {!!memberships.length && <section className="space-y-2"><h3 className="text-xs font-medium text-gray-400">所属行程</h3><div className="space-y-1">{memberships.map(({ trip, days }) => <div key={trip.id} className="rounded-xl bg-gray-50 px-3 py-2.5">
                        <button className="w-full text-left text-sm font-medium text-gray-700 hover:text-gray-900" onClick={() => { setActiveView('trip', trip.id); openLeftSidebar() }}>{trip.name}</button>
                        <div className="mt-1 flex flex-wrap gap-1">{days.length ? days.map(day => <button key={day.id} onClick={() => { setActiveView('day', trip.id, day.id); openLeftSidebar() }} className="rounded-md px-1.5 py-1 text-xs text-gray-500 hover:bg-gray-200">{day.date.slice(5).replace('-', '/')}</button>) : <span className="text-xs text-gray-400">未分配日期</span>}</div>
                    </div>)}</div></section>}
                    {marker.content.headerImage && <img src={compressedImageUrl(marker.content.headerImage)} loading="lazy" alt={marker.content.title || '地点封面'} className="aspect-video w-full rounded-2xl object-cover" />}
                    <section className="space-y-3"><h3 className="text-xs font-medium text-gray-400">地点笔记</h3>{hasContent ? <div className="prose prose-sm max-w-none rich-content" dangerouslySetInnerHTML={{ __html: compressedContentImages(content) }} /> : <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400"><FileText size={20} className="mx-auto mb-2 text-gray-300" /><p>还没有地点笔记</p>{editMode.isEnabled && <button onClick={() => openEditMarkerModal(marker.id)} className="mt-2 rounded-lg px-3 py-2 text-xs text-gray-600 hover:bg-gray-100">添加笔记</button>}</div>}</section>
                    <details className="border-t border-gray-100 pt-3 text-xs text-gray-400"><summary className="cursor-pointer py-2">位置信息</summary><p className="py-2 font-mono">{marker.coordinates.latitude.toFixed(6)}, {marker.coordinates.longitude.toFixed(6)}</p></details>
                </div>
            </div> : <div className="flex flex-1 items-center justify-center p-8 text-sm text-gray-400">选择一个地点查看详情</div>}
        </div>
    </>
}
