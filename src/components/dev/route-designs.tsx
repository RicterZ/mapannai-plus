'use client'

import { useEffect, useState } from 'react'
import { LeftSidebar } from '@/components/sidebar/left-sidebar'
import { RouteLeg } from '@/components/trips/route-schedule'
import { useMapStore } from '@/store/map-store'
import type { RouteChain, TripDay } from '@/types/trip'
import type { Marker } from '@/types/marker'

const route: RouteChain = {
    id: 'review-chain',
    stops: [
        { id: 'stop-a', markerId: 'asakusa', startTime: '09:00', durationMinutes: 90, note: '从雷门进入，逛仲见世商店街' },
        { id: 'stop-b', markerId: 'ueno', startTime: '11:00', durationMinutes: 60 },
        { id: 'stop-c', markerId: 'museum', startTime: '13:00', durationMinutes: 120, note: '提前预约常设展' },
    ],
    legs: [{ fromStopId: 'stop-a', toStopId: 'stop-b', mode: 'subway', serviceNumber: '银座线', startTime: '10:40', durationMinutes: 15, note: '浅草站 1 号入口 · 往涩谷方向' }],
}
const day: TripDay = { id: 'review-day', tripId: 'review-trip', date: '2026-10-18', title: '浅草与上野', colorIndex: 0, markerIds: route.stops.map(s => s.markerId), chains: [route.stops.map(s => s.markerId)], routeChains: [route] }
const names = ['浅草寺', '上野公园', '东京国立博物馆']
const markers: Marker[] = route.stops.map((stop, index) => ({ id: stop.markerId, coordinates: { latitude: 35.71 + index * .001, longitude: 139.79 + index * .001 }, content: { id: stop.markerId, title: names[index], address: index === 0 ? '台东区 · 浅草' : '台东区 · 上野公园', iconType: index === 1 ? 'park' : 'culture', markdownContent: '', createdAt: new Date(), updatedAt: new Date() } }))

// Development-only fixtures. HTTP mutations remain real and are mocked by the browser review script.
export function RouteDesigns() {
    const [ready, setReady] = useState(false)
    const [edit, setEdit] = useState(false)
    useEffect(() => {
        const longNames = new URLSearchParams(window.location.search).has('long')
        const fixtureMarkers = longNames ? markers.map((marker, index) => ({ ...marker, content: { ...marker.content, title: ['呼和浩特白塔国际机场', '呼和浩特东站希尔顿欢朋酒店', '内蒙古博物院'][index], address: ['内蒙古自治区呼和浩特市赛罕区空港大道', '呼和浩特市新城区', '呼和浩特市新城区新华东街'][index] } })) : markers
        const fixtureDay = structuredClone(day)
        if (longNames) fixtureDay.routeChains!.forEach(chain => chain.stops.forEach(stop => { delete stop.startTime; delete stop.durationMinutes; delete stop.note }))
        useMapStore.setState({ markers: fixtureMarkers, trips: [{ id: day.tripId, name: '东京散步', startDate: day.date, endDate: day.date, createdAt: day.date, updatedAt: day.date }], tripDays: [fixtureDay], tripsLoaded: true, activeView: { mode: 'day', tripId: day.tripId, dayId: day.id }, leftSidebar: { isOpen: true } })
        setReady(true)
    }, [])
    const emptyRoute = { ...route, legs: [] }
    return <main className="h-screen overflow-y-auto bg-gray-100">
        {ready && <LeftSidebar onFlyTo={() => {}} onFitMarkers={() => {}} routeProvider="google" addMarkerEnabled={edit} onToggleAddMarker={() => setEdit(value => !value)} />}
        <div className="hidden max-w-[760px] space-y-5 p-8 lg:ml-[380px] lg:block">
            <h1 className="text-lg font-semibold">正式组件 · 未设置交通安排</h1>
            {[{ label: '浏览模式 · 无距离 / 无交通安排', distance: null, editable: false }, { label: '浏览模式 · 只有规划距离', distance: 650, editable: false }, { label: '编辑模式 · 等待填写', distance: null, editable: true }].map(item => <section key={item.label} className="rounded-xl bg-white p-4"><h2 className="mb-3 text-sm text-gray-500">{item.label}</h2><div className="mx-auto max-w-[300px]"><div className="rounded-xl border border-gray-200 bg-white p-3 text-sm">浅草寺</div><RouteLeg day={day} route={emptyRoute} fromId="asakusa" toId="ueno" distance={item.distance} editable={item.editable} /><div className="rounded-xl border border-gray-200 bg-white p-3 text-sm">上野公园</div></div></section>)}
        </div>
    </main>
}
