'use client'

import dynamic from 'next/dynamic'
import type { BasemapProviderType } from '@/types/map-provider'

const InteractiveMap = dynamic(() => import('@/components/map/abstract-map').then(mod => mod.AbstractMap), {
    ssr: false,
    loading: () => <div className="w-full h-screen flex items-center justify-center bg-gray-100"><p className="text-gray-600">加载地图中...</p></div>,
})

export function MapClient({ renderer, amapJsKey, amapSecurityCode, routeProvider }: { renderer: BasemapProviderType; amapJsKey: string; amapSecurityCode: string; routeProvider: string }) {
    return <main className="fixed inset-0"><InteractiveMap renderer={renderer} amapJsKey={amapJsKey} amapSecurityCode={amapSecurityCode} routeProvider={routeProvider} /></main>
}
