'use client'

import { useEffect, useState } from 'react'
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
const field = 'mt-1.5 block w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm text-gray-800 focus:border-blue-400 focus:outline-none'

function Arrow() {
    return <div aria-hidden="true" className="flex items-center justify-center py-0.5"><svg className="h-4 w-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg></div>
}

function ScheduleEditor({ day, route, stop, next, title, onClose }: { day: TripDay; route: RouteChain; stop: ChainStop; next?: ChainStop; title: string; onClose: () => void }) {
    const leg = next && route.legs.find(item => item.fromStopId === stop.id && item.toStopId === next.id)
    const item = next ? leg : stop
    const [time, setTime] = useState(item?.startTime || '')
    const [duration, setDuration] = useState(item?.durationMinutes === undefined ? '' : String(item.durationMinutes))
    const [note, setNote] = useState(item?.note || '')
    const [mode, setMode] = useState<TransportMode>(leg?.mode || 'walking')
    const [serviceNumber, setServiceNumber] = useState(leg?.serviceNumber || '')
    const [busy, setBusy] = useState(false)
    const save = async (remove = false) => {
        setBusy(true)
        const schedule = { startTime: time || null, durationMinutes: duration === '' ? null : Number(duration), note: note.trim() || null }
        const patch: RouteChainPatch = next ? { legs: [remove ? { fromStopId: stop.id, toStopId: next.id, remove: true } : { fromStopId: stop.id, toStopId: next.id, mode, serviceNumber: serviceNumber.trim() || null, ...schedule }] } : { stops: [{ stopId: stop.id, ...schedule }] }
        try { await useMapStore.getState().updateRouteSchedule(day.tripId, day.id, route.id, patch); onClose() }
        catch (error) { toast.error(error instanceof Error ? error.message : '保存安排失败') }
        finally { setBusy(false) }
    }
    return <Modal title={title} onClose={onClose} busy={busy}><form className="space-y-3" onSubmit={e => { e.preventDefault(); void save() }}>
        {next && <div className="grid grid-cols-2 gap-3"><label className="text-xs text-gray-500">交通方式<select disabled={busy} className={field} value={mode} onChange={e => setMode(e.target.value as TransportMode)}>{modes.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label><label className="text-xs text-gray-500">线路 / 车次号<input disabled={busy} maxLength={120} className={field} value={serviceNumber} onChange={e => setServiceNumber(e.target.value)} /></label></div>}
        <div className="grid grid-cols-2 gap-3"><label className="text-xs text-gray-500">{next ? '出发时间' : '游览时间'}<input disabled={busy} type="time" className={field} value={time} onChange={e => setTime(e.target.value)} /></label><label className="text-xs text-gray-500">{next ? '交通时长' : '游玩时长'}<div className="relative"><input disabled={busy} type="number" min={0} step={1} className={`${field} pr-12`} value={duration} onChange={e => setDuration(e.target.value)} /><span className="absolute right-3 top-3 text-xs text-gray-400">分钟</span></div></label></div>
        <label className="block text-xs text-gray-500">备注<textarea disabled={busy} maxLength={4000} rows={2} className={`${field} resize-none`} value={note} onChange={e => setNote(e.target.value)} /></label>
        <div className="flex items-center justify-end gap-2">{leg && <button disabled={busy} type="button" onClick={() => { void save(true) }} className="mr-auto py-2 text-xs text-gray-500">清除安排</button>}<button disabled={busy} type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-500">取消</button><button disabled={busy} type="submit" className="rounded-lg bg-blue-600 px-5 py-2 text-sm text-white disabled:opacity-50">{busy ? '保存中…' : '保存'}</button></div>
    </form></Modal>
}

export function StopSchedule({ day, route, markerId, editable }: { day?: TripDay; route?: RouteChain; markerId: string; editable: boolean }) {
    const stop = route?.stops.find(s => s.markerId === markerId)
    const [open, setOpen] = useState(false)
    useEffect(() => { if (!editable) setOpen(false) }, [editable])
    useEffect(() => { setOpen(false) }, [day?.id, route?.id, stop?.id])
    if (!stop || !route || !day) return null
    const hasTime = !!stop.startTime || stop.durationMinutes !== undefined
    if (!hasTime && !editable) return null
    return <><button disabled={!editable} onClick={() => setOpen(true)} aria-label="编辑游览安排" title={hasTime ? "编辑游览时间和时长" : "设置游览时间和时长"} className="route-schedule-button ml-auto flex shrink-0 items-center gap-1 rounded px-1 text-[11px] tabular-nums text-gray-500 enabled:hover:bg-gray-100 disabled:cursor-default">
        {stop.startTime && <span>{stop.startTime}</span>}{stop.startTime && stop.durationMinutes !== undefined && <span className="text-gray-300">·</span>}{stop.durationMinutes !== undefined && <span>{formatPlannedDuration(stop.durationMinutes)}</span>}{!hasTime && editable && <span className="flex items-center gap-1 text-gray-400"><Clock3 aria-hidden="true" size={12} /><span>--:--</span></span>}
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
    return <><Arrow />{(leg || distance !== null || canEdit) && <>
        <div className="overflow-hidden rounded-lg border border-dashed border-gray-300 bg-gray-50/60">
            <button disabled={!canEdit} onClick={() => setOpen(true)} aria-label="编辑交通安排" className="route-schedule-button block w-full px-2 py-1.5 text-left text-[11px] text-gray-500 enabled:hover:bg-gray-100/70 disabled:cursor-default">
                {!leg ? <span className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                    <span className="text-left tabular-nums">{distance !== null && distanceLabel(distance)}</span>
                    {canEdit ? <span className="text-center text-gray-400">无交通安排</span> : <span />}
                    <span />
                </span> : <span className="flex min-w-0 items-center gap-1.5"><span className="flex min-w-0 flex-1 items-center gap-1">
                    {distance !== null && <span className="shrink-0 tabular-nums">{distanceLabel(distance)}</span>}{distance !== null && leg && <span className="text-gray-300">·</span>}
                    {leg && <><Icon size={13} className="shrink-0 text-gray-400" /><span className="shrink-0">{modes.find(m => m.value === leg.mode)?.label}</span>{leg.serviceNumber && <span className="truncate font-medium text-gray-700" title={leg.serviceNumber}>{leg.serviceNumber}</span>}</>}
                </span>{leg && <span className="ml-auto flex shrink-0 items-center gap-1 tabular-nums">{leg.startTime && <span>{leg.startTime}</span>}{leg.startTime && leg.durationMinutes !== undefined && <span className="text-gray-300">·</span>}{leg.durationMinutes !== undefined && <span>{formatPlannedDuration(leg.durationMinutes)}</span>}</span>}</span>}
                {leg?.note && <span className="mt-0.5 block truncate leading-4 text-gray-400" title={leg.note}>{leg.note}</span>}
            </button>
        </div><Arrow />
    </>}{open && day && route && stop && next && <ScheduleEditor day={day} route={route} stop={stop} next={next} title="交通安排" onClose={() => setOpen(false)} />}</>
}
