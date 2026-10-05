import { transportModeSchema } from '@/lib/trips/route-chain-schema'
import { NextRequest, NextResponse } from 'next/server'
import { getSavedDirection } from '@/lib/map/direction-service'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { origin, destination, mode, transportMode } = body
        if (![origin, destination].every(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)) return NextResponse.json({ error: '需要有效起点和终点坐标' }, { status: 400 })
        if (mode !== undefined && !['walking', 'driving', 'bicycling', 'transit'].includes(mode)) return NextResponse.json({ error: '路线模式无效' }, { status: 400 })
        if (transportMode !== undefined && !transportModeSchema.safeParse(transportMode).success) return NextResponse.json({ error: '交通方式无效' }, { status: 400 })
        const result = await getSavedDirection(origin, destination, mode, undefined, transportMode)
        return NextResponse.json(result.fallback === 'PLANNING_FAILED' ? { ...result, success: false } : result, { status: result.fallback === 'PLANNING_FAILED' ? 500 : 200 })
    } catch (error) {
        return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '地图服务请求失败' }, { status: 500 })
    }
}
