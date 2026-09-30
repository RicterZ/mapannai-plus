import { NextRequest, NextResponse } from 'next/server'
import { mapProviderFactory } from '@/lib/map/providers'
import { directionCacheKey, getCachedDirection, cacheDirection } from '@/lib/db/direction-cache'
import type { MapRoute } from '@/types/map-provider'

export const dynamic = 'force-dynamic'
const inFlight = new Map<string, Promise<MapRoute>>()
let providerQueue: Promise<void> = Promise.resolve()
let nextProviderRequestAt = 0

function queueProviderRequest(request: () => Promise<MapRoute>): Promise<MapRoute> {
    const pending = providerQueue.then(async () => {
        const delay = Math.max(0, nextProviderRequestAt - Date.now())
        if (delay) await new Promise(resolve => setTimeout(resolve, delay))
        nextProviderRequestAt = Date.now() + 1200
        return request()
    })
    providerQueue = pending.then(() => {}, () => {})
    return pending
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { origin, destination, mode = 'walking' } = body
        if (![origin, destination].every(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)) return NextResponse.json({ error: '需要有效起点和终点坐标' }, { status: 400 })
        if (!['walking', 'driving', 'bicycling', 'transit'].includes(mode)) return NextResponse.json({ error: '路线模式无效' }, { status: 400 })
        const providerName = process.env.MAP_DIRECTIONS_PROVIDER || 'google'
        const key = directionCacheKey(providerName, mode, origin, destination)
        const cached = getCachedDirection(key)
        if (cached) return NextResponse.json(cached)
        let pending = inFlight.get(key)
        if (!pending) {
            const provider = mapProviderFactory.createServiceProvider('directions')
            pending = queueProviderRequest(() => provider.getDirections(origin, destination, mode)).then(result => {
                if (result.path.length >= 2 && result.path.every(point => Number.isFinite(point.lat) && Number.isFinite(point.lng))) {
                    cacheDirection(key, result)
                }
                return result
            }).finally(() => inFlight.delete(key))
            inFlight.set(key, pending)
        }
        const result = await pending
        return NextResponse.json(result)
    } catch (error) {
        return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '地图服务请求失败' }, { status: 500 })
    }
}
