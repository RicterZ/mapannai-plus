import { NextRequest, NextResponse } from 'next/server'
import { mapProviderFactory } from '@/lib/map/providers'

export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { origin, destination, mode = 'walking' } = body
        if (![origin, destination].every(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)) return NextResponse.json({ error: '需要有效起点和终点坐标' }, { status: 400 })
        if (!['walking', 'driving', 'bicycling', 'transit'].includes(mode)) return NextResponse.json({ error: '路线模式无效' }, { status: 400 })
        const provider = mapProviderFactory.createServiceProvider('directions')
        const result = await provider.getDirections(origin, destination, mode)
        return NextResponse.json(result)
    } catch (error) {
        return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '地图服务请求失败' }, { status: 500 })
    }
}
