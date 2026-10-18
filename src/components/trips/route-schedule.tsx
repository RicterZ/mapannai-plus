'use client'

import React, { useEffect, useState } from 'react'
import { Bike, Bus, Car, Clock3, Footprints, Plane, Ship, TrainFront, Route } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/modal'
import { useMapStore } from '@/store/map-store'
import type { ChainStop, RouteChain, TripDay, TransportMode } from '@/types/trip'
import type { RouteChainPatch } from '@/lib/trips/route-chain-schema'

const modes: { value: TransportMode; label: string }[] = [
    { value: 'walking', label: '步行' }, { value: 'cycling', label: '骑行' }, { value: 'driving', label: '驾车' },
    { value: 'taxi', label: '出租车' }, { value: 'bus', label: '公交' }, { value: 'subway', label: '地铁' },
    { value: 'train', label: '火车' }, { value: 'flight', label: '飞机' }, { value: 'ferry', label: '轮船' }, { value: 'other', label: '其他' },
]
const icons = { walking: Footprints, cycling: Bike, driving: Car, taxi: Car, bus: Bus, subway: TrainFront, train: TrainFront, flight: Plane, ferry: Ship, other: Route }
export const formatPlannedDuration = (minutes: number) => minutes > 0 && minutes % 60 === 0 ? `${minutes / 60}小时` : `${minutes}分钟`
const distanceLabel = (distance: number) => distance < 1000 ? `${Math.round(distance)} m` : `${Number((distance / 1000).toFixed(1))} km`
const field = 'workspace-field mt-1.5'

