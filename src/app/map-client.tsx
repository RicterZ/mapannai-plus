'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { fetchWithAuth } from '@/lib/fetch-with-auth'
import type { BasemapProviderType } from '@/types/map-provider'

function MapLoading({ error = false, onRetry }: { error?: boolean; onRetry?: () => void }) {
    return <div role="status" className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-slate-50 text-sm text-gray-500">
        <img src="/icon-192.png" alt="" className="h-14 w-14 rounded-2xl" />
        <p>{error ? '暂时无法连接，请检查网络后重试' : '加载地图中…'}</p>
        {error && <button onClick={onRetry} className="rounded-lg bg-blue-600 px-4 py-2 text-white">重试</button>}
    </div>
}

const InteractiveMap = dynamic(() => import('@/components/map/abstract-map').then(mod => mod.AbstractMap), {
    ssr: false,
    loading: () => <MapLoading />,
})

export function MapClient({ renderer, amapJsKey, amapSecurityCode, routeProvider }: { renderer: BasemapProviderType; amapJsKey: string; amapSecurityCode: string; routeProvider: string }) {
    const [ready, setReady] = useState(false)
    const [error, setError] = useState(false)
    const [attempt, setAttempt] = useState(0)
    useEffect(() => {
        let cancelled = false
        setError(false)
        fetchWithAuth('/api/markers').then(response => {
            if (cancelled) return
            if (response.ok) setReady(true)
            else if (response.status !== 401) setError(true)
        }).catch(() => { if (!cancelled) setError(true) })
        return () => { cancelled = true }
    }, [attempt])
    if (!ready) return <main><MapLoading error={error} onRetry={() => setAttempt(value => value + 1)} /></main>
    return <main className="fixed inset-0"><InteractiveMap renderer={renderer} amapJsKey={amapJsKey} amapSecurityCode={amapSecurityCode} routeProvider={routeProvider} /></main>
}