function ScheduleEditor({ day, route, stop, next, title, onClose }: { day: TripDay; route: RouteChain; stop: ChainStop; next?: ChainStop; title: string; onClose: () => void }) {
    const leg = next && route.legs.find(item => item.fromStopId === stop.id && item.toStopId === next.id)
    const item = next ? leg : stop
    const [time, setTime] = useState(item?.startTime || '')
    const [duration, setDuration] = useState(item?.durationMinutes === undefined ? '' : String(item.durationMinutes))
    const [isHighlight, setIsHighlight] = useState(item?.isHighlight === true)
    const [note, setNote] = useState(item?.note || '')
    const [mode, setMode] = useState<TransportMode>(leg?.mode || 'walking')
    const [serviceNumber, setServiceNumber] = useState(leg?.serviceNumber || '')
    const [busy, setBusy] = useState(false)
    const save = async (remove = false) => {
        setBusy(true)
        const schedule = { isHighlight, startTime: time || null, durationMinutes: duration === '' ? null : Number(duration), note: note.trim() || null }
        const patch: RouteChainPatch = next ? { legs: [remove ? { fromStopId: stop.id, toStopId: next.id, remove: true } : { fromStopId: stop.id, toStopId: next.id, mode, serviceNumber: serviceNumber.trim() || null, ...schedule }] } : { stops: [{ stopId: stop.id, ...schedule }] }
        try { await useMapStore.getState().updateRouteSchedule(day.tripId, day.id, route.id, patch); onClose() }
        catch (error) { toast.error(error instanceof Error ? error.message : '保存安排失败') }
        finally { setBusy(false) }
    }
    return <Modal title={title} onClose={onClose} busy={busy}><form className="space-y-3" onSubmit={e => { e.preventDefault(); void save() }}>
        {next && <div className="grid grid-cols-2 gap-3"><label className="text-xs text-gray-500">交通方式<select disabled={busy} className={field} value={mode} onChange={e => setMode(e.target.value as TransportMode)}>{modes.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label><label className="text-xs text-gray-500">线路 / 车次号<input disabled={busy} maxLength={120} className={field} value={serviceNumber} onChange={e => setServiceNumber(e.target.value)} /></label></div>}
        <div className="grid grid-cols-2 gap-3"><label className="text-xs text-gray-500">{next ? '出发时间' : '游览时间'}<input disabled={busy} type="time" className={field} value={time} onChange={e => setTime(e.target.value)} /></label><label className="text-xs text-gray-500">{next ? '交通时长' : '游玩时长'}<div className="relative"><input disabled={busy} type="number" min={0} step={1} className={`${field} pr-12`} value={duration} onChange={e => setDuration(e.target.value)} /><span className="absolute right-3 top-3 text-xs text-gray-400">分钟</span></div></label></div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={isHighlight} disabled={busy} onChange={e => setIsHighlight(e.target.checked)} className="h-4 w-4" />{next ? '重点交通' : '重点地点'}<span className="text-xs text-gray-400">显示地图标签</span></label>
        <label className="block text-xs text-gray-500">备注<textarea disabled={busy} maxLength={4000} rows={2} className={`${field} resize-none`} value={note} onChange={e => setNote(e.target.value)} /></label>
        <div className="flex items-center justify-end gap-2">{leg && <button disabled={busy} type="button" onClick={() => { void save(true) }} className="mr-auto py-2 text-xs text-gray-500">清除安排</button>}<button disabled={busy} type="button" onClick={onClose} className="workspace-secondary-button">取消</button><button disabled={busy} type="submit" className="workspace-primary-button">{busy ? '保存中…' : '保存'}</button></div>
    </form></Modal>
}

export function StopSchedule({ day, route, markerId, editable, noteOnly = false }: { day?: TripDay; route?: RouteChain; markerId: string; editable: boolean; noteOnly?: boolean }) {
    const stop = route?.stops.find(s => s.markerId === markerId)
    const [open, setOpen] = useState(false)
    useEffect(() => { if (!editable) setOpen(false) }, [editable])
    useEffect(() => { setOpen(false) }, [day?.id, route?.id, stop?.id])
    if (!stop || !route || !day) return null
    if (noteOnly) return <><button type="button" disabled={!editable} onClick={() => setOpen(true)} aria-label="编辑访问备注" className="route-schedule-button block w-full whitespace-pre-wrap break-words px-2 pb-2 text-left text-xs leading-5 text-gray-500 enabled:hover:bg-gray-100">{stop.note || <span className="text-gray-400">添加访问备注</span>}</button>{open && <ScheduleEditor day={day} route={route} stop={stop} title="游览安排与备注" onClose={() => setOpen(false)} />}</>
    const hasTime = !!stop.startTime || stop.durationMinutes !== undefined
    if (!hasTime && !stop.isHighlight && !editable) return null
    return <><button disabled={!editable} onClick={() => setOpen(true)} aria-label="编辑游览安排" title={hasTime ? "编辑游览时间和时长" : "设置游览时间和时长"} className="route-schedule-button ml-auto flex shrink-0 flex-col items-end gap-0.5 rounded px-1 text-[11px] tabular-nums text-gray-500 enabled:hover:bg-gray-100 disabled:cursor-default">
        {stop.isHighlight && <span className="text-gray-600">重点地点</span>}{stop.startTime && <span>{stop.startTime}</span>}{stop.durationMinutes !== undefined && <span>{formatPlannedDuration(stop.durationMinutes)}</span>}{!hasTime && editable && <span className="flex items-center gap-1 text-gray-400"><Clock3 aria-hidden="true" size={12} /><span>--:--</span></span>}
    </button>{open && <ScheduleEditor day={day} route={route} stop={stop} title="游览安排" onClose={() => setOpen(false)} />}</>
}

export function RouteLeg({ day, route, fromId, toId, distance, editable }: { day?: TripDay; route?: RouteChain; fromId: string; toId: string; distance: number | null; editable: boolean }) {
    const index = route?.stops.findIndex(s => s.markerId === fromId) ?? -1
    const stop = route?.stops[index], next = route?.stops[index + 1]
    const valid = next?.markerId === toId
    const leg = valid ? route?.legs.find(l => l.fromStopId === stop?.id && l.toStopId === next?.id) : undefined
    const [open, setOpen] = useState(false)
    useEffect(() => { if (!editable) setOpen(false) }, [editable])
    useEffect(() => { setOpen(false) }, [day?.id, route?.id, stop?.id, next?.id])
    const canEdit = editable && !!day && !!route && !!stop && !!next && valid
    const Icon = leg ? icons[leg.mode] : Route
    return <div className="journey-route-leg">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 py-1.5 text-[11px] text-gray-400">
            <span className="tabular-nums">{distance !== null && distanceLabel(distance)}</span>
            <svg aria-hidden="true" className="h-4 w-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m-5-5 5 5 5-5" /></svg>
            <span />
        </div>
        {(leg || canEdit) && <button type="button" disabled={!canEdit} onClick={() => setOpen(true)} aria-label={canEdit ? '编辑交通安排' : '交通安排'} className="route-schedule-button journey-leg-details block text-left text-xs text-gray-500 enabled:hover:bg-gray-50 disabled:cursor-default">
            <span className="flex items-start gap-2">
                <Icon size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1 break-words">{leg ? <>{modes.find(m => m.value === leg.mode)?.label}{leg.serviceNumber && <span className="ml-1.5 font-medium text-gray-600">{leg.serviceNumber}</span>}</> : <span className="text-gray-400">添加交通安排</span>}</span>
                {leg && <span className="flex shrink-0 flex-col items-end gap-0.5 text-[11px] tabular-nums">
                    {leg.startTime && <span>{leg.startTime}</span>}
                    {leg.durationMinutes !== undefined && <span className="text-gray-400">{formatPlannedDuration(leg.durationMinutes)}</span>}
                </span>}
            </span>
            {leg?.note && <span className="mt-1 block whitespace-pre-wrap break-words text-[11px] leading-5 text-gray-400">{leg.note}</span>}
        </button>}
        {open && day && route && stop && next && <ScheduleEditor day={day} route={route} stop={stop} next={next} title="交通安排" onClose={() => setOpen(false)} />}
    </div>
}
